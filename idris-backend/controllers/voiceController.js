import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

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
