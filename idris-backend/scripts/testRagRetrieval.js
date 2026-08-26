// Deterministic, DB-free, Gemini-free checks for the retrieval layer's
// validation/sanitization/bounding logic. No live Gemini call, no live
// MongoDB query - see scripts/testRagRetrievalLive.js for that.
//
//   node scripts/testRagRetrieval.js

import assert from "node:assert/strict";
import { normalizeRagQuery } from "../utils/rag/embedRagQuery.js";
import { validateEmbeddingVector } from "../utils/rag/validateEmbeddingVector.js";
import {
  RAG_EMBEDDING_MODEL,
  RAG_EMBEDDING_QUERY_TASK_TYPE,
  RAG_EMBEDDING_OUTPUT_DIMENSIONALITY,
} from "../utils/rag/embeddingConfig.js";
import {
  clampSearchLimit,
  computeNumCandidates,
  sanitizeRagFilters,
  RAG_RESULT_PROJECTION,
} from "../utils/rag/searchRag.js";
import {
  RAG_SEARCH_LIMIT_MIN,
  RAG_SEARCH_LIMIT_MAX,
  RAG_SEARCH_LIMIT_DEFAULT,
  RAG_SEARCH_NUM_CANDIDATES_MAX,
} from "../utils/rag/vectorSearchConfig.js";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

// --- 1. Empty query is rejected ---
test("empty query is rejected", () => {
  assert.throws(() => normalizeRagQuery(""), /must not be empty/i);
  assert.throws(() => normalizeRagQuery("   "), /must not be empty/i);
});

// --- 2. Oversized query is rejected ---
test("oversized query is rejected", () => {
  const huge = "a".repeat(10_000);
  assert.throws(() => normalizeRagQuery(huge), /too long/i);
});

// --- 3. Query normalization works ---
test("query normalization trims and collapses whitespace without rewriting words", () => {
  assert.equal(normalizeRagQuery("  purple   floral   top  "), "purple floral top");
  assert.equal(
    normalizeRagQuery("mujhe summer ke liye purple floral top chahiye"),
    "mujhe summer ke liye purple floral top chahiye",
  );
});
test("non-string query is rejected", () => {
  assert.throws(() => normalizeRagQuery(null), /must be a string/i);
  assert.throws(() => normalizeRagQuery(42), /must be a string/i);
});

// --- 4. Query embedding configuration ---
test("query embedding configuration uses the correct model, RETRIEVAL_QUERY, and 768 dimensions", () => {
  assert.equal(RAG_EMBEDDING_MODEL, "gemini-embedding-2");
  assert.equal(RAG_EMBEDDING_QUERY_TASK_TYPE, "RETRIEVAL_QUERY");
  assert.equal(RAG_EMBEDDING_OUTPUT_DIMENSIONALITY, 768);
});

// --- 5. Invalid query vector is rejected ---
test("a query vector of the wrong dimension is rejected", () => {
  const { valid, issues } = validateEmbeddingVector(new Array(100).fill(0.1), RAG_EMBEDDING_OUTPUT_DIMENSIONALITY);
  assert.equal(valid, false);
  assert.ok(issues.some((issue) => issue.includes("dimension")));
});
test("a query vector with a NaN element is rejected", () => {
  const vector = new Array(RAG_EMBEDDING_OUTPUT_DIMENSIONALITY).fill(0.1);
  vector[10] = NaN;
  const { valid } = validateEmbeddingVector(vector, RAG_EMBEDDING_OUTPUT_DIMENSIONALITY);
  assert.equal(valid, false);
});

