// One-off migration: category/subCategory/color/size -> gender/category/
// productType/color/sizes + new AI-semantic fields + searchableText.
//
// Default mode is a DRY RUN: prints a per-product before/after diff, writes
// nothing. Pass --apply to actually perform the writes.
//
//   node scripts/migrateProductSchemaV2.js            # dry run (default)
//   node scripts/migrateProductSchemaV2.js --apply     # writes to the DB
//
// Safe to re-run: a product that has already been migrated (no `subCategory`
// key left) is skipped.

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import productModel from "../models/productModel.js";
import { buildSearchableText } from "../utils/buildSearchableText.js";
import { inferProductAttributes } from "../utils/inferProductAttributes.js";

const APPLY = process.argv.includes("--apply");

const buildUpdatedDoc = (doc) => {
  const inferred = inferProductAttributes(doc.name);

  const updated = {
    ...doc,
    gender: doc.category,
    category: doc.subCategory,
    productType: inferred.productType,
    material: inferred.material,
    fit: inferred.fit,
    pattern: inferred.pattern,
    color: (doc.color || "").toLowerCase().trim(),
    sizes: doc.size || [],
    features: [],
    occasions: [],
    seasons: [],
    style: [],
  };
  updated.searchableText = buildSearchableText(updated);

  return updated;
};

const run = async () => {
  await connectDB();

  // Read raw (not through the new Mongoose schema, which no longer declares
  // subCategory/size) so the old field values are still visible.
  const rawProducts = await mongoose.connection.db
    .collection("products")
    .find({})
    .toArray();

  const alreadyMigrated = rawProducts.filter((doc) => doc.subCategory === undefined);
  const toMigrate = rawProducts.filter((doc) => doc.subCategory !== undefined);

  console.log(`${rawProducts.length} product(s) total.`);
  console.log(`${alreadyMigrated.length} already migrated (skipped).`);
  console.log(`${toMigrate.length} to migrate.\n`);

  const operations = [];

  for (const doc of toMigrate) {
    const updated = buildUpdatedDoc(doc);

    console.log(`- ${doc.name} (${doc._id})`);
    console.log(`    gender: "${doc.category}" -> category(gender field): "${updated.gender}"`);
    console.log(`    category: "${doc.subCategory}" -> "${updated.category}"`);
    console.log(`    productType: "" -> "${updated.productType}"`);
    console.log(`    material: "" -> "${updated.material}"`);
    console.log(`    fit: "" -> "${updated.fit}"`);
    console.log(`    pattern: "" -> "${updated.pattern}"`);
    console.log(`    color: "${doc.color || ""}" -> "${updated.color}"`);
    console.log(`    sizes: ${JSON.stringify(doc.size || [])}`);

    operations.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            gender: updated.gender,
            category: updated.category,
            productType: updated.productType,
            material: updated.material,
            fit: updated.fit,
            pattern: updated.pattern,
            color: updated.color,
            sizes: updated.sizes,
            features: updated.features,
            occasions: updated.occasions,
            seasons: updated.seasons,
            style: updated.style,
            searchableText: updated.searchableText,
          },
          $unset: { subCategory: "", size: "" },
        },
      },
    });
  }

  if (!APPLY) {
    console.log(`\nDry run only - no writes made. Re-run with --apply to write ${operations.length} update(s).`);
  } else if (operations.length > 0) {
    const result = await mongoose.connection.db.collection("products").bulkWrite(operations);
    console.log(`\nApplied. Matched ${result.matchedCount}, modified ${result.modifiedCount}.`);
  } else {
    console.log("\nNothing to apply.");
  }

  await mongoose.connection.close();
};

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
