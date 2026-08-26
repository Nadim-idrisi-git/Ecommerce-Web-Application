import { GoogleGenAI } from "@google/genai";
import { assistantTools } from "../utils/assistantTools.js";
import { assistantToolSanitizers } from "../utils/assistantToolSanitizers.js";
import { sanitizeUIContext } from "../utils/uiContext.js";
import {
  getCachedCatalog,
  getFirstName,
  buildPersonaPrompt,
  sanitizeHistory,
  sanitizeMessage,
} from "../utils/aiChatContext.js";
import { assistantRag } from "../utils/rag/assistantRag.js";
import { isRagEligibleTool } from "../utils/rag/ragEligibility.js";
import { buildShoppingQueryPlan } from "../utils/rag/shoppingQueryPlan.js";
import { compareProducts } from "../utils/rag/compareProducts.js";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const ALLOWED_TOOL_NAMES = new Set(assistantTools.map((tool) => tool.name));
// Structural marker the model must prefix an ambiguous-reference clarifying
// question with, and nothing else - lets the response be parsed
// deterministically into "still needs an answer from the customer" vs "this
// is the final answer", instead of guessing from free text. See
// extractReplyText/replyType below.
const CLARIFY_PREFIX = "CLARIFY:";
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

const extractFunctionCall = (response) => {
  if (response.functionCalls?.length) {
    return response.functionCalls[0];
  }

  const parts = response.candidates?.[0]?.content?.parts || [];
  const part = parts.find((item) => item.functionCall);
  return part?.functionCall || null;
};

// search_products already carries sanitized, enum-validated structured
// attributes (utils/assistantToolSanitizers.js) - reused directly as RAG's
// metadata prefilter rather than re-parsing the customer's message a
// second time. recommend_products only ever carries a free-text occasion/
// use-case query (by design - see assistantTools.js), so it has no
// structured filters to reuse; RAG falls back to pure semantic retrieval
// for it, which is exactly the intended behavior for a request that can't
// be mapped to exact filter values.
export const buildRagFiltersForTool = (toolName, sanitizedArgs) => {
  if (toolName !== "search_products") return undefined;

  return {
    gender: sanitizedArgs.gender || undefined,
    category: sanitizedArgs.category || undefined,
    productType: sanitizedArgs.productType || undefined,
    color: sanitizedArgs.color || undefined,
    maxPrice: sanitizedArgs.maxPrice ?? undefined,
  };
};

const extractReplyText = (response) => {
  const direct = response.text?.trim();
  if (direct) return direct;

  const parts = response.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || "").join("").trim();
};

