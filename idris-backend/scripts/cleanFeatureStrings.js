// One-off cleanup: some products got their `features` array populated by
// pasting a JSON-array-formatted string (e.g. ["Square neckline", "3/4 puff
// sleeves"]) into the admin's comma-separated Features field. The naive
// comma-split kept the literal brackets/quotes on the boundary elements,
// e.g. ["Square neckline"  ->  each array entry needs those stripped.
//
//   node scripts/cleanFeatureStrings.js            # dry run (default)
//   node scripts/cleanFeatureStrings.js --apply     # writes to the DB

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import { buildSearchableText } from "../utils/buildSearchableText.js";

const APPLY = process.argv.includes("--apply");

const cleanFeature = (raw) =>
  String(raw)
    .trim()
    .replace(/^\[+/, "")
    .replace(/\]+$/, "")
    .trim()
    .replace(/^["']+/, "")
    .replace(/["']+$/, "")
    .trim();

const needsCleaning = (features) =>
  Array.isArray(features) && features.some((item) => /[[\]"]/.test(item));

const run = async () => {
  await connectDB();

  const docs = await mongoose.connection.db
    .collection("products")
    .find({ features: { $exists: true, $ne: [] } })
    .toArray();

  const toClean = docs.filter((doc) => needsCleaning(doc.features));

  console.log(`${docs.length} product(s) with non-empty features.`);
  console.log(`${toClean.length} need cleaning.\n`);

  const operations = [];

  for (const doc of toClean) {
    const cleaned = doc.features.map(cleanFeature).filter(Boolean);
    const searchableText = buildSearchableText({ ...doc, features: cleaned });

    console.log(`- ${doc.name} (${doc._id})`);
    console.log(`    before: ${JSON.stringify(doc.features)}`);
    console.log(`    after:  ${JSON.stringify(cleaned)}`);

    operations.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { features: cleaned, searchableText } },
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
  console.error("Cleanup failed:", error);
  process.exit(1);
});
