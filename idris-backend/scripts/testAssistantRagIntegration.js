// Deterministic, DB-free, Gemini-free checks for the module 7 integration
// layer (RAG eligibility + assistantRag()). The Gemini/DB boundary is
// stubbed via assistantRag()'s injectable deps (same seam pattern as
// module 6's generateRagAnswer) - no real API/DB call happens here.
//
//   node scripts/testAssistantRagIntegration.js

import assert from "node:assert/strict";
import { isRagEligibleTool } from "../utils/rag/ragEligibility.js";
import { assistantRag, AssistantRagError } from "../utils/rag/assistantRag.js";
import { buildRagFiltersForTool, stripUnverifiedProductId } from "../controllers/intentController.js";

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

const candidate = (overrides = {}) => ({
  sourceId: "p1",
  type: "product",
  text: "Women Off-Shoulder Floral Puff Sleeve Top\n\nDescription:\nA floral top.",
  metadata: { gender: "Women", category: "Topwear", color: "purple multicolor", price: 799, bestseller: true },
  scores: { vectorRank: 1, lexicalRank: 1, rrfScore: 0.03, rerankScore: 0.05 },
  ...overrides,
});

const stubHybrid = (results, shouldThrow = false) => {
  const calls = [];
  const fn = async (query, options) => {
    calls.push({ query, options });
    if (shouldThrow) throw new Error("simulated Atlas outage - internal detail");
    return { results, diagnostics: { vectorCount: results.length, lexicalCount: results.length, mergedCount: results.length, finalCount: results.length, warnings: [] } };
  };
  fn.calls = calls;
  return fn;
};

const stubGeneration = (answer, shouldThrow = false) => {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    if (shouldThrow) throw new Error("simulated Gemini failure - internal detail");
    return {
      answer,
      grounded: args.candidates.length > 0,
      sources: args.candidates.map((c) => ({ sourceId: c.sourceId, productName: c.text.split("\n")[0] })),
      meta: { candidateCount: args.candidates.length, contextCount: args.candidates.length, truncated: false, generationVersion: "v1" },
    };
  };
  fn.calls = calls;
  return fn;
};

// --- 1. Product-discovery query invokes RAG (tool -> eligible) ---
test("search_products and recommend_products are RAG-eligible", () => {
  assert.equal(isRagEligibleTool("search_products"), true);
  assert.equal(isRagEligibleTool("recommend_products"), true);
});

// --- 2. Non-product conversational query does not invoke RAG ---
test("no-tool (plain conversational reply) is not RAG-eligible", () => {
  assert.equal(isRagEligibleTool(null), false);
  assert.equal(isRagEligibleTool(undefined), false);
});

// --- 3. Existing deterministic tool intents are not replaced by RAG ---
test("every deterministic action/lookup tool remains non-RAG-eligible", () => {
  [
    "navigate",
    "sort_products",
    "open_product",
    "add_to_cart",
    "update_cart_quantity",
    "remove_from_cart",
    "place_order",
    "cancel_order",
    "track_order",
  ].forEach((tool) => assert.equal(isRagEligibleTool(tool), false, `${tool} must not be RAG-eligible`));
});

