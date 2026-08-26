// MODULE 14 — the bounded, multi-step agent orchestrator. Invoked from
// controllers/intentController.js ONLY when the existing, unmodified first
// tool-selection call already chose one of the three "observable" tools
// (search_products/recommend_products/compare_products - the only tools
// with a real, grounded result worth re-planning from). Every other tool
// keeps returning exactly as it did before this module existed - zero
// orchestration overhead, zero behavior change for the other 7 tools.
//
// Reuses, never duplicates: buildShoppingQueryPlan (module 11), assistantRag
// (module 7), compareProducts (module 13), assistantToolSanitizers.js
// (every tool's existing sanitizer), and the same Gemini
// function-calling contract (assistantTools.js's declarations) the first
// call already uses.
//
// CRITICAL SAFETY FACT (see the Module 14 report for the full audit): cart/
// order mutations are executed entirely in the FRONTEND (ShopContextProvider.jsx's
// real authenticated API calls) - this orchestrator NEVER executes a
// mutation itself. Its only job for a mutation is to arrive at a grounded,
// resolved tool call and hand it off as the terminal step, exactly like a
// single-shot request already works today - every existing frontend
// confirmation gate (add_to_cart's size question, place_order/cancel_order's
// yes/no) is completely untouched and still the thing that actually gates
// the mutation.
import { GoogleGenAI } from "@google/genai";
import { assistantTools } from "./assistantTools.js";
import { assistantToolSanitizers } from "./assistantToolSanitizers.js";
import { assistantRag } from "./rag/assistantRag.js";
import { buildShoppingQueryPlan } from "./rag/shoppingQueryPlan.js";
import { compareProducts } from "./rag/compareProducts.js";
import { CLARIFY_PREFIX, extractFunctionCall, extractReplyText } from "./geminiResponseParsing.js";

// Same per-file GoogleGenAI instantiation pattern already used throughout
// this backend - no shared client module exists.
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// PART D — hard limits, enforced in code below, never merely mentioned in a
// prompt. Conservative values: the spec's own two worked examples both need
// at most 2 server-executed tool calls (search+compare) and 2 re-plan
// decision cycles before a terminal mutation hand-off - these leave headroom
// without allowing an open-ended loop.
export const MAX_AGENT_STEPS = 4; // re-plan decision cycles
export const MAX_TOOL_CALLS = 3; // server-executed search/recommend/compare calls

// Independently derived from assistantTools.js (the single source of truth)
// rather than imported from controllers/intentController.js, which avoids a
// circular import (intentController.js calls into this file) for what is a
// one-line derivation.
const ALLOWED_TOOL_NAMES = new Set(assistantTools.map((tool) => tool.name));

const OBSERVABLE_TOOLS = new Set(["search_products", "recommend_products", "compare_products"]);
const MUTATION_TOOLS = new Set([
  "add_to_cart",
  "update_cart_quantity",
  "remove_from_cart",
  "place_order",
  "cancel_order",
]);

export const isObservableTool = (toolName) => OBSERVABLE_TOOLS.has(toolName);
export const isMutationTool = (toolName) => MUTATION_TOOLS.has(toolName);

// A stable, order-independent signature for loop detection (Part J) - two
// calls to the same tool with the same (possibly differently-ordered)
// arguments produce the same signature.
export const toolCallSignature = (toolName, args) => {
  const sorted = Object.entries(args || {})
    .sort(([a], [b]) => a.localeCompare(b));
  return `${toolName}:${JSON.stringify(sorted)}`;
};

// Executes one observable tool using the EXISTING module 7/11/13 functions
// only - no retrieval/generation logic duplicated here. `buildRagFiltersForTool`
// is passed in (not imported) specifically to avoid a circular import with
// controllers/intentController.js, which owns and exports it.
const executeObservableTool = async (toolName, args, ctx, deps) => {
  const runCompareProducts = deps.compareProducts || compareProducts;
  const runAssistantRag = deps.assistantRag || assistantRag;
  const buildPlan = deps.buildShoppingQueryPlan || buildShoppingQueryPlan;

  if (toolName === "compare_products") {
    return runCompareProducts({ productIds: args.productIds, originalQuery: args.query || ctx.message });
  }

  const plan = buildPlan({ originalQuery: ctx.message, toolArguments: args, history: ctx.history });
  return runAssistantRag({
    query: plan.retrievalQuery,
    filters: ctx.buildRagFiltersForTool(toolName, args),
    plan,
    originalQuery: ctx.message,
  });
};

