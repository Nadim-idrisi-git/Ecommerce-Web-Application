// MODULE 14 — deterministic, DB-free, Gemini-free checks for the bounded
// multi-step agent orchestrator (utils/agentOrchestrator.js). The Gemini/
// retrieval/comparison boundary is stubbed via injectable deps (same seam
// pattern as testAssistantRagIntegration.js/testCompareProducts.js) - no
// real API/DB call happens here.
//
//   node scripts/testAgentOrchestrator.js

import assert from "node:assert/strict";
import {
  runAgentOrchestrator,
  runReplanStep,
  buildReplanPrompt,
  toolCallSignature,
  isObservableTool,
  isMutationTool,
  MAX_AGENT_STEPS,
  MAX_TOOL_CALLS,
} from "../utils/agentOrchestrator.js";
import { assistantToolSanitizers } from "../utils/assistantToolSanitizers.js";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};
const asyncTest = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const ID_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const ID_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const ID_C = "cccccccccccccccccccccccc";

const ragResult = (sources, grounded = true, answer = "answer") => ({
  answer,
  grounded,
  sources,
  meta: {},
});

const source = (id, name, price) => ({ sourceId: id, name, price });

const passthroughFilters = (toolName, args) => ({ query: args.query });
const stubPlan = (args) => ({ retrievalQuery: args.originalQuery, ...args });

// A scripted re-plan stub: an ordered queue of decisions to return, one per
// call. Records every prompt context it was called with for assertions.
const scriptedReplan = (decisions) => {
  const calls = [];
  let i = 0;
  const fn = async (promptContext) => {
    calls.push(promptContext);
    const decision = decisions[i] || { type: "done" };
    i += 1;
    return decision;
  };
  fn.calls = calls;
  return fn;
};

const baseCtx = (overrides = {}) => ({
  tool: "search_products",
  args: { query: "black jacket" },
  message: "black jacket dikhao",
  history: [],
  uiContext: { page: "collection", visibleProducts: [] },
  buildRagFiltersForTool: passthroughFilters,
  ...overrides,
});

// ============================================================
// 1. Single-tool passthrough (test 1)
// ============================================================

await asyncTest("single-tool request (search only, replan says done): shape matches today's exact contract", async () => {
  const rag = ragResult([source(ID_A, "Black Jacket", 999)]);
  const assistantRagFake = async () => rag;
  const replan = scriptedReplan([{ type: "done" }]);

  const result = await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replan,
  });

  assert.deepEqual(result, { success: true, tool: "search_products", arguments: { query: "black jacket" }, rag });
  assert.equal(replan.calls.length, 1); // exactly one re-plan call attempted
});

// ============================================================
// 2. Two-step search -> add_to_cart (test 2, 15, 16)
// ============================================================

await asyncTest("search -> add_to_cart: cheapest resolved product id is handed off, never executed here", async () => {
  const rag = ragResult([source(ID_A, "Jacket A", 1500), source(ID_B, "Jacket B", 900)]);
  const assistantRagFake = async () => rag;
  const replan = scriptedReplan([
    { type: "tool", toolName: "add_to_cart", sanitizedArgs: { productId: ID_B, query: "", size: "", quantity: 1, autoSelectSize: false } },
  ]);

  const result = await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replan,
  });

  assert.equal(result.tool, "add_to_cart");
  assert.equal(result.arguments.productId, ID_B); // real, observed id preserved
  assert.equal(result.rag, undefined); // mutation hand-off never carries rag
  assert.equal(result.success, true);
  // Structurally: no execution/confirmation claim of any kind in the payload.
  assert.deepEqual(Object.keys(result).sort(), ["arguments", "success", "tool"]);
});

