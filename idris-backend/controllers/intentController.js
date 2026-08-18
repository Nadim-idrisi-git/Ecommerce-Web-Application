import { GoogleGenAI } from "@google/genai";
import { assistantTools } from "../utils/assistantTools.js";
import { assistantToolSanitizers } from "../utils/assistantToolSanitizers.js";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const ALLOWED_TOOL_NAMES = new Set(assistantTools.map((tool) => tool.name));

const extractFunctionCall = (response) => {
  if (response.functionCalls?.length) {
    return response.functionCalls[0];
  }

  const parts = response.candidates?.[0]?.content?.parts || [];
  const part = parts.find((item) => item.functionCall);
  return part?.functionCall || null;
};

export const detectAIIntent = async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: `
You are the action router for the IDRIS ecommerce website.

Call exactly one of the available tools if the customer's message clearly
asks for browsing, searching, recommendations, sorting, or navigation.

If the message is general conversation, a question, or does not match any
tool (e.g. small talk, store policy questions, order/account questions),
do NOT call a tool - just respond with a short plain-text acknowledgement.

Never invent a tool or arguments that are not declared. Never attempt to
delete, update, add, or otherwise modify any data - no such tool exists.

Customer message:
${message}
      `,
      config: {
        tools: [{ functionDeclarations: assistantTools }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      },
    });

    const call = extractFunctionCall(response);

    if (!call || !ALLOWED_TOOL_NAMES.has(call.name)) {
      return res.json({ success: true, tool: null });
    }

    const sanitize = assistantToolSanitizers[call.name];
    const sanitizedArgs = sanitize(call.args || {});

    if (!sanitizedArgs) {
      return res.json({ success: true, tool: null });
    }

    return res.json({
      success: true,
      tool: call.name,
      arguments: sanitizedArgs,
    });
  } catch (error) {
    console.error("AI intent detection error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to detect AI intent",
    });
  }
};