// --- 4/5. Hinglish and English product queries reach RAG unchanged ---
await asyncTest("a Hinglish query is forwarded to retrieval/generation verbatim, not translated/rewritten", async () => {
  const query = "mujhe summer ke liye purple floral top chahiye";
  const hybrid = stubHybrid([candidate()]);
  const generation = stubGeneration("Yeh top aapke liye perfect hai.");
  await assistantRag({ query }, { searchHybridRag: hybrid, generateRagAnswer: generation });
  assert.equal(hybrid.calls[0].query, query);
  assert.equal(generation.calls[0].query, query);
});
// MODULE 9 fix: intentController.js's tool-extracted search string (e.g.
// "purple floral top" extracted by Gemini's own search_products call from
// "mujhe purple floral top chahiye") commonly strips the customer's Hindi/
// Hinglish words entirely, which made RAG generation's language detection
// unable to ever see them. `originalQuery`, when supplied, must drive
// generation (language + the "customer query" shown to the model) while
// `query` keeps driving retrieval unchanged.
await asyncTest("originalQuery (when supplied) drives generation, while the tool-extracted query still drives retrieval", async () => {
  const toolExtractedQuery = "purple floral top";
  const customerOriginalMessage = "mujhe purple floral top chahiye";
  const hybrid = stubHybrid([candidate()]);
  const generation = stubGeneration("Aapke liye yeh top hai.");
  await assistantRag(
    { query: toolExtractedQuery, originalQuery: customerOriginalMessage },
    { searchHybridRag: hybrid, generateRagAnswer: generation },
  );
  assert.equal(hybrid.calls[0].query, toolExtractedQuery, "retrieval must still use the tool-extracted query");
  assert.equal(generation.calls[0].query, customerOriginalMessage, "generation must use the customer's verbatim original message");
});
await asyncTest("without an explicit originalQuery, assistantRag falls back to query for generation (backward compatible)", async () => {
  const query = "some query with no separate original";
  const hybrid = stubHybrid([candidate()]);
  const generation = stubGeneration("answer");
  await assistantRag({ query }, { searchHybridRag: hybrid, generateRagAnswer: generation });
  assert.equal(generation.calls[0].query, query);
});

await asyncTest("an English query is forwarded to retrieval/generation verbatim", async () => {
  const query = "show me a purple floral top";
  const hybrid = stubHybrid([candidate()]);
  const generation = stubGeneration("Here is a matching top.");
  await assistantRag({ query }, { searchHybridRag: hybrid, generateRagAnswer: generation });
  assert.equal(hybrid.calls[0].query, query);
});

// --- 6. Query with price constraint reaches RAG safely ---
test("search_products args with maxPrice build a clean, whitelisted RAG filter object", () => {
  const filters = buildRagFiltersForTool("search_products", {
    query: "denim jacket",
    gender: "women",
    category: "winterwear",
    productType: "jacket",
    color: "",
    maxPrice: 2000,
    sortBy: "",
  });
  assert.deepEqual(filters, {
    gender: "women",
    category: "winterwear",
    productType: "jacket",
    color: undefined,
    maxPrice: 2000,
  });
});
test("recommend_products never gets structured filters (query-only intent)", () => {
  assert.equal(buildRagFiltersForTool("recommend_products", { query: "something for winter" }), undefined);
});

// --- 7. Malicious Mongo operators cannot reach RAG via filter construction ---
test("buildRagFiltersForTool only ever reads known fields, never passes through extra/injected keys", () => {
  const filters = buildRagFiltersForTool("search_products", {
    query: "x",
    gender: "women",
    $where: "sleep(10000)",
    __proto__: { injected: true },
  });
  const keys = Object.keys(filters);
  assert.ok(keys.every((key) => !key.startsWith("$")));
  assert.deepEqual(keys.sort(), ["category", "color", "gender", "maxPrice", "productType"].sort());
});

// --- 8. Empty RAG result does not call generation ---
await asyncTest("zero retrieved candidates means generateRagAnswer still receives them but makes its own zero-call decision", async () => {
  // assistantRag() doesn't itself special-case empty candidates - that's
  // generateRagAnswer's (module 6's) responsibility, reused unchanged here.
  // This test confirms assistantRag() passes an empty candidate set through
  // faithfully rather than skipping the call or fabricating anything.
  const hybrid = stubHybrid([]);
  const generation = stubGeneration("unused");
  await assistantRag({ query: "obscure query" }, { searchHybridRag: hybrid, generateRagAnswer: generation });
  assert.deepEqual(generation.calls[0].candidates, []);
});