// --- 6. Limit is bounded ---
test("limit is bounded between 1 and 20, defaulting to 8", () => {
  assert.equal(clampSearchLimit(undefined), RAG_SEARCH_LIMIT_DEFAULT);
  assert.equal(clampSearchLimit(0), RAG_SEARCH_LIMIT_MIN);
  assert.equal(clampSearchLimit(-5), RAG_SEARCH_LIMIT_MIN);
  assert.equal(clampSearchLimit(1000), RAG_SEARCH_LIMIT_MAX);
  assert.equal(clampSearchLimit(5), 5);
  assert.equal(clampSearchLimit("not a number"), RAG_SEARCH_LIMIT_DEFAULT);
});

// --- 7. numCandidates is bounded ---
test("numCandidates scales with limit but is capped", () => {
  assert.equal(computeNumCandidates(1), 20);
  assert.equal(computeNumCandidates(8), 160);
  assert.ok(computeNumCandidates(20) <= RAG_SEARCH_NUM_CANDIDATES_MAX);
  assert.equal(computeNumCandidates(20), RAG_SEARCH_NUM_CANDIDATES_MAX);
});

// --- 8. Unsupported filter fields are rejected ---
test("unsupported filter fields are silently dropped, not passed through", () => {
  const result = sanitizeRagFilters({ gender: "women", notARealField: "x", description: "hack" });
  assert.deepEqual(Object.keys(result), ["metadata.gender"]);
});

// --- 9. Arbitrary MongoDB operators cannot be injected ---
test("arbitrary Mongo operators in the filter object are never copied through", () => {
  const malicious = {
    gender: "women",
    $where: "sleep(10000)",
    $expr: { $gt: ["$price", 0] },
    "metadata.price": { $ne: null },
    __proto__: { injected: true },
  };
  const result = sanitizeRagFilters(malicious);
  const keys = Object.keys(result);
  assert.ok(keys.every((key) => !key.startsWith("$")));
  assert.deepEqual(keys, ["metadata.gender"]);
});
test("non-object filters (arrays, strings, null) produce an empty filter", () => {
  assert.deepEqual(sanitizeRagFilters(null), {});
  assert.deepEqual(sanitizeRagFilters(undefined), {});
  assert.deepEqual(sanitizeRagFilters(["gender", "women"]), {});
  assert.deepEqual(sanitizeRagFilters("women"), {});
});
test("string filter values are normalized to match stored casing (Title Case, color lowercase)", () => {
  assert.deepEqual(sanitizeRagFilters({ gender: "WOMEN" }), { "metadata.gender": "Women" });
  assert.deepEqual(sanitizeRagFilters({ productType: "t-shirt" }), { "metadata.productType": "T-Shirt" });
  assert.deepEqual(sanitizeRagFilters({ color: "PURPLE" }), { "metadata.color": "purple" });
});
test("price filters translate to a bounded $gte/$lte range, not raw operators from the caller", () => {
  assert.deepEqual(sanitizeRagFilters({ minPrice: 100, maxPrice: 500 }), {
    "metadata.price": { $gte: 100, $lte: 500 },
  });
  // A caller cannot smuggle its own operator in under minPrice/maxPrice -
  // only Number() coercion of the value is ever used.
  assert.deepEqual(sanitizeRagFilters({ minPrice: { $gt: 0 } }), {});
});
test("bestseller filter only accepts an actual boolean", () => {
  assert.deepEqual(sanitizeRagFilters({ bestseller: true }), { "metadata.bestseller": true });
  assert.deepEqual(sanitizeRagFilters({ bestseller: "true" }), {});
});

// --- 10. Embedding field is never returned in retrieval results ---
test("the result projection never includes the embedding field", () => {
  assert.equal("embedding" in RAG_RESULT_PROJECTION, false);
  assert.deepEqual(Object.keys(RAG_RESULT_PROJECTION).sort(), ["_id", "metadata", "score", "sourceId", "text", "type"]);
});

console.log(`\n${passed} test(s) passed.`);
console.log(
  "\nNote: actual query embedding + live $vectorSearch execution (including that a real result " +
  "never carries an embedding array) is verified in scripts/testRagRetrievalLive.js, not here.",
);
