// Deterministic, DB-free, Gemini-free checks for hybrid recall/fusion/
// reranking logic. No live Atlas Search, no live vector search, no Gemini
// call - see scripts/testHybridRetrievalLive.js for that.
//
//   node scripts/testHybridRetrieval.js

import assert from "node:assert/strict";
import { computeRRFScore } from "../utils/rag/computeRRFScore.js";
import { mergeRagCandidates } from "../utils/rag/mergeRagCandidates.js";
import { computeRerankBoost, rerankRagCandidates } from "../utils/rag/rerankRagCandidates.js";
import { tokenizeQuery } from "../utils/rag/queryTokenize.js";
import { detectPriceIntent, priceSatisfiesIntent } from "../utils/rag/priceIntent.js";
import { RAG_RERANK_MAX_BOOST_FRACTION, RAG_HYBRID_FINAL_LIMIT } from "../utils/rag/hybridSearchConfig.js";
import { clampFinalLimit, shapeHybridResult } from "../utils/rag/hybridSearchRag.js";
import { RAG_LEXICAL_RESULT_PROJECTION } from "../utils/rag/lexicalSearchRag.js";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const product = (overrides = {}) => ({
  sourceId: "p1",
  type: "product",
  text: "Women Off-Shoulder Floral Puff Sleeve Top\n\nGender: Women.\nCategory: Topwear.\nProduct type: Top.\nColor: purple multicolor.\nMaterial: Cotton.\nPattern: Floral.",
  metadata: {
    gender: "Women",
    category: "Topwear",
    productType: "Top",
    color: "purple multicolor",
    material: "Cotton",
    fit: "Regular",
    pattern: "Floral",
    features: ["Off-the-shoulder", "Short puff sleeves"],
    occasions: ["Casual"],
    seasons: ["Summer", "Spring"],
    style: ["Casual"],
    sizes: ["S", "M", "L"],
    price: 799,
    bestseller: false,
  },
  ...overrides,
});

// --- 1. RRF score calculation ---
test("RRF score calculation matches 1/(k+rank) summed across lists", () => {
  const k = 60;
  assert.equal(computeRRFScore(1, null, k), 1 / 61);
  assert.equal(computeRRFScore(null, 1, k), 1 / 61);
  assert.equal(computeRRFScore(1, 4, k), 1 / 61 + 1 / 64);
  assert.equal(computeRRFScore(null, null, k), 0);
});

// --- 2/3. Candidate merging + deduplication ---
test("candidates are merged and deduplicated by sourceId (not name/position)", () => {
  const vectorResults = [
    { sourceId: "a", type: "product", text: "A", metadata: {}, score: 0.9 },
    { sourceId: "b", type: "product", text: "B", metadata: {}, score: 0.8 },
  ];
  const lexicalResults = [
    { sourceId: "b", type: "product", text: "B", metadata: {}, lexicalScore: 5 },
    { sourceId: "c", type: "product", text: "C", metadata: {}, lexicalScore: 4 },
  ];
  const merged = mergeRagCandidates(vectorResults, lexicalResults);
  assert.equal(merged.length, 3);
  const ids = merged.map((c) => c.sourceId).sort();
  assert.deepEqual(ids, ["a", "b", "c"]);
});

// --- 4. Candidate only in vector results ---
test("a candidate present only in vector results keeps a null lexicalRank", () => {
  const merged = mergeRagCandidates(
    [{ sourceId: "a", type: "product", text: "A", metadata: {}, score: 0.9 }],
    [],
  );
  assert.equal(merged[0].vectorRank, 1);
  assert.equal(merged[0].lexicalRank, null);
});

// --- 5. Candidate only in lexical results ---
test("a candidate present only in lexical results keeps a null vectorRank", () => {
  const merged = mergeRagCandidates(
    [],
    [{ sourceId: "a", type: "product", text: "A", metadata: {}, lexicalScore: 3 }],
  );
  assert.equal(merged[0].lexicalRank, 1);
  assert.equal(merged[0].vectorRank, null);
});