// Exported so tests can assert its exact structure/rules without a live
// Gemini call. `poolList`/`sortedByPrice` are built from candidate sources
// this orchestration itself already retrieved - never from anything Gemini
// said.
export const buildReplanPrompt = ({ message, uiContext, observedPool, executedSummary }) => {
  const poolList = Array.from(observedPool.values());
  const sortedByPrice = poolList
    .filter((p) => Number.isFinite(p.price))
    .slice()
    .sort((a, b) => a.price - b.price);

  return `
You are the RE-PLANNING step of a bounded, multi-step assistant for the IDRIS
ecommerce website. The customer's ORIGINAL request below may need more than
one tool call. You have already executed the step(s) listed below - decide
whether anything else is genuinely still needed to fully satisfy the
ORIGINAL request, or whether it is already complete.

Allowed tools and their kind:
- search_products, recommend_products, compare_products: READ-ONLY. You may call one of these again with genuinely DIFFERENT arguments if still needed - never repeat the exact same call.
- navigate, sort_products, open_product, track_order: READ-ONLY actions.
- add_to_cart, update_cart_quantity, remove_from_cart, place_order, cancel_order: MUTATIONS. You may call one of these as the final step when the customer's request requires it. The application enforces its own confirmation/safety checks after you call it - you do not need to, and must not try to, ask for confirmation yourself.

Steps already executed this turn, in order (grounded/sourceCount tell you
whether each step actually found something real):
${JSON.stringify(executedSummary)}

Real products actually retrieved so far this turn - this is the ONLY set of
products that exist for the rest of this turn. Every id/name/price below is
real. You must NEVER invent a product, id, name, price, or attribute that is
not in this list or in the UI context below:
${JSON.stringify(poolList)}
${sortedByPrice.length > 1
  ? `\nThe same products sorted by price, lowest first - use this directly for "the cheapest"/"the cheaper one" rather than computing it yourself:\n${JSON.stringify(sortedByPrice)}\n`
  : ""}

Current UI context (still available, in case the customer's request also
references something already on screen, not only what was just retrieved):
${JSON.stringify(uiContext)}

Rules:
- If the customer's original request is now fully satisfied by the step(s) already executed, do NOT call any tool and do NOT use the ${CLARIFY_PREFIX} prefix - just respond with a brief plain acknowledgement.
- If another tool call is genuinely still required, call exactly one tool. Its arguments must be grounded ONLY in the real products list above or the UI context - never invent a productId, name, price, or attribute, and never fabricate an order id.
- If it is ambiguous which product(s) the customer means even given the list above, do not guess - respond with exactly ${CLARIFY_PREFIX} followed by one short clarifying question naming the real options.
- Never call the same tool with the same arguments twice.
- Never call a tool just because you technically still can - stop as soon as the request is satisfied.
- Never claim a mutation (cart/order change) has already happened - you are only ever deciding what to call next, never executing it yourself.

PRODUCT ID PRECISION (for add_to_cart/update_cart_quantity/remove_from_cart):
- If the product the customer means is one of the entries in the real products list above, you MUST pass its exact "id" field as productId. Do NOT describe it with a vague/descriptive query instead (e.g. "the best one", "that one", "the first jacket") when you can already point to its exact id from the list - a descriptive query is strictly a fallback for when the intended product is genuinely NOT one of the entries above (e.g. it's only identifiable from the UI context).
- For "the cheapest"/"the cheapest one": use the price-sorted list above directly - pass the id of its FIRST entry as productId. For "the most expensive"/"the priciest": pass the id of its LAST entry. Do not compute or guess this yourself from the unsorted list, and do not fall back to a descriptive query when this list already answers it.
- For a reference to a product a comparison step already discussed (e.g. "the better one", "the one that's best for winter", "the second one you compared"), only pass a productId if the executed steps above give you a clear factual basis for which specific one that is (e.g. the comparison's own text/order, or its position). If you cannot tell which of the real ids that refers to, do not guess an id - either ask via ${CLARIFY_PREFIX} or, if truly nothing else can be done, use a plain descriptive query, never an invented id.
- Only an "id" that literally appears in the real products list above is ever valid as productId - never invent one, and never reuse an id from a different, unrelated product.

Original customer message:
${message}
`.trim();
};

