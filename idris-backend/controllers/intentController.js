import { GoogleGenAI } from "@google/genai";
import { assistantTools } from "../utils/assistantTools.js";
import { assistantToolSanitizers } from "../utils/assistantToolSanitizers.js";
import { sanitizeUIContext } from "../utils/uiContext.js";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const ALLOWED_TOOL_NAMES = new Set(assistantTools.map((tool) => tool.name));
const NO_REPLY_SENTINEL = "NONE";
const MAX_HISTORY_TURNS = 4;
const MAX_HISTORY_CONTENT_LENGTH = 300;
const MAX_ACTIVITY_ENTRIES = 8;
const MAX_ACTIVITY_ENTRY_LENGTH = 200;

// The frontend's session-only rolling log of past searches/commands
// (memoryRef.activityLog) - each entry is a short spoken confirmation the
// assistant already gave the customer this conversation (e.g. "I found 3
// matching products", "Added Black Jacket to your cart"), never arbitrary
// free-form text. Re-validated/capped here regardless of what was sent.
const sanitizeRecentActivity = (activity) => {
  if (!Array.isArray(activity)) return [];

  return activity
    .filter((item) => typeof item === "string" && item.trim())
    .slice(-MAX_ACTIVITY_ENTRIES)
    .map((item) => item.trim().slice(0, MAX_ACTIVITY_ENTRY_LENGTH));
};

// Only ever populated by the frontend with the exchange that led to a
// clarifying question (see pendingActionRef "clarification" in
// AIAssistant.jsx), never arbitrary free-form chat history - each entry is
// independently re-validated/capped here regardless of what the client sent.
const sanitizeHistory = (history) => {
  if (!Array.isArray(history)) return [];

  return history
    .filter(
      (item) =>
        item &&
        typeof item.content === "string" &&
        item.content.trim() &&
        (item.role === "user" || item.role === "assistant"),
    )
    .slice(-MAX_HISTORY_TURNS)
    .map((item) => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content.trim().slice(0, MAX_HISTORY_CONTENT_LENGTH) }],
    }));
};

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
    const { message, uiContext, history, recentActivity } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    const historyContents = sanitizeHistory(history);
    const safeRecentActivity = sanitizeRecentActivity(recentActivity);

    const safeUIContext = sanitizeUIContext(uiContext) || {
      page: "other",
      visibleProducts: [],
      selectedProduct: null,
      activeSearch: "",
      cartLines: [],
      recentOrders: [],
      uiOpen: {},
    };

    const promptText = `
You are the action router for the IDRIS ecommerce website.

Call exactly one of the available tools if the customer's message clearly
asks for browsing, searching, recommendations, sorting, navigation, cart
changes, checkout, placing an order, tracking an order, or cancelling an
order.

Current UI context (what the customer is actually looking at right now,
their current cart contents, and their recent orders - use it to resolve
references like "this", "that one", "the second one", "my order", "it" to
a specific id in visibleProducts/selectedProduct/cartLines/recentOrders):
${JSON.stringify(safeUIContext)}
${safeRecentActivity.length
  ? `\nWhat the customer has searched for/done earlier this conversation
(oldest first, for context only - not necessarily still on screen):
${JSON.stringify(safeRecentActivity)}
Use this to resolve follow-ups that reference something earlier in the
conversation rather than what's currently visible (e.g. "cheaper ones than
what I searched for before", "go back to the jackets", "add the one I
looked at earlier"). If the customer's request already stands on its own,
ignore this and just handle it normally.\n`
  : ""}
${historyContents.length
  ? `\nThe conversation above this message shows a clarifying question you just
asked the customer because their previous request was ambiguous. Treat the
customer's message below as the answer to that specific question, combine
it with the original request to resolve exactly which item/cart line/order
they mean, and call the matching tool. Only ask another clarifying question
if their answer is still genuinely ambiguous.\n`
  : ""}
If the customer's message references a specific item, cart line, or order
ambiguously (e.g. "open this", "add the second one", "cancel my order" when
there is more than one order) and you cannot confidently tell which one
they mean from the UI context above, do NOT call a tool - instead reply
with one short clarifying question that names the visible options.

Cart rules: never call add_to_cart/update_cart_quantity/remove_from_cart
unless the customer explicitly asked for that change in this message -
never proactively because a product was shown, viewed, or recommended.
Only set autoSelectSize to true if the customer explicitly said something
like "any size" or "you choose" - never guess a size otherwise, and never
invent a size that isn't a real option for that product.

Order rules: place_order and cancel_order never take effect immediately -
the application always asks the customer to explicitly confirm afterward.
So call the tool as soon as the customer's request is clear; do not ask
"are you sure" yourself first. For cancel_order specifically, only call it
when the order is unambiguous (an id from recentOrders, or the customer
clearly names the one order they mean) - guessing which order is not
allowed, ask instead.

For any other message that doesn't match a tool and isn't an ambiguous
reference needing clarification (general questions, greetings, store
policy, small talk), do NOT call a tool and do NOT try to answer it
yourself - reply with exactly the single word ${NO_REPLY_SENTINEL} and
nothing else.

Never invent a tool or arguments that are not declared. There is no tool
to modify prices, inventory, product data, or another customer's data -
never imply you can do any of that.

Customer message:
${message}
      `;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [...historyContents, { role: "user", parts: [{ text: promptText }] }],
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
