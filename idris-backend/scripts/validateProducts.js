// Read-only health check for the product catalog. Runs
// utils/validateProductData.js against every product in the DB and prints
// a report. Never writes anything - see scripts/syncSearchableText.js or
// scripts/cleanFeatureStrings.js if a repair is actually needed.
//
//   node scripts/validateProducts.js

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import { validateProductData } from "../utils/validateProductData.js";

const run = async () => {
  await connectDB();

  const products = await mongoose.connection.db.collection("products").find({}).toArray();

  let invalidCount = 0;

  for (const product of products) {
    const { valid, issues } = validateProductData(product);
    if (!valid) {
      invalidCount += 1;
      console.log(`- ${product.name} (${product._id})`);
      issues.forEach((issue) => console.log(`    ${issue}`));
    }
  }

  console.log(`\n${products.length} product(s) checked.`);
  console.log(`${products.length - invalidCount} valid, ${invalidCount} with issues.`);

  await mongoose.connection.close();
  process.exit(invalidCount > 0 ? 1 : 0);
};

run().catch((error) => {
  console.error("Validation failed:", error);
  process.exit(1);
});