await asyncTest("planner cannot invent a product id (test 15): an id NOT in the observed pool is stripped", async () => {
  // Two real candidates - deliberately NOT one, so this isolates the
  // invented-id-rejection behavior from the single-candidate auto-resolve
  // fallback (which has its own dedicated tests below and correctly only
  // fires when exactly one real candidate exists).
  const rag = ragResult([source(ID_A, "Jacket A", 1500), source(ID_B, "Jacket B", 900)]);
  const assistantRagFake = async () => rag;
  const invented = "ffffffffffffffffffffffff";
  const replan = scriptedReplan([
    { type: "tool", toolName: "add_to_cart", sanitizedArgs: { productId: invented, query: "some jacket", size: "", quantity: 1, autoSelectSize: false } },
  ]);

  const result = await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replan,
  });

  assert.equal(result.arguments.productId, "", "an unverifiable id must never reach the frontend");
  assert.equal(result.arguments.query, "some jacket", "the query fallback is preserved so the frontend's own fuzzy match can still work");
});

await asyncTest("planner cannot use a product outside current context (test 16): an id from a DIFFERENT, unobserved product is stripped", async () => {
  const rag = ragResult([source(ID_A, "Jacket A", 1500), source(ID_B, "Jacket B", 900)]);
  const assistantRagFake = async () => rag;
  // ID_C was never retrieved this orchestration - even though it's a
  // well-formed id, it must not be trusted.
  const replan = scriptedReplan([
    { type: "tool", toolName: "add_to_cart", sanitizedArgs: { productId: ID_C, query: "", size: "", quantity: 1, autoSelectSize: false } },
  ]);

  const result = await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replan,
  });

  assert.equal(result.arguments.productId, "");
});

// ============================================================
// PRECISION FIX — the planner must prefer an exact observed productId over
// a vague descriptive query whenever the product is already identifiable
// from observedPool, and a single-candidate result is auto-resolved
// deterministically even if the planner still described it in text.
// ============================================================

await asyncTest("cheapest: a well-instructed planner's exact productId (from the price-sorted list) is preserved, not replaced by query", async () => {
  const rag = ragResult([source(ID_A, "Jacket A", 1500), source(ID_B, "Jacket B", 900), source(ID_C, "Jacket C", 2000)]);
  const assistantRagFake = async () => rag;
  // A correctly-instructed planner reads the price-sorted list and passes
  // the id of its FIRST (cheapest) entry directly - ID_B (900).
  const replan = scriptedReplan([
    { type: "tool", toolName: "add_to_cart", sanitizedArgs: { productId: ID_B, query: "", size: "", quantity: 1, autoSelectSize: false } },
  ]);

  const result = await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replan,
  });

  assert.equal(result.arguments.productId, ID_B);
  assert.equal(result.arguments.query, "");
});

await asyncTest("most expensive: a well-instructed planner's exact productId (from the price-sorted list) is preserved", async () => {
  const rag = ragResult([source(ID_A, "Jacket A", 1500), source(ID_B, "Jacket B", 900), source(ID_C, "Jacket C", 2000)]);
  const assistantRagFake = async () => rag;
  // Cheapest/most-expensive resolution is the planner's job (guided by the
  // price-sorted list in the prompt) - here it correctly names the most
  // expensive entry, ID_C (2000), by its real id.
  const replan = scriptedReplan([
    { type: "tool", toolName: "add_to_cart", sanitizedArgs: { productId: ID_C, query: "", size: "", quantity: 1, autoSelectSize: false } },
  ]);

  const result = await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replan,
  });

  assert.equal(result.arguments.productId, ID_C);
});

await asyncTest("comparison-derived selection ('the better one for winter'): the compared productId is preferred over a descriptive query", async () => {
  const searchRag = ragResult([source(ID_A, "Jacket A", 1500), source(ID_B, "Jacket B", 900)]);
  const compareRag = ragResult([source(ID_A, "Jacket A", 1500), source(ID_B, "Jacket B", 900)], true, "Jacket B is better for winter (fleece).");
  const assistantRagFake = async () => searchRag;
  const compareProductsFake = async () => compareRag;
  // A well-instructed planner has enough factual basis (the comparison's own
  // answer named Jacket B as better for winter) to pass its exact id.
  const replan = scriptedReplan([
    { type: "tool", toolName: "compare_products", sanitizedArgs: { productIds: [ID_A, ID_B], query: "which is better for winter" } },
    { type: "tool", toolName: "add_to_cart", sanitizedArgs: { productId: ID_B, query: "", size: "", quantity: 1, autoSelectSize: false } },
  ]);

  const result = await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    compareProducts: compareProductsFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replan,
  });

  assert.equal(result.tool, "add_to_cart");
  assert.equal(result.arguments.productId, ID_B);
});

