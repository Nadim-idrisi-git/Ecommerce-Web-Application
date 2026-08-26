// Live retrieval test - uses the real Gemini API (query embedding) and the
// real Atlas Vector Search index. Not run as part of routine testing; run
// manually to inspect actual retrieval quality.
//
//   node scripts/testRagRetrievalLive.js

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import { searchRag } from "../utils/rag/searchRag.js";

const QUERIES = [
  "purple floral top",
  "mujhe summer ke liye purple floral top chahiye",
  "women casual cotton top",
  "lightweight floral shirt for summer",
  "pink top",
  "men cotton t shirt",
  "casual summer clothes",
];

const printResults = (query, results) => {
  console.log(`\nQuery: "${query}"`);
  console.log(`Results: ${results.length}`);

  results.forEach((doc, index) => {
    const name = (doc.text || "").split("\n")[0];
    console.log(
      `  ${index + 1}. score=${doc.score.toFixed(4)}  sourceId=${doc.sourceId}  "${name}"  ` +
      `[${doc.metadata.gender}/${doc.metadata.category}/${doc.metadata.productType || "-"}/${doc.metadata.color || "-"}]`,
    );
    // Deliberately not logging doc.embedding - searchRag() never returns it
    // in the first place (see utils/rag/searchRag.js's RAG_RESULT_PROJECTION).
  });
};

const run = async () => {
  await connectDB();

  for (const query of QUERIES) {
    try {
      const results = await searchRag(query, { limit: 8 });
      printResults(query, results);
    } catch (error) {
      console.log(`\nQuery: "${query}"`);
      console.log(`  FAILED (${error.code || "UNKNOWN"}): ${error.message}`);
    }
  }

  // One filtered example, per module 4 task 6/7 - structured filters passed
  // as an already-built object, not parsed from the query by an LLM here.
  console.log("\n--- Filtered example: gender=Women, color=purple ---");
  const filtered = await searchRag("floral top", { limit: 5, filters: { gender: "Women", color: "purple" } });
  printResults("floral top (filtered: gender=Women, color=purple)", filtered);

  await mongoose.connection.close();
};

run().catch((error) => {
  console.error("Live retrieval test failed:", error);
  process.exit(1);
});
