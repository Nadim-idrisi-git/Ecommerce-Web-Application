// Live end-to-end smoke test - calls the REAL controllers/intentController.js
// detectAIIntent() (not just assistantRag() in isolation) with a minimal
// req/res stand-in, so this proves the actual integration wiring, not just
// the RAG service on its own. Uses the real Gemini tool-selection call, the
// real hybrid retrieval, and real grounded generation. Read-only - makes no
// database writes.
//
//   node scripts/testAssistantRagIntegrationLive.js

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import { detectAIIntent } from "../controllers/intentController.js";

const QUERIES = [
  "mujhe purple floral top chahiye",
  "show me a men's cotton t shirt",
  "mujhe 2000 ke andar denim jacket chahiye",
  "something floral for a summer party",
  "hi, what's your return policy?", // non-RAG conversational request
];

const callIntent = (message) =>
  new Promise((resolve, reject) => {
    const req = { body: { message, uiContext: null, history: [], recentActivity: [] }, userId: null };
    const res = {
      _status: 200,
      status(code) {
        this._status = code;
        return this;
      },
      json(payload) {
        resolve({ status: this._status, payload });
      },
    };
    Promise.resolve(detectAIIntent(req, res)).catch(reject);
  });

const run = async () => {
  await connectDB();

  for (const message of QUERIES) {
    console.log(`\nMessage: "${message}"`);

    const { status, payload } = await callIntent(message);

    if (!payload.success) {
      console.log(`  FAILED (status ${status}): ${payload.message}`);
      continue;
    }

    console.log(`Tool selected: ${payload.tool || "(none - plain reply)"}`);

    if (payload.tool) {
      console.log(`Tool arguments: ${JSON.stringify(payload.arguments)}`);
    }

    if (payload.rag) {
      console.log(`RAG invoked: yes`);
      console.log(`Grounded: ${payload.rag.grounded}`);
      console.log(`Answer:\n${payload.rag.answer}`);
      console.log(`Sources: ${payload.rag.sources.map((s) => `${s.name} (₹${s.price ?? "?"})`).join(", ") || "(none)"}`);
    } else if (payload.tool) {
      console.log("RAG invoked: no (tool is not RAG-eligible, or RAG failed and was safely swallowed)");
    } else {
      console.log(`RAG invoked: no (no tool matched - plain conversational reply)`);
      console.log(`Reply: ${payload.reply}`);
    }
  }

  await mongoose.connection.close();
};

run().catch((error) => {
  console.error("Live assistant RAG integration test failed:", error);
  process.exit(1);
});
