import productModel from "../models/productModel.js";
import userModel from "../models/userModel.js";

// Shared between chatController (general Q&A) and intentController (tool
// routing + general Q&A fallback) so both hit the same 60s catalog cache
// instead of doubling the DB read, and so the persona/history rules can't
// drift apart between the two entry points.

// A logged-in customer's first name almost never changes mid-session, but
// without caching it was a DB round trip on every single chat/voice turn -
// pure added latency for a value that's essentially static. Keyed per user
// (unlike the single-entry catalog cache below), so entries are swept
// periodically rather than left to accumulate forever across every distinct
// customer the process ever serves.
const NAME_CACHE_TTL_MS = 5 * 60 * 1000;
const nameCache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of nameCache) {
    if (entry.expiresAt <= now) nameCache.delete(userId);
  }
}, NAME_CACHE_TTL_MS).unref?.();

const getFirstName = async (userId) => {
  if (!userId) return "";

  const cached = nameCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.name;
  }

  // Only the name field is read - never the full user document (no email,
  // address, cart, password hash, etc. is fetched or sent to the model).
  const user = await userModel.findById(userId).select("name");
  const name = user?.name?.trim().split(/\s+/)[0] || "";

  nameCache.set(userId, { name, expiresAt: Date.now() + NAME_CACHE_TTL_MS });
  return name;
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
    .select("name price gender category productType color sizes material fit bestseller")
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
- You are fully bilingual in Hindi and English, and comfortable with Hinglish
  (Hindi and English naturally mixed together, in Devanagari or Roman script,
  the way most customers actually text/speak - e.g. "mujhe black jacket
  dikhao", "size L available hai kya", "kitne din mein deliver hoga"). Decide
  the reply language fresh for EACH customer message on its own, based only
  on that message - not on what language earlier turns in the conversation
  used:
  - If the message is a complete, ordinary English sentence with no Hindi
    words or Hinglish phrasing mixed in at all (e.g. "show me black jacket",
    "what sizes do you have") - and only then - reply in English.
  - For everything else - Hindi, Hinglish, or a message that's
    language-neutral (just a product name, a number, "yes/no", or the
    customer's very first message with no signal either way) - reply in
    Hindi or Hinglish. Match the customer's own script/style: reply in
    Devanagari if they wrote Devanagari, reply in the same natural Roman-
    script Hinglish mix if that's what they wrote. Never translate a
    Hinglish message into stiff formal Hindi or into English - a customer
    who mixes English words into Hindi expects the same natural mix back.
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

// The customer's own message is the one piece of user input that went
// straight into the prompt with no length limit at all, unlike every other
// field here (history, activity, uiContext strings) - an arbitrarily long
// message would scale both Gemini token cost and prompt-build/response
// latency directly with whatever the client sent, on an endpoint otherwise
// only bounded by request *count* (see rateLimit.js), not request size.
// Clamped rather than rejected, matching how every other input in this file
// is handled.
const MAX_MESSAGE_LENGTH = 1000;

const sanitizeMessage = (message) =>
  typeof message === "string" ? message.trim().slice(0, MAX_MESSAGE_LENGTH) : "";

export {
  getFirstName,
  getCachedCatalog,
  buildPersonaPrompt,
  sanitizeHistory,
  sanitizeMessage,
};
