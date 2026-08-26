// Read-only consistency check between `products` and `ragDocuments`. Never
// writes anything - see scripts/syncRagDocuments.js for the write path.
//
//   node scripts/validateRagDocuments.js

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import productModel from "../models/productModel.js";
import ragDocumentModel from "../models/ragDocumentModel.js";
import { buildRagDocument } from "../utils/rag/buildRagDocument.js";

const arraysEqual = (a = [], b = []) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

const metadataEqual = (a, b) =>
  a.gender === b.gender &&
  a.category === b.category &&
  a.productType === b.productType &&
  a.color === b.color &&
  a.material === b.material &&
  a.fit === b.fit &&
  a.pattern === b.pattern &&
  a.price === b.price &&
  a.bestseller === b.bestseller &&
  arraysEqual(a.features, b.features) &&
  arraysEqual(a.occasions, b.occasions) &&
  arraysEqual(a.seasons, b.seasons) &&
  arraysEqual(a.style, b.style) &&
  arraysEqual(a.sizes, b.sizes);

const run = async () => {
  await connectDB();

  const products = await productModel.find().lean();
  const ragDocs = await ragDocumentModel.find().lean();

  const productById = new Map(products.map((product) => [String(product._id), product]));
  const ragBySourceId = new Map();
  const issues = [];

  for (const doc of ragDocs) {
    const key = String(doc.sourceId);

    if (ragBySourceId.has(key)) {
      issues.push(`sourceId ${key} is not unique - multiple RAG documents reference it.`);
    }
    ragBySourceId.set(key, doc);

    if (doc.type !== "product") {
      issues.push(`RAG document ${doc._id} has type "${doc.type}", expected "product".`);
    }

    const product = productById.get(key);
    if (!product) {
      issues.push(`RAG document ${doc._id} (sourceId ${key}) has no matching product - orphan.`);
      continue;
    }

    const expected = buildRagDocument(product);

    if (doc.text !== expected.text) {
      issues.push(`RAG document for "${product.name}" (${key}): text does not match buildSearchableText(product).`);
    }
    if (doc.contentHash !== expected.contentHash) {
      issues.push(`RAG document for "${product.name}" (${key}): contentHash is stale.`);
    }
    if (!metadataEqual(doc.metadata || {}, expected.metadata)) {
      issues.push(`RAG document for "${product.name}" (${key}): metadata does not match the product's structured fields.`);
    }
  }

  const missing = products.filter((product) => !ragBySourceId.has(String(product._id)));
  missing.forEach((product) => {
    issues.push(`Product "${product.name}" (${product._id}) has no RAG document yet.`);
  });

  const withEmbedding = ragDocs.filter((doc) => Array.isArray(doc.embedding) && doc.embedding.length > 0).length;

  console.log(`Products: ${products.length}`);
  console.log(`RAG documents: ${ragDocs.length}`);
  console.log(`Products without a RAG document: ${missing.length}`);
  console.log(`RAG documents already carrying an embedding (informational only): ${withEmbedding}`);
  console.log(`\n${issues.length} issue(s) found.`);
  issues.forEach((issue) => console.log(`  - ${issue}`));

  await mongoose.connection.close();
  process.exit(issues.length > 0 ? 1 : 0);
};

run().catch((error) => {
  console.error("Validation failed:", error);
  process.exit(1);
});