await asyncTest("single observed candidate: an empty productId (planner used a descriptive query instead) is auto-resolved deterministically", async () => {
  // Reproduces the exact live-observed imprecision: search narrows to ONE
  // real product, and the planner describes it in `query` ("the cheapest
  // black jacket under 2000") rather than reusing its own id. Since there is
  // only one real candidate, it is unambiguous - resolved without any extra
  // Gemini call or invention.
  const rag = ragResult([source(ID_A, "Men Hooded Puffer Vest Jacket", 290)]);
  const assistantRagFake = async () => rag;
  const replan = scriptedReplan([
    { type: "tool", toolName: "add_to_cart", sanitizedArgs: { productId: "", query: "cheapest black jacket under 2000", size: "", quantity: 1, autoSelectSize: false } },
  ]);

  const result = await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replan,
  });

  assert.equal(result.arguments.productId, ID_A, "the single real observed candidate must be used, not left empty");
});

await asyncTest("single observed candidate auto-resolve does NOT apply to non-add_to_cart mutations (update_cart_quantity/remove_from_cart target the cart, not the search result)", async () => {
  const rag = ragResult([source(ID_A, "Jacket A", 1500)]);
  const assistantRagFake = async () => rag;
  const replan = scriptedReplan([
    { type: "tool", toolName: "update_cart_quantity", sanitizedArgs: { productId: "", query: "the jacket", size: "", quantity: 2 } },
  ]);

  const result = await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replan,
  });

  assert.equal(result.arguments.productId, "", "auto-resolve is scoped to add_to_cart only - update_cart_quantity must still rely on the frontend's cart-lookup fallback");
});

await asyncTest("descriptive query fallback still works when no exact observed productId is available (multiple candidates, no id given)", async () => {
  const rag = ragResult([source(ID_A, "Jacket A", 1500), source(ID_B, "Jacket B", 900), source(ID_C, "Jacket C", 2000)]);
  const assistantRagFake = async () => rag;
  const replan = scriptedReplan([
    { type: "tool", toolName: "add_to_cart", sanitizedArgs: { productId: "", query: "the one with the best reviews", size: "", quantity: 1, autoSelectSize: false } },
  ]);

  const result = await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replan,
  });

  // 3 real candidates - not unambiguous, so no auto-resolve; the descriptive
  // query is preserved unchanged for the frontend's existing fallback.
  assert.equal(result.arguments.productId, "");
  assert.equal(result.arguments.query, "the one with the best reviews");
});

await asyncTest("invented productId is still rejected/stripped even with the precision fix in place", async () => {
  const rag = ragResult([source(ID_A, "Jacket A", 1500), source(ID_B, "Jacket B", 900)]);
  const assistantRagFake = async () => rag;
  const invented = "ffffffffffffffffffffffff";
  const replan = scriptedReplan([
    { type: "tool", toolName: "add_to_cart", sanitizedArgs: { productId: invented, query: "", size: "", quantity: 1, autoSelectSize: false } },
  ]);

  const result = await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replan,
  });

  // 2 real candidates (not a single unambiguous one), and the supplied id is
  // fake - must be stripped to empty, never silently substituted.
  assert.equal(result.arguments.productId, "");
});

test("buildReplanPrompt explicitly instructs the planner to prefer an exact observed productId over a descriptive query", () => {
  const observedPool = new Map([
    [ID_A, { id: ID_A, name: "Jacket A", price: 1500 }],
    [ID_B, { id: ID_B, name: "Jacket B", price: 900 }],
  ]);
  const prompt = buildReplanPrompt({
    message: "add the cheapest to cart",
    uiContext: {},
    observedPool,
    executedSummary: [{ tool: "search_products", args: {}, grounded: true, sourceCount: 2 }],
  });
  assert.match(prompt, /PRODUCT ID PRECISION/i);
  assert.match(prompt, /must pass its exact "id"/i);
  assert.match(prompt, /do not fall back to a descriptive query/i);
  assert.match(prompt, /price-sorted list/i);
});

