import productModel from "../models/productModel.js";
import userModel from "../models/userModel.js";

// Shared between chatController (general Q&A) and intentController (tool
// routing + general Q&A fallback) so both hit the same 60s catalog cache
// instead of doubling the DB read, and so the persona/history rules can't
// drift apart between the two entry points.

const getFirstName = async (userId) => {
  if (!userId) return "";

  // Only the name field is read - never the full user document (no email,
  // address, cart, password hash, etc. is fetched or sent to the model).
  const user = await userModel.findById(userId).select("name");
  return user?.name?.trim().split(/\s+/)[0] || "";
};

// This endpoint is the fallback for open-ended catalog questions that don't
// match a specific tool - it has no search terms to narrow by, so it used to
// send the *entire* catalog, full documents, on every single message. That
// made both the DB read and the prompt sent to Gemini scale directly with
// catalog size. A lean, capped, bestseller-first slice keeps the model's
// context small and fast while still covering what a broad "what do you
// sell" style question needs.
const CATALOG_CONTEXT_LIMIT = 150;

// A chat session is typically several messages in quick succession, and the
// catalog doesn't change second to second - caching this slice avoids a DB
// round trip on every single message. 60s means a newly added/edited
// product can take up to a minute to show up here, which is an acceptable
// trade for cutting a DB read off the latency-critical path.
const CATALOG_CACHE_TTL_MS = 60_000;
let catalogCache = { data: null, expiresAt: 0 };

const getCachedCatalog = async () => {
  if (catalogCache.data && catalogCache.expiresAt > Date.now()) {
    return catalogCache.data;
  }

  const products = await productModel
    .find()
    .select("name price category subCategory size bestseller")
    .sort({ bestseller: -1, date: -1 })
    .limit(CATALOG_CONTEXT_LIMIT)
    .lean();

  catalogCache = { data: products, expiresAt: Date.now() + CATALOG_CACHE_TTL_MS };
  return products;
};

const buildPersonaPrompt = (firstName) => `
You are Zara, the IDRIS ecommerce assistant.

Store Information:
- Store Name: IDRIS
- Your name is Zara. Introduce yourself by name only if the customer asks who you are.
- You help customers with products, sizes, prices, categories, orders, returns and support.
- Be concise and helpful.
- Hindi (Devanagari script) is your default/first language. If nothing in the
  conversation so far indicates otherwise (e.g. this is the customer's first
  message, or it's language-neutral - just a product name, a number, "yes/no"),
  reply in Hindi. The moment the customer writes in English or any other
  language, switch to that language and keep replying in it for the rest of
  the conversation - never force Hindi once they've shown they're
  communicating in something else, and never switch back to Hindi on your own
  once they've moved to another language.
- Recommend products only from the provided product list.
- If a product is not available, clearly say it is not available in the current catalog.
- When recommending products, mention name, category and price if available.
- Keep replies under 120 words unless the customer specifically asks for details.
- The conversation above (if any) is the real prior turns of this same chat - use it for
  context (e.g. don't re-introduce yourself if you already greeted the customer, don't repeat
  information you already gave, and resolve follow-ups like "and in blue?" against what was
  just discussed) instead of treating every message as the start of a new conversation.
${firstName
  ? `- The customer's first name is "${firstName}". Address them by this name naturally where it fits (e.g. a greeting or confirmation), without overusing it in every sentence.`
  : "- The customer is not logged in / not identified by name. Do not guess or ask for their name."}
- Never reveal, repeat, request, or infer personal information such as address, phone number, email, date of birth, or payment details, even if asked.
`;

const MAX_HISTORY_TURNS = 8;
const MAX_HISTORY_CONTENT_LENGTH = 300;

// Conversation history passed in from the client - either the assistant's
// own turn-by-turn transcript (AIAssistant.jsx) or a chat widget's message
// log (ChatWidget.jsx). Never trusted as-is: capped in count and per-entry
// length, and anything not a plain user/assistant text turn is dropped,
// regardless of what the client sent.
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

export { getFirstName, getCachedCatalog, buildPersonaPrompt, sanitizeHistory };
