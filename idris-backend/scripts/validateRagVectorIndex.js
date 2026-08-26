// Read-only verification that the Atlas Vector Search index this project
// depends on actually exists, is built, and is configured the way
// utils/rag/searchRag.js assumes. Never creates/modifies the index - see
// the module 4 report for how it was created.
//
//   node scripts/validateRagVectorIndex.js

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import ragDocumentModel from "../models/ragDocumentModel.js";
import { RAG_EMBEDDING_OUTPUT_DIMENSIONALITY } from "../utils/rag/embeddingConfig.js";
import {
  RAG_VECTOR_INDEX_NAME,
  RAG_VECTOR_SIMILARITY,
  RAG_FILTERABLE_STRING_FIELDS,
} from "../utils/rag/vectorSearchConfig.js";

const run = async () => {
  await connectDB();

  const issues = [];
  let indexes;

  try {
    indexes = await ragDocumentModel.collection.listSearchIndexes().toArray();
  } catch (error) {
    console.log("Could not query search indexes programmatically.");
    console.log(`Reason: ${error.message}`);
    console.log(
      "\nThis usually means the connected MongoDB deployment does not support Atlas Search/Vector " +
      "Search (e.g. a non-Atlas or unsupported-tier cluster). Manual verification required: log into " +
      "Atlas -> Database -> your cluster -> Search tab, and confirm a vectorSearch index named " +
      `"${RAG_VECTOR_INDEX_NAME}" exists on ragdocuments with a 768-dim cosine "embedding" vector field.`,
    );
    await mongoose.connection.close();
    process.exit(1);
    return;
  }

  const index = indexes.find((i) => i.name === RAG_VECTOR_INDEX_NAME);

  if (!index) {
    console.log(`No search index named "${RAG_VECTOR_INDEX_NAME}" exists on ragdocuments.`);
    console.log(`Indexes found: ${indexes.map((i) => i.name).join(", ") || "(none)"}`);
    await mongoose.connection.close();
    process.exit(1);
    return;
  }

  console.log(`Index "${index.name}": status=${index.status}, queryable=${index.queryable}, type=${index.type}`);

  if (index.status !== "READY" || !index.queryable) {
    issues.push(`Index status is "${index.status}" (queryable: ${index.queryable}) - not ready for queries yet.`);
  }

  const fields = index.latestDefinition?.fields || [];
  const vectorField = fields.find((f) => f.type === "vector" && f.path === "embedding");

  if (!vectorField) {
    issues.push('No vector field with path "embedding" found in the index definition.');
  } else {
    if (vectorField.numDimensions !== RAG_EMBEDDING_OUTPUT_DIMENSIONALITY) {
      issues.push(`Vector field dimension is ${vectorField.numDimensions}, expected ${RAG_EMBEDDING_OUTPUT_DIMENSIONALITY}.`);
    }
    if (vectorField.similarity !== RAG_VECTOR_SIMILARITY) {
      issues.push(`Vector field similarity is "${vectorField.similarity}", expected "${RAG_VECTOR_SIMILARITY}".`);
    }
  }

  const filterPaths = new Set(fields.filter((f) => f.type === "filter").map((f) => f.path));
  const expectedFilterPaths = [...RAG_FILTERABLE_STRING_FIELDS, "bestseller", "price"].map((f) => `metadata.${f}`);
  const missingFilterPaths = expectedFilterPaths.filter((p) => !filterPaths.has(p));

  if (missingFilterPaths.length > 0) {
    issues.push(`Missing filter field(s) in the index: ${missingFilterPaths.join(", ")}.`);
  }

  console.log(`Vector field: ${vectorField ? `path=${vectorField.path}, dims=${vectorField.numDimensions}, similarity=${vectorField.similarity}` : "MISSING"}`);
  console.log(`Filter fields present: ${[...filterPaths].join(", ") || "(none)"}`);

  console.log(`\n${issues.length} issue(s) found.`);
  issues.forEach((issue) => console.log(`  - ${issue}`));

  await mongoose.connection.close();
  process.exit(issues.length > 0 ? 1 : 0);
};

run().catch((error) => {
  console.error("Vector index validation failed:", error);
  process.exit(1);
});
