// Builds/refreshes the ragDocuments collection from the current `products`
// collection (source of truth). Also detects RAG documents whose product
// no longer exists (orphans) and removes them.
//
// Never touches Product documents - only creates/updates/deletes in
// ragDocuments.
//
//   node scripts/syncRagDocuments.js            # dry run (default)
//   node scripts/syncRagDocuments.js --apply     # writes to the DB

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import productModel from "../models/productModel.js";
import ragDocumentModel from "../models/ragDocumentModel.js";
import { buildRagDocument } from "../utils/rag/buildRagDocument.js";
import { validateProductData } from "../utils/validateProductData.js";

const APPLY = process.argv.includes("--apply");

const run = async () => {
  await connectDB();

  const products = await productModel.find().lean();
  const existingRagDocs = await ragDocumentModel.find().lean();
  const existingBySourceId = new Map(existingRagDocs.map((doc) => [String(doc.sourceId), doc]));
  const productIds = new Set(products.map((product) => String(product._id)));

  const toCreate = [];
  const toUpdate = [];
  let unchanged = 0;
  let invalid = 0;

  for (const product of products) {
    const { valid, issues } = validateProductData(product);
    if (!valid) {
      invalid += 1;
      console.log(`- SKIPPED (invalid product data): ${product.name} (${product._id})`);
      issues.forEach((issue) => console.log(`    ${issue}`));
      continue;
    }

    const ragDoc = buildRagDocument(product);
    const existing = existingBySourceId.get(String(product._id));

    if (!existing) {
      toCreate.push(ragDoc);
    } else if (existing.contentHash !== ragDoc.contentHash) {
      toUpdate.push(ragDoc);
    } else {
      unchanged += 1;
    }
  }

  const orphans = existingRagDocs.filter((doc) => !productIds.has(String(doc.sourceId)));

  console.log(`\nTotal products: ${products.length}`);
  console.log(`Created: ${toCreate.length}`);
  console.log(`Updated: ${toUpdate.length}`);
  console.log(`Unchanged: ${unchanged}`);
  console.log(`Missing/invalid: ${invalid}`);

  console.log(`\nOrphan RAG documents found: ${orphans.length}`);
  orphans.forEach((doc) => console.log(`    sourceId ${doc.sourceId} (no matching product)`));

  if (!APPLY) {
    console.log(
      `\nDry run only - no writes made. Re-run with --apply to create ${toCreate.length}, ` +
      `update ${toUpdate.length}, and remove ${orphans.length} orphan document(s).`,
    );
    await mongoose.connection.close();
    return;
  }

  if (toCreate.length > 0) {
    await ragDocumentModel.insertMany(toCreate);
  }

  if (toUpdate.length > 0) {
    await ragDocumentModel.bulkWrite(
      toUpdate.map((doc) => ({
        updateOne: {
          filter: { sourceId: doc.sourceId },
          update: { $set: doc },
        },
      })),
    );
  }

  let orphansRemoved = 0;
  if (orphans.length > 0) {
    const result = await ragDocumentModel.deleteMany({
      _id: { $in: orphans.map((doc) => doc._id) },
    });
    orphansRemoved = result.deletedCount || 0;
  }

  console.log(`\nApplied. Created ${toCreate.length}, updated ${toUpdate.length}, orphans removed ${orphansRemoved}.`);

  await mongoose.connection.close();
};

run().catch((error) => {
  console.error("RAG document sync failed:", error);
  process.exit(1);
});
