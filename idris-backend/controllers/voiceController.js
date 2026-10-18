import { GoogleGenAI, Modality } from "@google/genai";
import { callGeminiWithRetry } from "../utils/callGeminiWithRetry.js";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Keeps synthesis fast/cheap and bounds cost - assistant replies are meant
// to be short spoken sentences, not long-form text.
const MAX_SPEECH_TEXT_LENGTH = 600;

// Grounded RAG answers (search_products/recommend_products describing two
// or three matching products) routinely run past MAX_SPEECH_TEXT_LENGTH
// even though ragGenerationPrompt.js asks for a concise reply - "concise"
// still varies with how many products are being described, and nothing
// upstream enforces a hard character cap on what the model returns. This
// endpoint used to hard-reject any such answer with a 400, which silently
// killed voice output for exactly the multi-product replies customers hear
// most often, even though the tool call, product results, and displayed
// text had already succeeded (see agentOrchestrator's logs). Trimming to a
// clean sentence boundary - or, failing that, a clean word boundary - keeps
// the same synthesis cost bound while still speaking something coherent
// instead of refusing outright.
const truncateForSpeech = (value) => {
  if (value.length <= MAX_SPEECH_TEXT_LENGTH) return value;

  const clipped = value.slice(0, MAX_SPEECH_TEXT_LENGTH);
  // "। " covers Hindi/Hinglish replies (the assistant's default language),
  // not just English sentence punctuation.
  const lastSentenceEnd = Math.max(
    clipped.lastIndexOf(". "),
    clipped.lastIndexOf("! "),
    clipped.lastIndexOf("? "),
    clipped.lastIndexOf("। "),
  );

  if (lastSentenceEnd > MAX_SPEECH_TEXT_LENGTH * 0.4) {
    return clipped.slice(0, lastSentenceEnd + 1).trim();
  }

  const lastSpace = clipped.lastIndexOf(" ");
  return (lastSpace > MAX_SPEECH_TEXT_LENGTH * 0.4 ? clipped.slice(0, lastSpace) : clipped).trim();
};
// One fixed, natural-sounding female Gemini voice for every browser/device.
// Keeping this server-side prevents Safari/Chrome/Brave from choosing their
// own local voice or changing Zara's voice between turns.
const SPEECH_VOICE_NAME = process.env.GEMINI_LIVE_VOICE?.trim() || "Sulafat";
// A dedicated streaming TTS model. This used to borrow
// gemini-3.1-flash-live-preview (a conversational model, now deprecated)
// with a "read this verbatim" system prompt, which could still paraphrase.
// A TTS model reads the text exactly, and streams the same raw 24kHz PCM the
// frontend already plays, so the wire format is unchanged.
const SPEECH_MODEL = process.env.GEMINI_TTS_MODEL?.trim() || "gemini-3.8-flash-tts";
// Raw PCM sample rate the TTS model streams audio at.
const SPEECH_SAMPLE_RATE = 24000;

export const transcribeAudio = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Audio file is required",
      });
    }

    const audioData = req.file.buffer.toString("base64");

    // Same bounded timeout+retry every other generateContent call site uses
    // (see callGeminiWithRetry.js) - this one was missed, leaving the
    // speech-to-text step (every voice command goes through this first)
    // with no protection against a transient hiccup, silently failing the
    // whole voice turn instead of getting one bounded retry.
    //
    // Uses a longer per-attempt timeout than the default (12s, calibrated
    // for short text-only prompts like chat/intent) - transcribing actual
    // audio content consistently took longer than that in practice (this
    // call kept hitting the 12s ceiling and retrying every single time,
    // confirmed by comparing against agentOrchestrator's text-only calls
    // completing in 5-7s on the same requests), not just occasionally
    // under load.
    const response = await callGeminiWithRetry(() => ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `
Generate an accurate transcript of the speech in this audio.

Rules:
- Return only the spoken words.
- Do not add explanations.
- Do not summarize.
- Preserve the language spoken by the customer.
- The customer may speak English, Hindi, or Hinglish.
              `,
            },
            {
              inlineData: {
                mimeType: req.file.mimetype,
                data: audioData,
              },
            },
          ],
        },
      ],
      // Transcription is a transcription task, not a reasoning one - the
      // model's default "medium" thinking level adds latency here for no
      // benefit, and every voice turn waits on this call before it can even
      // start routing/answering.
      config: { thinkingConfig: { thinkingLevel: "low" } },
    }), { timeoutMs: 20000 });

    const transcript =
      response.text?.trim() ||
      response.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim();

    if (!transcript) {
      return res.status(422).json({
        success: false,
        message: "Could not detect speech in the audio",
      });
    }

    return res.status(200).json({
      success: true,
      transcript,
    });
  } catch (error) {
    console.error("Voice transcription error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to transcribe audio",
    });
  }
};