// One re-plan Gemini call -> a discriminated decision. `generateContent` is
// an internal testing seam ONLY (same convention as generateRagAnswer.js) -
// defaults to the real Gemini call.
export const runReplanStep = async (promptContext, generateContent = (params) => ai.models.generateContent(params)) => {
  const promptText = buildReplanPrompt(promptContext);

  const response = await generateContent({
    model: "gemini-3.6-flash",
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    config: {
      tools: [{ functionDeclarations: assistantTools }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      thinkingConfig: { thinkingLevel: "low" },
    },
  });

  const call = extractFunctionCall(response);

  if (call) {
    if (!ALLOWED_TOOL_NAMES.has(call.name)) {
      // Defense in depth - can't actually happen since the schema handed to
      // Gemini is the same declared list, but never trust it regardless.
      return { type: "unknown" };
    }
    const sanitize = assistantToolSanitizers[call.name];
    const sanitizedArgs = sanitize(call.args || {});
    if (!sanitizedArgs) {
      return { type: "unknown" };
    }
    return { type: "tool", toolName: call.name, sanitizedArgs };
  }

  const rawReply = extractReplyText(response);
  if (rawReply.toUpperCase().startsWith(CLARIFY_PREFIX)) {
    return { type: "clarify", reply: rawReply.slice(CLARIFY_PREFIX.length).trim() };
  }

  return { type: "done" };
};

// { tool, args, message, history, uiContext } -> the existing response
// contract:
//   { success:true, tool, arguments, rag? }                          (today's shape)
//   { success:true, tool:null, reply, replyType:"clarification" }    (today's shape)
//
// `deps` is an internal testing seam only (same pattern as assistantRag.js/
// compareProducts.js) - defaults to the real functions.
export const runAgentOrchestrator = async (
  { tool, args, message, history, uiContext, buildRagFiltersForTool },
  deps = {},
) => {
  const ctx = { message, history, buildRagFiltersForTool };
  const runReplan = deps.runReplanStep || runReplanStep;

  const observedPool = new Map();
  const executed = [];
  const seenSignatures = new Set();

  const recordObservation = (toolName, toolArgs, result) => {
    (result?.sources || []).forEach((source) => {
      const id = String(source.sourceId);
      observedPool.set(id, { id, name: source.name, price: source.price ?? null });
    });
    executed.push({
      tool: toolName,
      args: toolArgs,
      grounded: Boolean(result?.grounded),
      sourceCount: (result?.sources || []).length,
    });
  };

  let lastTool = tool;
  let lastArgs = args;
  seenSignatures.add(toolCallSignature(lastTool, lastArgs));

  let lastResult;
  try {
    lastResult = await executeObservableTool(lastTool, lastArgs, ctx, deps);
  } catch (error) {
    console.error("agentOrchestrator: initial tool execution failed:", error.message);
    // Same swallow-and-return-the-tool-response-without-rag discipline the
    // pre-Module-14 code already used for a RAG/comparison failure.
    return { success: true, tool: lastTool, arguments: lastArgs };
  }
  recordObservation(lastTool, lastArgs, lastResult);

  let step = 1;
  let toolCallCount = 1;

  // PART F: an ungrounded result (zero search results / an unresolvable
  // comparison) stops the loop immediately - no re-plan call, no further
  // tool, the existing honest no-result/clarification response is what the
  // caller already returns for this shape.
  while (lastResult.grounded && step < MAX_AGENT_STEPS && toolCallCount < MAX_TOOL_CALLS) {
    const executedSummary = executed.slice();

    let replan;
    try {
      replan = await runReplan({ message, uiContext, observedPool, executedSummary }, deps.generateContent);
    } catch (error) {
      console.error("agentOrchestrator: re-plan call failed:", error.message);
      break; // fall back to the current best (already-grounded) result
    }
    step += 1;

    if (replan.type === "clarify") {
      return { success: true, tool: null, reply: replan.reply, replyType: "clarification" };
    }
    if (replan.type !== "tool") {
      break; // "done" or "unknown" - stop, current best result is final
    }

    const { toolName, sanitizedArgs } = replan;

    if (isMutationTool(toolName)) {
      // PART D/G/H: never trust a productId the re-plan step supplied
      // unless it is one this orchestration itself actually retrieved -
      // otherwise strip it so the frontend's existing resolveProductFromArgs
      // fallback (query/superlative/name match) gets a fair shot instead of
      // an unverifiable id ever reaching a cart/order mutation.
      const finalArgs = { ...sanitizedArgs };
      if (finalArgs.productId && !observedPool.has(String(finalArgs.productId))) {
        finalArgs.productId = "";
      }
      // PRECISION FIX: if the planner left productId empty/invalid (e.g. it
      // described the product in `query` instead - "the cheapest one" - even
      // though the exact product was already unambiguous) and this
      // orchestration observed exactly one real candidate, that candidate IS
      // the product - deterministic, zero-invention, no extra Gemini call.
      // Only applies to add_to_cart, the one mutation whose target is "a
      // product just retrieved/compared" rather than something already in
      // the customer's cart.
      if (toolName === "add_to_cart" && !finalArgs.productId && observedPool.size === 1) {
        finalArgs.productId = observedPool.keys().next().value;
      }
      // Never executed here - handed off exactly like a single-shot
      // request; the frontend's completely unmodified case for this tool
      // (including its own confirmation gate, if any) does the rest.
      return { success: true, tool: toolName, arguments: finalArgs };
    }

    if (isObservableTool(toolName)) {
      const signature = toolCallSignature(toolName, sanitizedArgs);
      if (seenSignatures.has(signature)) {
        break; // PART J: exact repeat detected - stop, return current best result
      }
      seenSignatures.add(signature);
      toolCallCount += 1;

      try {
        lastResult = await executeObservableTool(toolName, sanitizedArgs, ctx, deps);
      } catch (error) {
        console.error("agentOrchestrator: chained tool execution failed:", error.message);
        break; // fall back to the current best (already-grounded) result
      }
      lastTool = toolName;
      lastArgs = sanitizedArgs;
      recordObservation(lastTool, lastArgs, lastResult);
      continue;
    }

    // A read-only, non-observable tool (navigate/sort_products/open_product/
    // track_order) as the terminal action the customer asked for after
    // seeing results (e.g. "show me jackets, then open the first one") -
    // never executed here, handed off the same way a mutation is.
    return { success: true, tool: toolName, arguments: sanitizedArgs };
  }

  return { success: true, tool: lastTool, arguments: lastArgs, rag: lastResult };
};
