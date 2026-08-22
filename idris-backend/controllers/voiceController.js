import { GoogleGenAI, Modality } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Keeps synthesis fast/cheap and bounds cost - assistant replies are meant
// to be short spoken sentences, not long-form text.
const MAX_SPEECH_TEXT_LENGTH = 600;
// A warm, natural-sounding prebuilt Gemini voice (female).
const SPEECH_VOICE_NAME = "Kore";
// The Live model is a general two-way conversational model, not a plain TTS
// engine - without this instruction it tends to "reply" to the input text
// instead of just reading it aloud verbatim.
const SPEECH_SYSTEM_INSTRUCTION =
  "You are a text-to-speech engine, not a conversational assistant. For every message you receive, speak it back verbatim, exactly as written, with natural human intonation. Never add commentary, never answer questions, never say anything that is not literally present in the input text.";
// Raw PCM sample rate the Live API streams audio at.
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

    const response = await ai.models.generateContent({
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
    });

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
export const streamSpeech = async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";

  if (!text) {
    return res.status(400).json({
      success: false,
      message: "Text is required",
    });
  }

  if (text.length > MAX_SPEECH_TEXT_LENGTH) {
    return res.status(400).json({
      success: false,
      message: "Text is too long to speak",
    });
  }

  let session = null;
  let finished = false;
  let wroteAnyAudio = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(hardTimeout);
    try {
      session?.close();
    } catch {
      // Session may already be closed.
    }

    // The client (fetch abort, navigation, tab close) may have already
    // disconnected - writing to a closed/destroyed socket would throw.
    if (res.writableEnded || res.destroyed) return;

    try {
      if (!wroteAnyAudio && !res.headersSent) {
        res.status(502).json({
          success: false,
          message: "No audio generated",
        });
        return;
      }

      res.end();
    } catch {
      // Client already gone.
    }
  };

  // Upper bound on total session lifetime regardless of how the stream
  // progresses, so a stuck/hung Live session can't hold the connection open
  // indefinitely.
  const hardTimeout = setTimeout(finish, 20000);

  req.on("close", finish);

  try {
    session = await ai.live.connect({
      model: "gemini-3.1-flash-live-preview",
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: SPEECH_VOICE_NAME } },
        },
        systemInstruction: SPEECH_SYSTEM_INSTRUCTION,
      },
      callbacks: {
        onmessage: (message) => {
          if (finished) return;

          const parts = message.serverContent?.modelTurn?.parts || [];

          for (const part of parts) {
            if (part.inlineData?.data) {
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

          if (
            message.serverContent?.generationComplete ||
            message.serverContent?.turnComplete
          ) {
            finish();
          }
        },
        onerror: (error) => {
          console.error("Live speech session error:", error);
          finish();
        },
        onclose: finish,
      },
    });

    session.sendClientContent({ turns: text, turnComplete: true });
  } catch (error) {
    console.error("Speech stream setup error:", error);
    clearTimeout(hardTimeout);

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: "Failed to synthesize speech",
      });
    }

    finish();
  }
};
