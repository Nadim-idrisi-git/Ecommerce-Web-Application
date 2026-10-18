// One realtime voice conversation with Gemini Live, connected straight from
// the browser using a short-lived token minted by our backend
// (POST /api/voice/live/session). The token has the whole session config
// (model, persona, catalog, tools, VAD) locked in server-side, so this file
// never sends any config of its own - it only moves audio, transcripts and
// tool calls.
//
// The SDK is loaded lazily on first use, so it adds nothing to page load.

import { LIVE_INPUT_SAMPLE_RATE } from "./liveAudio";

const MAX_RECONNECTS = 3;
// Mic audio captured before the socket is ready (customers start talking
// the instant they tap) or during a reconnect is held, not dropped - about
// 10s at 50ms per chunk, enough to cover a serverless cold start on the
// token request.
const MAX_BUFFERED_AUDIO_CHUNKS = 200;
const INPUT_MIME_TYPE = `audio/pcm;rate=${LIVE_INPUT_SAMPLE_RATE}`;

let sdkPromise = null;
const loadSdk = () => {
  if (!sdkPromise) {
    sdkPromise = import("@google/genai").catch((error) => {
      sdkPromise = null;
      throw error;
    });
  }
  return sdkPromise;
};

export class LiveVoiceSession {
  // callbacks: {
  //   onReady(), onAudio(base64), onInterrupted(), onTurnComplete(),
  //   onUserTranscript({ text, final, seq }),
  //   onAssistantTranscript({ text, final }),
  //   onToolCall(functionCalls) -> Promise<functionResponses[]>,
  //   onReconnecting(), onClosed({ reason, error })
  // }
  constructor({ backendUrl, authToken, callbacks }) {
    this.backendUrl = backendUrl;
    this.authToken = authToken;
    this.callbacks = callbacks;
    this.session = null;
    this.ready = false;
    this.closedByUs = false;
    this.resumeHandle = "";
    this.reconnects = 0;
    this.reconnecting = false;
    this.cancelledToolCallIds = new Set();
    // Bumped per connection so a superseded socket's late events (its own
    // onclose firing after a reconnect already replaced it) are ignored.
    this.connectionId = 0;
    this.bufferedAudio = [];
    this.audioOpen = false;

    // Customer turn tracking. A new customer turn starts with the first
    // input transcription after the assistant has said anything - `seq`
    // lets callers tell "the answer to my question" apart from the request
    // that triggered the question (see AIAssistant's confirmation gate).
    this.userSeq = 0;
    this.userText = "";
    this.assistantSpokeSinceUser = true;
    this.assistantText = "";
  }