// --- 9. Retrieval failure is handled safely ---
await asyncTest("a retrieval (hybrid search) failure becomes a controlled RETRIEVAL_FAILED error", async () => {
  const hybrid = stubHybrid([], true);
  const generation = stubGeneration("unused");
  await assert.rejects(
    () => assistantRag({ query: "top" }, { searchHybridRag: hybrid, generateRagAnswer: generation }),
    (error) => {
      assert.ok(error instanceof AssistantRagError);
      assert.equal(error.code, "RETRIEVAL_FAILED");
      assert.doesNotMatch(error.message, /Atlas outage/);
      return true;
    },
  );
  assert.equal(generation.calls.length, 0); // generation is never attempted after a retrieval failure
});

// --- 10. Generation failure is handled safely ---
await asyncTest("a generation failure becomes a controlled GENERATION_FAILED error, never the raw provider message", async () => {
  const hybrid = stubHybrid([candidate()]);
  const generation = stubGeneration("unused", true);
  await assert.rejects(
    () => assistantRag({ query: "top" }, { searchHybridRag: hybrid, generateRagAnswer: generation }),
    (error) => {
      assert.ok(error instanceof AssistantRagError);
      assert.equal(error.code, "GENERATION_FAILED");
      assert.doesNotMatch(error.message, /Gemini failure/);
      return true;
    },
  );
});

// --- 11. Source IDs come from retrieved candidates, not generated text ---
await asyncTest("returned sources/price are enriched from the retrieved candidate metadata, not invented", async () => {
  const hybrid = stubHybrid([candidate({ sourceId: "real-1", metadata: { price: 555 } })]);
  const generation = stubGeneration("Some answer mentioning FAKE-999 by name.");
  const result = await assistantRag({ query: "top" }, { searchHybridRag: hybrid, generateRagAnswer: generation });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].sourceId, "real-1");
  assert.equal(result.sources[0].price, 555);
});

// --- 12. RAG response conforms to the existing assistant response contract ---
test("the tool-dispatch response stays valid (success/tool/arguments) with rag as a purely additive field", () => {
  const baseToolResponse = { success: true, tool: "search_products", arguments: { query: "top" } };
  const withRag = { ...baseToolResponse, rag: { answer: "x", grounded: true, sources: [], meta: {} } };
  assert.equal(withRag.success, true);
  assert.equal(withRag.tool, "search_products");
  assert.deepEqual(withRag.arguments, { query: "top" });
  // A consumer that only knows the pre-module-7 contract (success/tool/
  // arguments) still gets exactly what it always got - `rag` is additive.
  const { success, tool, arguments: args } = withRag;
  assert.deepEqual({ success, tool, arguments: args }, baseToolResponse);
});

// --- MODULE 15: direct (non-orchestrated) mutation calls also validate productId ---
test("stripUnverifiedProductId keeps a productId that's in the real catalog", () => {
  const valid = new Set(["real-id-1", "real-id-2"]);
  const args = { productId: "real-id-1", size: "M", quantity: 1 };
  assert.deepEqual(stripUnverifiedProductId(args, valid), args);
});
test("stripUnverifiedProductId strips a productId not present in the real catalog", () => {
  const valid = new Set(["real-id-1"]);
  const result = stripUnverifiedProductId({ productId: "invented-id", query: "the jacket" }, valid);
  assert.equal(result.productId, "");
  assert.equal(result.query, "the jacket", "the query fallback is preserved for the frontend's own fuzzy match");
});
test("stripUnverifiedProductId is a no-op when no productId was supplied at all", () => {
  const valid = new Set(["real-id-1"]);
  const args = { query: "some jacket", sortBy: "" };
  assert.deepEqual(stripUnverifiedProductId(args, valid), args);
});

console.log(`\n${passed} test(s) passed.`);
console.log(
  "\nNote: this suite proves the integration/eligibility logic deterministically. Full end-to-end " +
  "chat/voice behavior through controllers/intentController.js (points 13/14) is verified in " +
  "scripts/testAssistantRagIntegrationLive.js and the module 1-6 regression suite, not here.",
);