// ============================================================
// 3. Search -> comparison workflow (test 3)
// ============================================================

await asyncTest("search -> compare_products: chained observable tool executes and is returned", async () => {
  const searchRag = ragResult([source(ID_A, "Jacket A", 1500), source(ID_B, "Jacket B", 900)]);
  const compareRag = ragResult([source(ID_A, "Jacket A", 1500), source(ID_B, "Jacket B", 900)], true, "Jacket B is cheaper.");
  const assistantRagFake = async () => searchRag;
  const compareProductsFake = async () => compareRag;
  const replan = scriptedReplan([
    { type: "tool", toolName: "compare_products", sanitizedArgs: { productIds: [ID_A, ID_B], query: "which is better" } },
  ]);

  const result = await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    compareProducts: compareProductsFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replan,
  });

  assert.equal(result.tool, "compare_products");
  assert.deepEqual(result.rag, compareRag);
});

// ============================================================
// 4/22. Search -> comparison -> cart (test 4, 22 - follow-up/multi-tool)
// ============================================================

await asyncTest("search -> compare -> add_to_cart: full 3-step chain, terminal handoff carries the compared product's real id", async () => {
  const searchRag = ragResult([source(ID_A, "Jacket A", 1500), source(ID_B, "Jacket B", 900), source(ID_C, "Jacket C", 2000)]);
  const compareRag = ragResult([source(ID_A, "Jacket A", 1500), source(ID_B, "Jacket B", 900)], true, "Jacket B is better for winter.");
  let searchCalls = 0;
  let compareCalls = 0;
  const assistantRagFake = async () => { searchCalls += 1; return searchRag; };
  const compareProductsFake = async () => { compareCalls += 1; return compareRag; };
  const replan = scriptedReplan([
    { type: "tool", toolName: "compare_products", sanitizedArgs: { productIds: [ID_A, ID_B], query: "compare these two" } },
    // "second wale ko cart mein daal do" - resolved by the planner against the
    // compare step's own observed pool (ID_B), not invented.
    { type: "tool", toolName: "add_to_cart", sanitizedArgs: { productId: ID_B, query: "", size: "", quantity: 1, autoSelectSize: false } },
  ]);

  const result = await runAgentOrchestrator(
    baseCtx({ message: "winter ke liye black jackets dikhao, dono mein se best batao aur second wale ko cart mein daal do" }),
    { assistantRag: assistantRagFake, compareProducts: compareProductsFake, buildShoppingQueryPlan: stubPlan, runReplanStep: replan },
  );

  assert.equal(searchCalls, 1);
  assert.equal(compareCalls, 1);
  assert.equal(result.tool, "add_to_cart");
  assert.equal(result.arguments.productId, ID_B);
  assert.equal(replan.calls.length, 2);
});

// ============================================================
// 5. Zero-result search stops correctly (Part F)
// ============================================================

await asyncTest("zero search results (test 5): stops immediately, no re-plan call, no further tool", async () => {
  const rag = ragResult([], false, "I couldn't find any matching products.");
  const assistantRagFake = async () => rag;
  const replan = scriptedReplan([{ type: "tool", toolName: "compare_products", sanitizedArgs: { productIds: [ID_A, ID_B] } }]);

  const result = await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replan,
  });

  assert.equal(result.rag.grounded, false);
  assert.equal(replan.calls.length, 0, "must never re-plan from an ungrounded result");
});

// ============================================================
// 6. Insufficient comparison stops correctly (Part F)
// ============================================================

await asyncTest("comparison with insufficient products (test 6): stops immediately, no further tool attempted", async () => {
  const compareRag = ragResult([], false, "I need at least two products to compare.");
  const compareProductsFake = async () => compareRag;
  const replan = scriptedReplan([{ type: "tool", toolName: "add_to_cart", sanitizedArgs: { productId: ID_A } }]);

  const result = await runAgentOrchestrator(
    baseCtx({ tool: "compare_products", args: { productIds: [ID_A] } }),
    { compareProducts: compareProductsFake, runReplanStep: replan },
  );

  assert.equal(result.rag.grounded, false);
  assert.equal(replan.calls.length, 0);
});

