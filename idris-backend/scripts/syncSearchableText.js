// Recomputes searchableText for every product from its current structured
// fields via the canonical buildSearchableText() and writes back only the
// products whose stored value has drifted (e.g. after buildSearchableText's
// own output format changes, or a direct DB edit bypassed the controllers).
// Idempotent: a second run finds nothing to change.
//
//   node scripts/syncSearchableText.js            # dry run (default)
//   node scripts/syncSearchableText.js --apply     # writes to the DB

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import { buildSearchableText } from "../utils/buildSearchableText.js";

const APPLY = process.argv.includes("--apply");

const run = async () => {
  await connectDB();

  const products = await mongoose.connection.db.collection("products").find({}).toArray();
  const stale = products
    .map((product) => ({ product, next: buildSearchableText(product) }))
    .filter(({ product, next }) => product.searchableText !== next);

  console.log(`${products.length} product(s) total.`);
  console.log(`${stale.length} with stale searchableText.\n`);

  const operations = stale.map(({ product, next }) => {
    console.log(`- ${product.name} (${product._id})`);
    return {
      updateOne: {
        filter: { _id: product._id },
        update: { $set: { searchableText: next } },
      },
    };
  });

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
  console.error("Sync failed:", error);
  process.exit(1);
});