// Streams synthesized speech back as raw 16-bit PCM (mono, 24kHz) over a
// chunked HTTP response as soon as each chunk is generated, rather than
// waiting for the full clip - the non-streaming approach measured 4-6s
// before any audio was available at all, which made the assistant feel
// broken in a live voice conversation. This runs as a single request/
// response (not a persistent WebSocket) so it stays deployable as a normal
// serverless function.
// One streaming TTS attempt. Resolves once this attempt concludes one way or
// another - {wroteAnyAudio: true} once fully streamed and the response
// ended, or {wroteAnyAudio: false} if it errored/timed out without ever
// producing audio (the caller decides whether that's worth a retry). Never
// rejects - a request-time failure is reported the same way as a zero-audio
// stream, since both are equally retryable.
// finishHolder.current is set to this attempt's own finish() the instant
// it's created, so streamSpeech's req "close" handler can abort the
// in-flight Gemini stream immediately on client disconnect (barge-in aborts
// the frontend's fetch constantly) instead of generating audio nobody will
// hear.
const attemptSpeechStream = (text, res, isClientClosed, finishHolder) => new Promise((resolve) => {
  const controller = new AbortController();
  let finished = false;
  let wroteAnyAudio = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(hardTimeout);
    controller.abort();
    resolve({ wroteAnyAudio });
  };

  finishHolder.current = finish;

  // Upper bound on this attempt's lifetime so a stuck stream can't hold
  // things up indefinitely - each retry gets its own fresh budget.
  const hardTimeout = setTimeout(finish, 20000);

  (async () => {
    try {
      const stream = await ai.models.generateContentStream({
        model: SPEECH_MODEL,
        contents: [{ role: "user", parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: SPEECH_VOICE_NAME } },
          },
          abortSignal: controller.signal,
        },
      });

      for await (const chunk of stream) {
        if (finished || isClientClosed()) break;

        const parts = chunk.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (!part.inlineData?.data) continue;
          if (!wroteAnyAudio) {
            wroteAnyAudio = true;
            res.writeHead(200, {
              "Content-Type": "audio/pcm",
              "X-Sample-Rate": String(SPEECH_SAMPLE_RATE),
              "Cache-Control": "no-store",
            });
          }
          res.write(Buffer.from(part.inlineData.data, "base64"));
        }
      }

      if (wroteAnyAudio && !res.writableEnded) res.end();
    } catch (error) {
      if (!finished) console.error("Speech stream error:", error);
      // Headers already went out with partial audio - end cleanly so the
      // client plays what it has instead of hanging on an open response.
      if (wroteAnyAudio && !res.writableEnded) res.end();
    } finally {
      finish();
    }
  })();
});

export const streamSpeech = async (req, res) => {
  const rawText = typeof req.body?.text === "string" ? req.body.text.trim() : "";

  if (!rawText) {
    return res.status(400).json({
      success: false,
      message: "Text is required",
    });
  }

  const text = truncateForSpeech(rawText);

  let clientClosed = false;
  // .current points at whichever attempt is currently in flight's own
  // finish() - see attemptSpeechStream's declaration for why this needs to
  // abort the in-flight TTS stream immediately rather than waiting on that
  // attempt's own hardTimeout.
  const finishHolder = { current: null };
  req.on("close", () => {
    clientClosed = true;
    finishHolder.current?.();
  });

  // MODULE 15-style bounded retry (same philosophy as callGeminiWithRetry.js,
  // adapted for a streaming response rather than a single promise): a
  // stream occasionally errors without ever producing audio - a transient
  // network hiccup or a momentary rate limit, not a deterministic failure -
  // which previously gave up immediately and 502'd the whole voice reply. Retrying is only safe
  // because nothing has been written to the client yet (headers are only
  // sent once real audio arrives), and this was the one Gemini call site in
  // the backend with no reliability wrapper at all.
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (clientClosed || res.writableEnded || res.destroyed) return;

    // eslint-disable-next-line no-await-in-loop
    const { wroteAnyAudio } = await attemptSpeechStream(text, res, () => clientClosed, finishHolder);

    if (wroteAnyAudio) return;
    if (clientClosed || res.writableEnded || res.destroyed) return;
  }

  if (!res.headersSent) {
    res.status(502).json({
      success: false,
      message: "No audio generated",
    });
  }
};
