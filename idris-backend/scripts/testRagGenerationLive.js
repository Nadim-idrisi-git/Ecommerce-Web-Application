// Live smoke test - real retrieval (module 5's searchHybridRag, read-only)
// feeding real candidates into generateRagAnswer() (exactly one Gemini
// generation call per query). Does not create/update/delete any Product or
// RAG document - retrieval here is read-only, same as every other live
// test in this backend.
//
//   node scripts/testRagGenerationLive.js

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import { searchHybridRag } from "../utils/rag/hybridSearchRag.js";
import { generateRagAnswer } from "../utils/rag/generateRagAnswer.js";

const QUERIES = [
  "show me a purple floral top",
  "mujhe summer ke liye purple floral top chahiye",
  "men cotton t shirt",
  "women denim jacket under 2000",
];

const run = async () => {
  await connectDB();

  for (const query of QUERIES) {
    console.log(`\nQuery: "${query}"`);

    try {
      const { results: candidates } = await searchHybridRag(query, { limit: 8 });
      console.log(`Candidates retrieved: ${candidates.length}`);

      const result = await generateRagAnswer({ query, candidates });

      console.log(`Grounded: ${result.grounded}`);
      console.log(`Answer:\n${result.answer}`);
      console.log(`Sources: ${result.sources.map((s) => s.productName).join(", ") || "(none)"}`);
      console.log(`Meta: candidateCount=${result.meta.candidateCount} contextCount=${result.meta.contextCount} truncated=${result.meta.truncated}`);
    } catch (error) {
      console.log(`  FAILED (${error.code || "UNKNOWN"}): ${error.message}`);
    }
  }

  await mongoose.connection.close();
};

run().catch((error) => {
  console.error("Live RAG generation test failed:", error);
  process.exit(1);
});
