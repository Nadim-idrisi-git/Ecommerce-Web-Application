import { GoogleGenAI } from "@google/genai";
import {
  getCachedCatalog,
  getFirstName,
  buildPersonaPrompt,
  sanitizeHistory,
  sanitizeMessage,
} from "../utils/aiChatContext.js";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// response.text can legitimately come back empty - a safety filter block,
// an empty/MAX_TOKENS finish, a transient blank turn - and unlike
// intentController/transcribeAudio, nothing here previously guarded against
// that before sending it to the client. Without a fallback the customer
// would just get a blank/undefined reply rendered in the widget with no
// indication anything went wrong.
const FALLBACK_REPLY =
  "Sorry, I couldn't come up with a reply just now. Please try asking again.";

export const chatBot = async (req, res) => {
  try {
    const message = sanitizeMessage(req.body?.message);
    const { history } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    const [products, firstName] = await Promise.all([
      getCachedCatalog(),
      getFirstName(req.userId),
    ]);

    const historyContents = sanitizeHistory(history);

    const promptText = `
${buildPersonaPrompt(firstName)}

Product Catalog:
${JSON.stringify(products)}

Customer Message:
${message}
      `;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [...historyContents, { role: "user", parts: [{ text: promptText }] }],
      // A short conversational/support reply doesn't need multi-step
      // reasoning - "medium" (the model's default) burns extra latency
      // thinking through a task this simple. "low" keeps replies fast
      // while still being noticeably better than "minimal" for anything
      // that needs to actually reason about the catalog (e.g. comparing
      // two products).
      config: { thinkingConfig: { thinkingLevel: "low" } },
    });

    res.status(200).json({
      success: true,
      reply: response.text?.trim() || FALLBACK_REPLY,
    });

  } catch (error) {
    console.error("Chatbot error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to generate response",
    });
  }
};