export const detectAIIntent = async (req, res) => {
  try {
    const message = sanitizeMessage(req.body?.message);
    const { uiContext, history, recentActivity } = req.body;

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
You are the action router AND the conversational assistant for the IDRIS
ecommerce website, combined into one step so a general question never needs
a second round trip.

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
  ? `\nThe conversation above this message is the real prior turns of this
same chat (oldest first) - it may include a clarifying question you asked
because a previous request was ambiguous (treat the customer's message
below as the answer to that specific question, combine it with the
original request to resolve exactly which item/cart line/order they mean,
and call the matching tool), or it may just be earlier general
conversation (use it so you don't repeat information you already gave,
don't re-introduce yourself if you already greeted the customer, and can
resolve short follow-ups like "and in blue?" or "how long does that take?"
against what was just discussed). Only ask another clarifying question if
the customer's message is still genuinely ambiguous on its own.\n`
  : ""}
If the customer's message references a specific item, cart line, or order
ambiguously (e.g. "open this", "add the second one", "cancel my order" when
there is more than one order) and you cannot confidently tell which one
they mean from the UI context above, do NOT call a tool - instead respond
with exactly ${CLARIFY_PREFIX} followed by one short clarifying question
that names the visible options, and nothing else before or after it.

Cart rules: never call add_to_cart/update_cart_quantity/remove_from_cart
unless the customer explicitly asked for that change in this message -
never proactively because a product was shown, viewed, or recommended.
Only set autoSelectSize to true if the customer explicitly said something
like "any size" or "you choose" - never guess a size otherwise, and never
invent a size that isn't a real option for that product. If the product is
named descriptively rather than by name ("the most expensive one", "the
cheapest", "the newest", "the bestseller") and isn't resolvable to a
productId from context, still call the cart tool with that description in
query - never fall back to search_products just because you can't resolve
an id yourself; the application resolves these descriptions against the
full catalog on its own.

Order rules: place_order and cancel_order never take effect immediately -
the application always asks the customer to explicitly confirm afterward.
So call the tool as soon as the customer's request is clear; do not ask
"are you sure" yourself first. For cancel_order specifically, only call it
when the order is unambiguous (an id from recentOrders, or the customer
clearly names the one order they mean) - guessing which order is not
allowed, ask instead.

Comparison rules: only call compare_products when you can confidently
identify at least two distinct products the customer means, resolved from
visibleProducts/selectedProduct in the UI context the same way you resolve a
single product id for open_product/add_to_cart. If it's ambiguous which
products to compare (e.g. "which one is better?" with several products
visible, or none clearly named), do NOT call compare_products - instead
respond with exactly ${CLARIFY_PREFIX} followed by one short clarifying
question naming the visible options, exactly like the general ambiguous-
reference rule above. Never guess which two products the customer means.

For any other message that doesn't match a tool and isn't an ambiguous
reference needing clarification (general questions, greetings, store
policy, small talk, questions about a product's price/size/availability),
do NOT call a tool - instead answer directly, in plain text with no
${CLARIFY_PREFIX} prefix, following the persona and catalog below.

Never invent a tool or arguments that are not declared. There is no tool
to modify prices, inventory, product data, or another customer's data -
never imply you can do any of that.

${buildPersonaPrompt(firstName)}

Product Catalog (for answering general/catalog questions only - browsing/
search/recommendation requests should go through a tool call above instead):
${JSON.stringify(products)}

Customer message:
${message}
      `;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [...historyContents, { role: "user", parts: [{ text: promptText }] }],
      config: {
        tools: [{ functionDeclarations: assistantTools }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        // Routing + short replies are a classification-shaped task, not one
        // that benefits from multi-step reasoning - gemini-3.6-flash
        // defaults to "medium" thinking, which spends latency reasoning
        // through a task this simple for no quality benefit here.
        thinkingConfig: { thinkingLevel: "low" },
      },
    });

    const call = extractFunctionCall(response);

    if (call && ALLOWED_TOOL_NAMES.has(call.name)) {
      const sanitize = assistantToolSanitizers[call.name];
      const sanitizedArgs = sanitize(call.args || {});

      if (sanitizedArgs) {
        const responsePayload = {
          success: true,
          tool: call.name,
          arguments: sanitizedArgs,
        };

        // Purely additive: the existing tool/arguments contract above is
        // returned completely unchanged in every case (chat/voice keep
        // working exactly as before, tool-first behavior is fully
        // preserved). RAG only ever adds an extra `rag` field, and only
        // for the two intents that mean semantic product discovery - see
        // utils/rag/ragEligibility.js. A RAG failure here is swallowed
        // (logged, not thrown) so it can never break the tool response the
        // frontend already depends on.
        // MODULE 13: compare_products is a structurally different flow from
        // search/recommend (a direct id-based product lookup, not a query
        // retrieval) - it gets its own branch rather than being folded into
        // isRagEligibleTool, whose own scope is explicitly the two
        // retrieval-shaped tools. Same swallow-on-failure discipline as the
        // RAG branch below: a comparison failure never breaks the tool
        // response the frontend already depends on.
        if (call.name === "compare_products") {
          try {
            responsePayload.rag = await compareProducts({
              productIds: sanitizedArgs.productIds,
              originalQuery: sanitizedArgs.query || message,
            });
          } catch (error) {
            console.error("Comparison integration failed (tool response still returned):", error.message);
          }
        } else if (isRagEligibleTool(call.name)) {
          try {
            // MODULE 11: the canonical shopping query plan - a deterministic
            // parse of the customer's own words (this message + prior user
            // turns in `history`) that is authoritative for hard include/
            // exclude/price constraints; `sanitizedArgs` (Gemini's own tool
            // arguments) only ever fills a field the plan couldn't
            // establish deterministically (e.g. a vague reference Gemini
            // resolved via uiContext) - see shoppingQueryPlan.js and
            // assistantRag.js's buildFiltersFromPlan/buildRerankOverridesFromPlan.
            const plan = buildShoppingQueryPlan({
              originalQuery: message,
              toolArguments: sanitizedArgs,
              history,
            });

            responsePayload.rag = await assistantRag({
              query: plan.retrievalQuery,
              filters: buildRagFiltersForTool(call.name, sanitizedArgs),
              plan,
              // MODULE 9: sanitizedArgs.query is Gemini's own tool-extracted
              // search string and often strips the customer's Hindi/
              // Hinglish words entirely (e.g. "purple floral top" from
              // "mujhe purple floral top chahiye") - passing the verbatim
              // customer message here too lets RAG generation detect/
              // respond in the language the customer actually used, without
              // changing what drives retrieval.
              originalQuery: message,
            });
          } catch (error) {
            console.error("RAG integration failed (tool response still returned):", error.message);
          }
        }

        return res.json(responsePayload);
      }
    }

    const rawReply = extractReplyText(response);
    const isClarification = rawReply.toUpperCase().startsWith(CLARIFY_PREFIX);
    const replyText = isClarification
      ? rawReply.slice(CLARIFY_PREFIX.length).trim()
      : rawReply;

    return res.json({
      success: true,
      tool: null,
      reply: replyText ? replyText.slice(0, 600) : null,
      replyType: replyText ? (isClarification ? "clarification" : "answer") : null,
    });
  } catch (error) {
    console.error("AI intent detection error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to detect AI intent",
    });
  }
};