// ============================================================
// 7. Ambiguous reference triggers clarification (test 7)
// ============================================================

await asyncTest("ambiguous follow-up reference (test 7): re-plan clarification is returned in today's exact shape", async () => {
  const rag = ragResult([source(ID_A, "Jacket A", 1500), source(ID_B, "Jacket B", 900), source(ID_C, "Jacket C", 2000)]);
  const assistantRagFake = async () => rag;
  const replan = scriptedReplan([{ type: "clarify", reply: "Which one would you like to add - Jacket A, B, or C?" }]);

  const result = await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replan,
  });

  assert.deepEqual(result, {
    success: true,
    tool: null,
    reply: "Which one would you like to add - Jacket A, B, or C?",
    replyType: "clarification",
  });
});

// ============================================================
// 8/9. runReplanStep: invalid tool name rejected / malformed args sanitized (test 8, 9)
// ============================================================

await asyncTest("runReplanStep: an unknown/undeclared function name is never treated as a valid tool call", async () => {
  const fakeGenerate = async () => ({
    functionCalls: [{ name: "delete_all_products", args: { confirm: true } }],
  });
  const decision = await runReplanStep({ message: "x", uiContext: {}, observedPool: new Map(), executedSummary: [] }, fakeGenerate);
  assert.equal(decision.type, "unknown");
});

await asyncTest("runReplanStep: malformed tool arguments go through the REAL sanitizer, not a bypass", async () => {
  // quantity: -5 must be rejected/normalized by the real add_to_cart sanitizer
  // (assistantToolSanitizers.js), reused unchanged here - not faked.
  const fakeGenerate = async () => ({
    functionCalls: [{ name: "add_to_cart", args: { productId: ID_A, quantity: -5 } }],
  });
  const decision = await runReplanStep({ message: "x", uiContext: {}, observedPool: new Map(), executedSummary: [] }, fakeGenerate);
  assert.equal(decision.type, "tool");
  assert.equal(decision.toolName, "add_to_cart");
  // Real sanitizer clamps an invalid quantity to 1, exactly as it already does today.
  assert.equal(decision.sanitizedArgs.quantity, 1);
  assert.equal(assistantToolSanitizers.add_to_cart({ productId: ID_A, quantity: -5 }).quantity, 1, "sanity: matches the real sanitizer directly");
});

await asyncTest("runReplanStep: a function call whose args the real sanitizer rejects entirely becomes 'unknown'", async () => {
  // update_cart_quantity's sanitizer returns null when quantity is missing/invalid AND no productId/query.
  const fakeGenerate = async () => ({
    functionCalls: [{ name: "update_cart_quantity", args: { quantity: -1 } }],
  });
  const decision = await runReplanStep({ message: "x", uiContext: {}, observedPool: new Map(), executedSummary: [] }, fakeGenerate);
  assert.equal(decision.type, "unknown");
});

// ============================================================
// 10/11. Hard limits enforced (test 10, 11)
// ============================================================

await asyncTest("MAX_AGENT_STEPS is enforced: an infinitely-chaining planner is cut off, never loops forever", async () => {
  let searchCalls = 0;
  const assistantRagFake = async (params) => {
    searchCalls += 1;
    return ragResult([source(ID_A, "A", 100 + searchCalls)]);
  };
  // Always proposes a DIFFERENT search_products call so it's never caught by
  // loop detection - this isolates the step-limit specifically.
  let n = 0;
  const replan = { calls: [] };
  replan.fn = async (ctx) => {
    replan.calls.push(ctx);
    n += 1;
    return { type: "tool", toolName: "search_products", sanitizedArgs: { query: `variant ${n}` } };
  };

  const result = await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replan.fn,
  });

  assert.ok(replan.calls.length <= MAX_AGENT_STEPS, `re-plan calls (${replan.calls.length}) must never exceed MAX_AGENT_STEPS (${MAX_AGENT_STEPS})`);
  assert.equal(result.success, true); // still returns a safe final result, never throws/hangs
});

