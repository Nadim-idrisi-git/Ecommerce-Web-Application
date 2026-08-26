// Deterministic, DB-free, Gemini-free checks for the embedding pipeline's
// decision logic and vector validation. Actual Gemini calls are exercised
// by scripts/syncRagEmbeddings.js --apply, not here.
//
//   node scripts/testEmbeddingPipeline.js

import assert from "node:assert/strict";
import { classifyEmbeddingState, isEmbeddingCurrent, needsEmbedding } from "../utils/rag/embeddingState.js";
import { validateEmbeddingVector } from "../utils/rag/validateEmbeddingVector.js";
import {
  RAG_EMBEDDING_MODEL,
  RAG_EMBEDDING_VERSION,
  RAG_EMBEDDING_OUTPUT_DIMENSIONALITY,
} from "../utils/rag/embeddingConfig.js";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const vectorOfLength = (length) => Array.from({ length }, (_, i) => (i % 10) / 10);

const baseDoc = {
  text: "Some product text",
  contentHash: "hash-abc",
  embedding: vectorOfLength(RAG_EMBEDDING_OUTPUT_DIMENSIONALITY),
  embeddingModel: RAG_EMBEDDING_MODEL,
  embeddingVersion: RAG_EMBEDDING_VERSION,
  embeddingStatus: "ready",
  embeddedContentHash: "hash-abc",
};

test("missing embedding is detected", () => {
  const doc = { text: "x", contentHash: "h", embeddingStatus: "pending" };
  assert.equal(classifyEmbeddingState(doc), "missing");
  assert.equal(needsEmbedding(doc), true);
});

test("current embedding is skipped", () => {
  assert.equal(isEmbeddingCurrent(baseDoc), true);
  assert.equal(classifyEmbeddingState(baseDoc), "ready");
  assert.equal(needsEmbedding(baseDoc), false);
});

test("model mismatch requires re-embedding", () => {
  const doc = { ...baseDoc, embeddingModel: "some-older-model" };
  assert.equal(isEmbeddingCurrent(doc), false);
  assert.equal(classifyEmbeddingState(doc), "stale");
  assert.equal(needsEmbedding(doc), true);
});

test("version mismatch requires re-embedding", () => {
  const doc = { ...baseDoc, embeddingVersion: "v0" };
  assert.equal(isEmbeddingCurrent(doc), false);
  assert.equal(classifyEmbeddingState(doc), "stale");
  assert.equal(needsEmbedding(doc), true);
});

test("embeddedContentHash mismatch requires re-embedding", () => {
  const doc = { ...baseDoc, contentHash: "hash-xyz" };
  assert.equal(isEmbeddingCurrent(doc), false);
  assert.equal(classifyEmbeddingState(doc), "stale");
  assert.equal(needsEmbedding(doc), true);
});

test("a previously failed document is retried, not treated as ready", () => {
  const doc = { text: "x", contentHash: "h", embeddingStatus: "failed" };
  assert.equal(classifyEmbeddingState(doc), "failed");
  assert.equal(needsEmbedding(doc), true);
});

test("a document with no text at all cannot be attempted", () => {
  const doc = { text: "", contentHash: "h", embeddingStatus: "pending" };
  assert.equal(classifyEmbeddingState(doc), "invalid");
  assert.equal(needsEmbedding(doc), false);
});

test("valid vector passes validation", () => {
  const { valid, issues } = validateEmbeddingVector([0.1, -0.2, 3.4]);
  assert.equal(valid, true, issues.join(" "));
});

test("empty vector fails", () => {
  const { valid, issues } = validateEmbeddingVector([]);
  assert.equal(valid, false);
  assert.ok(issues.some((issue) => issue.includes("empty")));
});

test("NaN fails", () => {
  const { valid, issues } = validateEmbeddingVector([0.1, NaN, 0.3]);
  assert.equal(valid, false);
  assert.ok(issues.some((issue) => issue.includes("embedding[1]")));
});

test("Infinity fails", () => {
  const { valid, issues } = validateEmbeddingVector([0.1, Infinity, 0.3]);
  assert.equal(valid, false);
  assert.ok(issues.some((issue) => issue.includes("embedding[1]")));
});

test("non-number element fails", () => {
  const { valid, issues } = validateEmbeddingVector([0.1, "0.2", 0.3]);
  assert.equal(valid, false);
  assert.ok(issues.some((issue) => issue.includes("embedding[1]")));
});

test("dimension mismatch against an expected dimension fails", () => {
  const { valid, issues } = validateEmbeddingVector([0.1, 0.2], 3);
  assert.equal(valid, false);
  assert.ok(issues.some((issue) => issue.includes("dimension")));
});

// --- MODULE 3 correction: 3072 -> 768 explicit output dimension ---

test("configured dimension is 768", () => {
  assert.equal(RAG_EMBEDDING_OUTPUT_DIMENSIONALITY, 768);
});

test("a vector with exactly the configured dimension passes", () => {
  const { valid, issues } = validateEmbeddingVector(vectorOfLength(768), RAG_EMBEDDING_OUTPUT_DIMENSIONALITY);
  assert.equal(valid, true, issues.join(" "));
});

test("a vector with the wrong dimension (e.g. the old 3072 default) is rejected", () => {
  const { valid, issues } = validateEmbeddingVector(vectorOfLength(3072), RAG_EMBEDDING_OUTPUT_DIMENSIONALITY);
  assert.equal(valid, false);
  assert.ok(issues.some((issue) => issue.includes("dimension 3072, expected 768")));
});

test("an old 3072-dimensional embedding (pre-correction v1) is detected as stale", () => {
  const oldDoc = {
    ...baseDoc,
    embedding: vectorOfLength(3072),
    embeddingVersion: "v1", // the version this catalog actually had before the correction
  };
  assert.equal(isEmbeddingCurrent(oldDoc), false);
  assert.equal(classifyEmbeddingState(oldDoc), "stale");
  assert.equal(needsEmbedding(oldDoc), true);
});

test("a 3072-dim vector tagged with the CURRENT version string is still rejected (dimension check alone catches it)", () => {
  // Defense in depth: even if a document's version/model strings somehow
  // matched, a vector of the wrong dimension must never be trusted.
  const doc = { ...baseDoc, embedding: vectorOfLength(3072) };
  assert.equal(isEmbeddingCurrent(doc), false);
});

test("the new 768-dimensional embedding (current version) is considered ready", () => {
  const doc = { ...baseDoc, embedding: vectorOfLength(768), embeddingVersion: RAG_EMBEDDING_VERSION };
  assert.equal(isEmbeddingCurrent(doc), true);
  assert.equal(classifyEmbeddingState(doc), "ready");
  assert.equal(needsEmbedding(doc), false);
});

test("changing the embedding version (as this correction did, v1 -> v2) triggers re-embedding even with matching hash/model", () => {
  const preCorrection = { ...baseDoc, embedding: vectorOfLength(3072), embeddingVersion: "v1" };
  const postCorrection = { ...baseDoc, embedding: vectorOfLength(768), embeddingVersion: "v2" };
  assert.equal(needsEmbedding(preCorrection), true);
  assert.equal(needsEmbedding(postCorrection), false);
});

console.log(`\n${passed} test(s) passed.`);
console.log(
  "\nNote: \"rerunning the sync performs zero additional Gemini calls\" is verified live " +
  "(scripts/syncRagEmbeddings.js talks to the real API), not here - see the correction report.",
);
