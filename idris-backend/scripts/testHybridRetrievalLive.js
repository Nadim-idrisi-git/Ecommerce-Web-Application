// Live hybrid retrieval test - real Gemini query embedding + real Atlas
// vector search + real Atlas lexical search against the current catalog.
// For inspection/benchmarking only; not part of routine testing.
//
//   node scripts/testHybridRetrievalLive.js

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import { searchHybridRag } from "../utils/rag/hybridSearchRag.js";

const QUERIES = [
  "purple floral top",
  "mujhe summer ke liye purple floral top chahiye",
  "men cotton t shirt",
  "women casual cotton top",
  "black jacket under 2000",
  "floral dress for girls",
  "women animal print palazzo",
  "blue shirt for office",
];

const run = async () => {
  await connectDB();

  for (const query of QUERIES) {
    console.log(`\nQuery: "${query}"`);

    try {
      const { results, diagnostics } = await searchHybridRag(query, { limit: 8 });

      console.log(`Vector candidates: ${diagnostics.vectorCount}`);
      console.log(`Lexical candidates: ${diagnostics.lexicalCount}`);
      console.log(`Merged: ${diagnostics.mergedCount}`);
      console.log(`Final: ${diagnostics.finalCount}`);
      if (diagnostics.warnings.length) {
        console.log(`Warnings: ${diagnostics.warnings.join("; ")}`);
      }

      results.slice(0, 5).forEach((doc, index) => {
        const name = (doc.text || "").split("\n")[0];
        console.log(
          `  ${index + 1}. "${name}"  ` +
          `vectorRank=${doc.scores.vectorRank ?? "-"} lexicalRank=${doc.scores.lexicalRank ?? "-"} ` +
          `rrf=${doc.scores.rrfScore.toFixed(5)} rerank=${doc.scores.rerankScore.toFixed(5)}`,
        );
      });

      if (results.length > 0) {
        console.log(`Top result: "${results[0].text.split("\n")[0]}" (rerank score ${results[0].scores.rerankScore.toFixed(5)})`);
      }
    } catch (error) {
      console.log(`  FAILED (${error.code || "UNKNOWN"}): ${error.message}`);
    }
  }

  await mongoose.connection.close();
};

run().catch((error) => {
  console.error("Live hybrid retrieval test failed:", error);
  process.exit(1);
});
