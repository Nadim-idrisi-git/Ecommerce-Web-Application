// Small deterministic retrieval benchmark. Every expectedSourceId below was
// read directly from the live ragdocuments collection (not guessed/invented)
// by querying for products whose gender/productType/color/material/pattern
// metadata uniquely identifies them - see the module 4 report for how each
// was found. This does NOT prove the retrieval system is "accurate" from a
// handful of queries; it reports what actually happened, honestly, on a
// 44-product catalog.
//
//   node scripts/benchmarkRagRetrieval.js

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import { searchRag } from "../utils/rag/searchRag.js";

const BENCHMARK = [
  {
    query: "purple floral women's top",
    expectedSourceId: "6a0b8111e5e588d56912103a", // Women Off-Shoulder Floral Puff Sleeve Top
  },
  {
    query: "men's solid white cotton t-shirt",
    expectedSourceId: "6a0b862550f304f37558c6e4", // Men Solid Round Neck Slim Fit T-Shirt
  },
  {
    query: "women's denim jacket",
    expectedSourceId: "6a0b89e450f304f37558c6f2", // Women Washed Cropped Denim Jacket
  },
  {
    query: "floral dress for girls",
    expectedSourceId: "6a0b8208e5e588d56912103c", // Girls Floral Print Square Neck A-Line Dress
  },
  {
    query: "women's palazzo pants with animal print",
    expectedSourceId: "6a0b888d50f304f37558c6ec", // Women Animal Print Wide Leg Palazzos
  },
];

const run = async () => {
  await connectDB();

  const summary = { top1: 0, top3: 0, top5: 0, top8: 0, total: BENCHMARK.length };

  for (const { query, expectedSourceId } of BENCHMARK) {
    const results = await searchRag(query, { limit: 8 });
    const rank = results.findIndex((doc) => String(doc.sourceId) === expectedSourceId);
    const found = rank !== -1;

    console.log(`\nQuery: "${query}"`);
    console.log(`Expected sourceId: ${expectedSourceId}`);
    console.log(found ? `Found at rank ${rank + 1} (score ${results[rank].score.toFixed(4)})` : "NOT found in top 8");

    if (found && rank < 1) summary.top1 += 1;
    if (found && rank < 3) summary.top3 += 1;
    if (found && rank < 5) summary.top5 += 1;
    if (found && rank < 8) summary.top8 += 1;
  }

  console.log("\n--- Benchmark summary ---");
  console.log(`Queries: ${summary.total}`);
  console.log(`Expected product in top 1: ${summary.top1}/${summary.total}`);
  console.log(`Expected product in top 3: ${summary.top3}/${summary.total}`);
  console.log(`Expected product in top 5: ${summary.top5}/${summary.total}`);
  console.log(`Expected product in top 8: ${summary.top8}/${summary.total}`);

  await mongoose.connection.close();
};

run().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