await asyncTest("MAX_TOOL_CALLS is enforced: server-executed observable tool calls are capped", async () => {
  let executions = 0;
  const assistantRagFake = async () => {
    executions += 1;
    return ragResult([source(ID_A, "A", executions)]);
  };
  let n = 0;
  const replanFn = async () => {
    n += 1;
    return { type: "tool", toolName: "search_products", sanitizedArgs: { query: `variant ${n}` } };
  };

  await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replanFn,
  });

  assert.ok(executions <= MAX_TOOL_CALLS, `executions (${executions}) must never exceed MAX_TOOL_CALLS (${MAX_TOOL_CALLS})`);
});

// ============================================================
// 12. Repeated tool/state loop detected (test 12, Part J)
// ============================================================

await asyncTest("an exact repeated tool+args call is detected and stops the loop instead of re-executing", async () => {
  let searchExecutions = 0;
  let compareExecutions = 0;
  const assistantRagFake = async () => {
    searchExecutions += 1;
    return ragResult([source(ID_A, "A", 100), source(ID_B, "B", 200)]);
  };
  const compareProductsFake = async () => {
    compareExecutions += 1;
    return ragResult([source(ID_A, "A", 100), source(ID_B, "B", 200)], true, "A vs B");
  };
  const repeatedArgs = { productIds: [ID_A, ID_B] };
  const replan = scriptedReplan([
    // First chained call: genuinely new (initial call was search_products) - must execute.
    { type: "tool", toolName: "compare_products", sanitizedArgs: repeatedArgs },
    // Second: the EXACT same tool+args just executed - must be detected and skipped.
    { type: "tool", toolName: "compare_products", sanitizedArgs: { ...repeatedArgs } },
  ]);

  const result = await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    compareProducts: compareProductsFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replan,
  });

  assert.equal(searchExecutions, 1, "the initial search executes once");
  assert.equal(compareExecutions, 1, "compare executes once for the genuinely new call, never for the repeat");
  assert.equal(result.tool, "compare_products", "the loop stops on the repeat and returns the last genuinely-executed result");
});

test("toolCallSignature is stable regardless of key order (loop detection can't be trivially evaded)", () => {
  const a = toolCallSignature("compare_products", { productIds: [ID_A, ID_B], query: "x" });
  const b = toolCallSignature("compare_products", { query: "x", productIds: [ID_A, ID_B] });
  assert.equal(a, b);
});

// ============================================================
// 13/14. Mutation confirmation gate cannot be bypassed / failed mutation never fabricated as success
// ============================================================

test("isMutationTool/isObservableTool partition the 10 declared tools exactly as expected - no overlap, no gaps for mutations", () => {
  const mutations = ["add_to_cart", "update_cart_quantity", "remove_from_cart", "place_order", "cancel_order"];
  mutations.forEach((t) => assert.equal(isMutationTool(t), true));
  mutations.forEach((t) => assert.equal(isObservableTool(t), false));
  ["search_products", "recommend_products", "compare_products"].forEach((t) => {
    assert.equal(isObservableTool(t), true);
    assert.equal(isMutationTool(t), false);
  });
});

await asyncTest("a mutation hand-off is a plain {success, tool, arguments} - never a fabricated success/confirmation claim", async () => {
  const rag = ragResult([source(ID_A, "Jacket A", 999)]);
  const assistantRagFake = async () => rag;
  const replan = scriptedReplan([
    { type: "tool", toolName: "place_order", sanitizedArgs: {} },
  ]);

  const result = await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replan,
  });

  assert.equal(result.tool, "place_order");
  assert.deepEqual(Object.keys(result).sort(), ["arguments", "success", "tool"]);
  // No "message"/"orderId"/"confirmed" field of any kind - the orchestrator
  // never itself claims an order was placed; place_order's own existing
  // yes/no confirmation gate (beginPlaceOrder in AIAssistant.jsx) is
  // untouched and is what actually executes/confirms it, client-side.
});