// --- 6. Candidate in both ---
test("a candidate present in both keeps both ranking signals", () => {
  const merged = mergeRagCandidates(
    [{ sourceId: "a", type: "product", text: "A", metadata: {}, score: 0.9 }],
    [{ sourceId: "a", type: "product", text: "A", metadata: {}, lexicalScore: 3 }],
  );
  assert.equal(merged[0].vectorRank, 1);
  assert.equal(merged[0].lexicalRank, 1);
  assert.equal(merged[0].vectorScore, 0.9);
  assert.equal(merged[0].lexicalScore, 3);
});

// --- 7. Exact product name boost ---
test("a query matching the product name gets exactPhraseMatch/nameTokenMatch boosts", () => {
  const tokens = tokenizeQuery("purple floral top");
  const { boost, matched } = computeRerankBoost(product(), "purple floral top", tokens, null);
  assert.ok(boost > 0);
  assert.ok(matched.some((m) => m.startsWith("nameTokenMatch")));
});

// --- 8. Product type boost ---
test("a query naming the product type gets productTypeMatch", () => {
  const tokens = tokenizeQuery("nice top for evening");
  const { matched } = computeRerankBoost(product(), "nice top for evening", tokens, null);
  assert.ok(matched.includes("productTypeMatch"));
});

// --- 9. Color boost (substring, not exact equality) ---
test("\"purple\" matches metadata color \"purple multicolor\" via substring, not exact equality", () => {
  const tokens = tokenizeQuery("purple top");
  const { matched } = computeRerankBoost(product(), "purple top", tokens, null);
  assert.ok(matched.includes("colorMatch"));
});

// --- 10. Material boost ---
test("a query mentioning the material gets materialMatch", () => {
  const tokens = tokenizeQuery("cotton top");
  const { matched } = computeRerankBoost(product(), "cotton top", tokens, null);
  assert.ok(matched.includes("materialMatch"));
});

// --- 11. Pattern boost ---
test("a query mentioning the pattern gets patternMatch", () => {
  const tokens = tokenizeQuery("floral top");
  const { matched } = computeRerankBoost(product(), "floral top", tokens, null);
  assert.ok(matched.includes("patternMatch"));
});

// --- 12. Price constraint ranking ---
test("a satisfied explicit price constraint boosts, a violated one penalizes", () => {
  const intent = detectPriceIntent("top under 1000");
  assert.deepEqual(intent, { minPrice: null, maxPrice: 1000 });

  const cheap = product({ metadata: { ...product().metadata, price: 799 } });
  const expensive = product({ metadata: { ...product().metadata, price: 5000 } });

  const cheapResult = computeRerankBoost(cheap, "top under 1000", tokenizeQuery("top under 1000"), intent);
  const expensiveResult = computeRerankBoost(expensive, "top under 1000", tokenizeQuery("top under 1000"), intent);

  assert.ok(cheapResult.matched.includes("priceSatisfied"));
  assert.ok(expensiveResult.matched.includes("priceViolated"));
  assert.ok(cheapResult.boost > expensiveResult.boost);
});
test("priceSatisfiesIntent returns null (not true/false) when there is no known price", () => {
  const intent = detectPriceIntent("top under 1000");
  assert.equal(priceSatisfiesIntent(undefined, intent), null);
  assert.equal(priceSatisfiesIntent(NaN, intent), null);
});

