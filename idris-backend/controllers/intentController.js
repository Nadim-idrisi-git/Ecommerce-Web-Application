import { GoogleGenAI } from "@google/genai";
import { assistantTools } from "../utils/assistantTools.js";
import { assistantToolSanitizers } from "../utils/assistantToolSanitizers.js";
import { sanitizeUIContext } from "../utils/uiContext.js";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const ALLOWED_TOOL_NAMES = new Set(assistantTools.map((tool) => tool.name));
const NO_REPLY_SENTINEL = "NONE";

const extractFunctionCall = (response) => {
  if (response.functionCalls?.length) {
    return response.functionCalls[0];
  }

  const parts = response.candidates?.[0]?.content?.parts || [];
  const part = parts.find((item) => item.functionCall);
  return part?.functionCall || null;
};

const extractReplyText = (response) => {
  const direct = response.text?.trim();
  if (direct) return direct;

  const parts = response.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || "").join("").trim();
};

export const detectAIIntent = async (req, res) => {
  try {
    const { message, uiContext } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    const safeUIContext = sanitizeUIContext(uiContext) || {
      page: "other",
      visibleProducts: [],
      selectedProduct: null,
      activeSearch: "",
      uiOpen: {},
    };

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: `
You are the action router for the IDRIS ecommerce website.

Call exactly one of the available tools if the customer's message clearly
asks for browsing, searching, recommendations, sorting, or navigation.

Current UI context (what the customer is actually looking at right now -
use it to resolve references like "this", "that one", "the second one",
"this product" to a specific id in visibleProducts/selectedProduct):
${JSON.stringify(safeUIContext)}

If the customer's message references a specific item ambiguously (e.g.
"open this", "add the second one") and you cannot confidently tell which
item they mean from the UI context above, do NOT call a tool - instead
reply with one short clarifying question that names the visible options.

For any other message that doesn't match a tool and isn't an ambiguous
item reference (general questions, greetings, store policy, small talk),
do NOT call a tool and do NOT try to answer it yourself - reply with
exactly the single word ${NO_REPLY_SENTINEL} and nothing else.

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

    if (call && ALLOWED_TOOL_NAMES.has(call.name)) {
      const sanitize = assistantToolSanitizers[call.name];
      const sanitizedArgs = sanitize(call.args || {});

      if (sanitizedArgs) {
        return res.json({
          success: true,
          tool: call.name,
          arguments: sanitizedArgs,
        });
      }
    }

    const replyText = extractReplyText(response);
    const isClarification = replyText && replyText.toUpperCase() !== NO_REPLY_SENTINEL;

    return res.json({
      success: true,
      tool: null,
      reply: isClarification ? replyText.slice(0, 300) : null,
    });
  } catch (error) {
    console.error("AI intent detection error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to detect AI intent",
    });
  }
};