  async fetchToken() {
    const response = await fetch(`${this.backendUrl}/api/voice/live/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.authToken ? { token: this.authToken } : {}),
      },
      body: JSON.stringify(this.resumeHandle ? { resumeHandle: this.resumeHandle } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success || !data.token) {
      throw new Error(data.message || "Could not start a live voice session");
    }
    return data;
  }

  async start() {
    this.closedByUs = false;
    const [{ GoogleGenAI }, { token, model }] = await Promise.all([loadSdk(), this.fetchToken()]);

    const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });
    this.connectionId += 1;
    const connectionId = this.connectionId;
    const isCurrent = () => connectionId === this.connectionId;

    await new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(setupTimeout);
        fn(value);
      };
      const setupTimeout = setTimeout(
        () => settle(reject, new Error("Live session setup timed out")),
        12000,
      );

      ai.live
        .connect({
          model,
          config: {},
          callbacks: {
            onmessage: (message) => {
              if (!isCurrent()) return;
              if (message.setupComplete) {
                this.ready = true;
                settle(resolve);
                // After a reconnect, deliver whatever was said while the
                // socket was down.
                if (this.audioOpen) this.flushBufferedAudio();
              }
              this.handleMessage(message);
            },
            onerror: (event) => {
              if (!isCurrent()) return;
              console.error("Live voice socket error:", event?.message || event);
            },
            onclose: (event) => {
              if (!isCurrent()) return;
              this.ready = false;
              if (!settled) {
                settle(reject, new Error(event?.reason || "Live session closed during setup"));
                return;
              }
              this.handleClose(event);
            },
          },
        })
        .then((session) => {
          if (!isCurrent() || this.closedByUs) {
            session.close();
            return;
          }
          this.session = session;
        })
        .catch((error) => settle(reject, error));
    });

    this.reconnects = 0;
    this.callbacks.onReady?.();
  }

  handleClose(event) {
    if (this.closedByUs) {
      this.callbacks.onClosed?.({ reason: "closed" });
      return;
    }
    // Unexpected drop (GoAway expiry, network blip): resume the same
    // conversation if the server gave us a handle.
    this.reconnect(event?.reason || `socket closed (${event?.code ?? "?"})`);
  }

  async reconnect(reason) {
    if (this.reconnecting || this.closedByUs) return;
    if (!this.resumeHandle || this.reconnects >= MAX_RECONNECTS) {
      this.callbacks.onClosed?.({ reason: "lost", error: new Error(reason) });
      return;
    }

    this.reconnecting = true;
    this.reconnects += 1;
    this.ready = false;
    this.callbacks.onReconnecting?.();

    try {
      const previous = this.session;
      this.session = null;
      // Invalidate the old connection before closing it, so its onclose is
      // ignored rather than read as another unexpected drop.
      this.connectionId += 1;
      try {
        previous?.close();
      } catch {
        // Already closed.
      }
      await this.start();
    } catch (error) {
      console.error("Live voice reconnect failed:", error);
      this.callbacks.onClosed?.({ reason: "lost", error });
    } finally {
      this.reconnecting = false;
    }
  }

  beginUserTurnIfNeeded() {
    if (!this.assistantSpokeSinceUser) return;
    this.assistantSpokeSinceUser = false;
    this.userSeq += 1;
    this.userText = "";
  }

  noteAssistantOutput() {
    if (!this.assistantSpokeSinceUser && this.userText.trim()) {
      this.callbacks.onUserTranscript?.({ text: this.userText.trim(), final: true, seq: this.userSeq });
    }
    this.assistantSpokeSinceUser = true;
  }

  finishAssistantTurn() {
    const text = this.assistantText.trim();
    this.assistantText = "";
    if (text) this.callbacks.onAssistantTranscript?.({ text, final: true });
  }

  handleMessage(message) {
    if (message.sessionResumptionUpdate?.resumable && message.sessionResumptionUpdate.newHandle) {
      this.resumeHandle = message.sessionResumptionUpdate.newHandle;
    }

    if (message.goAway) {
      // The server will drop this connection soon - move to a fresh one now,
      // while nobody is mid-sentence if we can help it.
      this.reconnect("server goAway");
      return;
    }

    if (message.toolCallCancellation?.ids) {
      message.toolCallCancellation.ids.forEach((id) => this.cancelledToolCallIds.add(id));
    }

    if (message.toolCall?.functionCalls?.length) {
      this.noteAssistantOutput();
      this.dispatchToolCalls(message.toolCall.functionCalls);
    }

    const content = message.serverContent;
    if (!content) return;

    if (content.inputTranscription?.text) {
      this.beginUserTurnIfNeeded();
      this.userText += content.inputTranscription.text;
      this.callbacks.onUserTranscript?.({ text: this.userText.trim(), final: false, seq: this.userSeq });
    }

    if (content.interrupted) {
      // Customer barged in: stop playback now, keep what was said so far.
      this.callbacks.onInterrupted?.();
      this.finishAssistantTurn();
    }

    for (const part of content.modelTurn?.parts || []) {
      if (part.inlineData?.data) {
        this.noteAssistantOutput();
        this.callbacks.onAudio?.(part.inlineData.data);
      }
    }

    if (content.outputTranscription?.text) {
      this.noteAssistantOutput();
      this.assistantText += content.outputTranscription.text;
      this.callbacks.onAssistantTranscript?.({ text: this.assistantText.trim(), final: false });
    }

    if (content.turnComplete) {
      this.finishAssistantTurn();
      this.callbacks.onTurnComplete?.();
    }
  }

  async dispatchToolCalls(functionCalls) {
    let responses = [];
    try {
      responses = await this.callbacks.onToolCall(functionCalls);
    } catch (error) {
      console.error("Live tool execution failed:", error);
      responses = functionCalls.map((call) => ({
        id: call.id,
        name: call.name,
        response: { error: "The action failed because of a technical problem. Tell the customer and offer to try again." },
      }));
    }

    const live = responses.filter((item) => !this.cancelledToolCallIds.has(item.id));
    responses.forEach((item) => this.cancelledToolCallIds.delete(item.id));
    if (!live.length || !this.session || !this.ready) return;

    try {
      this.session.sendToolResponse({ functionResponses: live });
    } catch (error) {
      console.error("Could not send tool response:", error);
    }
  }

  // The customer's words in the current (or most recent) turn.
  getCurrentUserTurn() {
    return { seq: this.userSeq, text: this.userText.trim() };
  }

  // Input transcription can trail the model's tool call by a few hundred ms.
  // Resolves with the first customer turn whose seq is greater than
  // `afterSeq` and has text, or with whatever is current once `timeoutMs`
  // passes.
  waitForUserTurnAfter(afterSeq, timeoutMs = 1500) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const check = () => {
        const turn = this.getCurrentUserTurn();
        if ((turn.seq > afterSeq && turn.text) || Date.now() - startedAt >= timeoutMs) {
          resolve(turn);
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });
  }

  sendAudio(base64) {
    if (!this.audioOpen || !this.ready || !this.session) {
      this.bufferedAudio.push(base64);
      if (this.bufferedAudio.length > MAX_BUFFERED_AUDIO_CHUNKS) this.bufferedAudio.shift();
      return;
    }
    try {
      this.session.sendRealtimeInput({ audio: { data: base64, mimeType: INPUT_MIME_TYPE } });
    } catch {
      // Socket is closing; the reconnect path takes over.
    }
  }

  flushBufferedAudio() {
    const chunks = this.bufferedAudio;
    this.bufferedAudio = [];
    chunks.forEach((chunk) => this.sendAudio(chunk));
  }

  // Starts streaming mic audio to the model, beginning with anything said
  // before the session was ready. Called once the opening context has been
  // sent, so the model reads the context before the customer's first words.
  openAudio() {
    this.audioOpen = true;
    if (this.ready) this.flushBufferedAudio();
  }

  sendText(text, turnComplete = true) {
    if (!this.ready || !this.session) return;
    this.session.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete });
  }

  close() {
    this.closedByUs = true;
    this.ready = false;
    this.connectionId += 1;
    try {
      this.session?.close();
    } catch {
      // Already closed.
    }
    this.session = null;
  }
}