// --- 13. Score bounds ---
test("the total boost is always bounded to +/- RAG_RERANK_MAX_BOOST_FRACTION", () => {
  // A product matching essentially everything about an elaborate query -
  // still must not exceed the documented cap.
  const everything = product({
    metadata: {
      gender: "Women",
      category: "Topwear",
      productType: "Top",
      color: "purple multicolor",
      material: "Cotton",
      fit: "Regular",
      pattern: "Floral",
      features: ["Off-the-shoulder"],
      occasions: ["Casual"],
      seasons: ["Summer"],
      style: ["Casual"],
      sizes: ["S"],
      price: 100,
      bestseller: true,
    },
  });
  const query = "purple floral cotton casual summer top bestseller under 200 Women Off-Shoulder Floral Puff Sleeve Top";
  const { boost } = computeRerankBoost(everything, query, tokenizeQuery(query), detectPriceIntent("under 200"));
  assert.ok(boost <= RAG_RERANK_MAX_BOOST_FRACTION);
  assert.ok(boost >= -RAG_RERANK_MAX_BOOST_FRACTION);
});

// --- 14. Final result limit ---
test("the final result limit is bounded to [1, RAG_HYBRID_FINAL_LIMIT]", () => {
  assert.equal(clampFinalLimit(undefined), RAG_HYBRID_FINAL_LIMIT);
  assert.equal(clampFinalLimit(0), 1);
  assert.equal(clampFinalLimit(-5), 1);
  assert.equal(clampFinalLimit(1000), RAG_HYBRID_FINAL_LIMIT);
  assert.equal(clampFinalLimit(3), 3);
});

// --- 15. Query normalization (tokenizer) ---
test("the tokenizer lowercases, strips punctuation, and preserves meaningful Hinglish terms", () => {
  const tokens = tokenizeQuery("mujhe summer ke liye purple floral top chahiye!!");
  ["summer", "purple", "floral", "top", "mujhe", "chahiye"].forEach((word) => {
    assert.ok(tokens.includes(word), `expected "${word}" to survive tokenization`);
  });
});
test("the tokenizer removes common English stop words but not product terms", () => {
  const tokens = tokenizeQuery("a top for the summer");
  assert.ok(!tokens.includes("a"));
  assert.ok(!tokens.includes("for"));
  assert.ok(!tokens.includes("the"));
  assert.ok(tokens.includes("top"));
  assert.ok(tokens.includes("summer"));
});

// --- 16. Malformed input handling ---
test("malformed/empty input does not throw", () => {
  assert.deepEqual(mergeRagCandidates(), []);
  assert.deepEqual(mergeRagCandidates(undefined, undefined), []);
  assert.deepEqual(tokenizeQuery(null), []);
  assert.deepEqual(tokenizeQuery(undefined), []);
  assert.equal(detectPriceIntent(""), null);
  assert.equal(detectPriceIntent(null), null);
  assert.deepEqual(rerankRagCandidates([], "anything"), []);
});

// --- 17. No embedding in final output ---
test("neither the lexical projection nor the shaped hybrid result ever includes embedding", () => {
  assert.equal("embedding" in RAG_LEXICAL_RESULT_PROJECTION, false);

  const candidate = { ...product(), vectorRank: 1, lexicalRank: 2, rrfScore: 0.02, rerankScore: 0.03 };
  const shaped = shapeHybridResult(candidate);
  assert.equal("embedding" in shaped, false);
  assert.deepEqual(Object.keys(shaped).sort(), ["metadata", "scores", "sourceId", "text", "type"]);
});

// --- 18. Deterministic ranking ---
test("reranking the same candidates with the same query twice produces identical order and scores", () => {
  const candidates = [
    { ...product({ sourceId: "a" }), rrfScore: 0.02 },
    { ...product({ sourceId: "b", metadata: { ...product().metadata, color: "black" } }), rrfScore: 0.018 },
  ];
  const query = "purple floral top";
  const run1 = rerankRagCandidates(candidates, query);
  const run2 = rerankRagCandidates(candidates, query);
  assert.deepEqual(
    run1.map((c) => [c.sourceId, c.rerankScore]),
    run2.map((c) => [c.sourceId, c.rerankScore]),
  );
});

console.log(`\n${passed} test(s) passed.`);
console.log(
  "\nNote: live Atlas Search + vector search execution (parallel recall, real merge/RRF/rerank " +
  "against the 44-product catalog) is verified in scripts/testHybridRetrievalLive.js, not here.",
);
