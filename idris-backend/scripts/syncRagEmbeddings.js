// Generates/refreshes embeddings for ragDocuments (see models/ragDocumentModel.js).
// Never touches the `products` collection - only reads ragDocuments.text and
// writes ragDocuments.embedding/embeddingModel/embeddingVersion/embeddingStatus/
// embeddedContentHash.
//
// A document is only (re-)embedded if it's missing, stale (contentHash/model/
// version mismatch), or previously failed - see utils/rag/embeddingState.js.
// This is the cost-control rule: an unchanged, already-current document never
// triggers a Gemini call, in dry run OR apply mode.
//
//   node scripts/syncRagEmbeddings.js            # dry run - NO Gemini calls
//   node scripts/syncRagEmbeddings.js --apply     # generates + writes

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import ragDocumentModel from "../models/ragDocumentModel.js";
import { generateEmbedding } from "../utils/rag/embedRagDocument.js";
import { classifyEmbeddingState } from "../utils/rag/embeddingState.js";
import { RAG_EMBEDDING_MODEL, RAG_EMBEDDING_VERSION } from "../utils/rag/embeddingConfig.js";

const APPLY = process.argv.includes("--apply");

// First line of buildSearchableText()'s output is always the product name -
// reused here purely for readable progress logs, no extra DB read needed.
const labelFor = (ragDoc) => (ragDoc.text || "").split("\n")[0] || String(ragDoc.sourceId);

const run = async () => {
  await connectDB();

  const ragDocs = await ragDocumentModel.find();
  const byState = { ready: [], missing: [], stale: [], failed: [], invalid: [] };

  ragDocs.forEach((doc) => byState[classifyEmbeddingState(doc)].push(doc));

  const toProcess = [...byState.missing, ...byState.stale, ...byState.failed];

  console.log(`Total RAG documents: ${ragDocs.length}`);
  console.log(`Ready/current: ${byState.ready.length}`);
  console.log(`Needs embedding: ${byState.missing.length}`);
  console.log(`Needs re-embedding: ${byState.stale.length}`);
  console.log(`Failed (will retry): ${byState.failed.length}`);
  console.log(`Invalid (no text, cannot attempt): ${byState.invalid.length}`);
  console.log(`Potential API calls: ${toProcess.length}`);

  byState.invalid.forEach((doc) => console.log(`  invalid: sourceId ${doc.sourceId} has no text.`));

  if (!APPLY) {
    console.log(`\nDry run only - no Gemini calls made, no database writes. Re-run with --apply to process ${toProcess.length} document(s).`);
    await mongoose.connection.close();
    return;
  }

  if (toProcess.length === 0) {
    console.log("\nNothing to embed.");
    await mongoose.connection.close();
    return;
  }

  console.log(`\nEmbedding ${toProcess.length} document(s) using ${RAG_EMBEDDING_MODEL} (${RAG_EMBEDDING_VERSION})...\n`);

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i += 1) {
    const doc = toProcess[i];
    const progress = `[${i + 1}/${toProcess.length}]`;

    try {
      // generateEmbedding validates the vector against the configured
      // dimension (utils/rag/embeddingConfig.js) itself and throws if the
      // API response doesn't match - no separate cross-document dimension
      // tracking needed here now that the dimension is explicitly fixed
      // rather than inferred at runtime.
      const vector = await generateEmbedding(doc.text);

      doc.embedding = vector;
      doc.embeddingModel = RAG_EMBEDDING_MODEL;
      doc.embeddingVersion = RAG_EMBEDDING_VERSION;
      doc.embeddingStatus = "ready";
      doc.embeddedContentHash = doc.contentHash;
      await doc.save();

      succeeded += 1;
      console.log(`${progress} Embedded ${labelFor(doc)}`);
    } catch (error) {
      failed += 1;
      // Only the status is touched - any previously-stored embedding array
      // (even if stale) is left exactly as it was. This document's failure
      // has no effect on any other document.
      doc.embeddingStatus = "failed";
      await doc.save();
      console.log(`${progress} FAILED ${labelFor(doc)} (sourceId ${doc.sourceId}): ${error.message}`);
    }
  }

  console.log(`\nSucceeded: ${succeeded}`);
  console.log(`Skipped (already current): ${byState.ready.length}`);
  console.log(`Failed: ${failed}`);

  await mongoose.connection.close();
};

run().catch((error) => {
  console.error("RAG embedding sync failed:", error);
  process.exit(1);
});
