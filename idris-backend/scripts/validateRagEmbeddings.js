// Read-only embedding validation. Never writes anything, never calls
// Gemini. Reuses utils/rag/embeddingState.js's classification (the same
// logic scripts/syncRagEmbeddings.js uses to decide what to (re-)embed) as
// the base bucket, then layers deeper structural checks on top of the
// "ready" bucket so a document that merely *claims* embeddingStatus:
// "ready" but is actually malformed gets caught rather than trusted.
//
//   node scripts/validateRagEmbeddings.js

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import ragDocumentModel from "../models/ragDocumentModel.js";
import { classifyEmbeddingState } from "../utils/rag/embeddingState.js";
import { validateEmbeddingVector } from "../utils/rag/validateEmbeddingVector.js";
import { RAG_EMBEDDING_OUTPUT_DIMENSIONALITY } from "../utils/rag/embeddingConfig.js";

const run = async () => {
  await connectDB();

  const ragDocs = await ragDocumentModel.find().lean();
  const issues = [];

  const buckets = { ready: [], missing: [], stale: [], failed: [], invalid: [] };
  ragDocs.forEach((doc) => buckets[classifyEmbeddingState(doc)].push(doc));

  // Deep-validate every doc the cheap classifier accepted as "ready":
  // structural vector correctness (task 14, checks 1-3) and that the
  // supporting fields (checks 4-6) are actually populated, not just that
  // the status flag says so.
  const stillReady = [];
  buckets.ready.forEach((doc) => {
    const { valid, issues: vectorIssues } = validateEmbeddingVector(doc.embedding, RAG_EMBEDDING_OUTPUT_DIMENSIONALITY);
    const problems = [...vectorIssues];

    if (!doc.embeddingModel) problems.push("embeddingModel is empty.");
    if (!doc.embeddingVersion) problems.push("embeddingVersion is empty.");
    if (!doc.embeddedContentHash) problems.push("embeddedContentHash is empty.");

    if (valid && problems.length === 0) {
      stillReady.push(doc);
    } else {
      issues.push(`RAG document ${doc._id} (sourceId ${doc.sourceId}) claims embeddingStatus "ready" but is invalid: ${problems.join(" ")}`);
      buckets.invalid.push(doc);
    }
  });

  // Dimension is no longer inferred from the data - validateEmbeddingVector
  // above already checked every "ready" doc's vector against the
  // configured RAG_EMBEDDING_OUTPUT_DIMENSIONALITY, so anything that
  // disagreed was already moved into buckets.invalid.
  const finalReady = stillReady;

  buckets.stale.forEach((doc) => {
    issues.push(`RAG document ${doc._id} (sourceId ${doc.sourceId}) has a stored embedding but contentHash has changed since it was embedded - stale.`);
  });
  buckets.failed.forEach((doc) => {
    issues.push(`RAG document ${doc._id} (sourceId ${doc.sourceId}) is marked embeddingStatus "failed".`);
  });

  // sourceId uniqueness (also enforced by a unique index, but verified
  // independently here rather than trusted blindly).
  const seenSourceIds = new Set();
  ragDocs.forEach((doc) => {
    const key = String(doc.sourceId);
    if (seenSourceIds.has(key)) {
      issues.push(`sourceId ${key} is not unique across ragDocuments.`);
    }
    seenSourceIds.add(key);
  });

  console.log(`Total RAG documents: ${ragDocs.length}`);
  console.log(`Ready: ${finalReady.length}`);
  // "Pending" and "Missing" describe the same state in this system - a
  // document that has never been embedded (embeddingStatus stays at its
  // schema default of "pending" until a sync run either succeeds or fails
  // it) - both labels are printed since the spec asked for both.
  console.log(`Pending: ${buckets.missing.length}`);
  console.log(`Failed: ${buckets.failed.length}`);
  console.log(`Missing: ${buckets.missing.length}`);
  console.log(`Stale: ${buckets.stale.length}`);
  console.log(`Invalid: ${buckets.invalid.length}`);
  console.log(`Configured embedding dimension: ${RAG_EMBEDDING_OUTPUT_DIMENSIONALITY}`);

  console.log(`\n${issues.length} issue(s) found.`);
  issues.forEach((issue) => console.log(`  - ${issue}`));

  await mongoose.connection.close();
  process.exit(issues.length > 0 ? 1 : 0);
};

run().catch((error) => {
  console.error("Embedding validation failed:", error);
  process.exit(1);
});