await asyncTest("a tool execution failure never fabricates success - it degrades to the pre-Module-14 swallow behavior", async () => {
  const assistantRagFake = async () => {
    throw new Error("simulated Atlas outage - internal detail");
  };
  const replan = scriptedReplan([]); // must never even be reached
  const result = await runAgentOrchestrator(baseCtx(), {
    assistantRag: assistantRagFake,
    buildShoppingQueryPlan: stubPlan,
    runReplanStep: replan,
  });
  assert.equal(result.success, true); // tool response contract preserved
  assert.equal(result.rag, undefined); // no fabricated grounded answer
  assert.equal(replan.calls.length, 0);
});

// ============================================================
// 18/19/20/21. Language + multi-constraint pass-through
// ============================================================

await asyncTest("Hindi message is threaded through to the underlying plan/generation call unchanged", async () => {
  const message = "मुझे काली जैकेट चाहिए";
  let seenOriginalQuery = null;
  const buildPlanFake = (params) => { seenOriginalQuery = params.originalQuery; return stubPlan(params); };
  const assistantRagFake = async () => ragResult([source(ID_A, "Jacket", 500)]);
  await runAgentOrchestrator(baseCtx({ message, args: { query: "black jacket" } }), {
    assistantRag: assistantRagFake,
    buildShoppingQueryPlan: buildPlanFake,
    runReplanStep: scriptedReplan([{ type: "done" }]),
  });
  assert.equal(seenOriginalQuery, message);
});

await asyncTest("Hinglish message is threaded through unchanged", async () => {
  const message = "mujhe black jacket 2000 ke andar chahiye";
  let seenOriginalQuery = null;
  const buildPlanFake = (params) => { seenOriginalQuery = params.originalQuery; return stubPlan(params); };
  await runAgentOrchestrator(baseCtx({ message, args: { query: "black jacket", maxPrice: 2000 } }), {
    assistantRag: async () => ragResult([source(ID_A, "Jacket", 1200)]),
    buildShoppingQueryPlan: buildPlanFake,
    runReplanStep: scriptedReplan([{ type: "done" }]),
  });
  assert.equal(seenOriginalQuery, message);
});

await asyncTest("English multi-constraint search args (gender/color/maxPrice) all reach buildRagFiltersForTool intact (test 21)", async () => {
  let seenArgs = null;
  const filtersFake = (toolName, args) => { seenArgs = args; return {}; };
  await runAgentOrchestrator(
    baseCtx({
      message: "show me black jackets for men under 2000",
      args: { query: "jacket", gender: "men", color: "black", maxPrice: 2000 },
      buildRagFiltersForTool: filtersFake,
    }),
    {
      assistantRag: async () => ragResult([source(ID_A, "Jacket", 1200)]),
      buildShoppingQueryPlan: stubPlan,
      runReplanStep: scriptedReplan([{ type: "done" }]),
    },
  );
  assert.deepEqual(seenArgs, { query: "jacket", gender: "men", color: "black", maxPrice: 2000 });
});

// ============================================================
// buildReplanPrompt structure (supports test 15/16's "never invent" instruction)
// ============================================================

test("buildReplanPrompt never omits the never-invent instruction and includes only real observed products", () => {
  const observedPool = new Map([[ID_A, { id: ID_A, name: "Jacket A", price: 999 }]]);
  const prompt = buildReplanPrompt({
    message: "add the cheapest to cart",
    uiContext: {},
    observedPool,
    executedSummary: [{ tool: "search_products", args: {}, grounded: true, sourceCount: 1 }],
  });
  assert.match(prompt, /never invent/i);
  assert.match(prompt, new RegExp(ID_A));
  assert.doesNotMatch(prompt, /ffffffffffffffffffffffff/);
});

console.log(`\n${passed} test(s) passed.`);
console.log(
  "\nNote: this suite proves the orchestration/loop/safety logic deterministically with injected " +
  "fakes. The full live workflow matrix (through the real detectAIIntent(), including the spec's own " +
  "two worked Hindi/Hinglish examples) is verified in scripts/testAgentOrchestratorLive.js, not here. " +
  "Existing Module 1-13 regression (243 tests) is re-run separately, not duplicated here.",
);
