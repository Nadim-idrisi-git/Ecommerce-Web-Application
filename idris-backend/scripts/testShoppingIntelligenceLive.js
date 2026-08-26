// MODULE 10 — live smoke test for the shopping-intelligence layer, through
// the REAL controllers/intentController.js detectAIIntent() (same harness
// as testAssistantRagIntegrationLive.js): real Gemini tool-selection, real
// hybrid retrieval (with negative/soft-price signals now active), real
// grounded generation (with the honest budget-relaxation narration wired
// in). Read-only - makes no database writes.
//
//   node scripts/testShoppingIntelligenceLive.js

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import { detectAIIntent } from "../controllers/intentController.js";

const callIntent = (message, history = []) =>
  new Promise((resolve, reject) => {
    const req = { body: { message, uiContext: null, history, recentActivity: [] }, userId: null };
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

const report = (label, message, payload) => {
  console.log(`\n[${label}] "${message}"`);
  if (!payload.success) {
    console.log(`  FAILED: ${payload.message}`);
    return;
  }
  console.log(`  Tool: ${payload.tool || "(none)"}  Args: ${JSON.stringify(payload.arguments || {})}`);
  if (payload.rag) {
    console.log(`  Grounded: ${payload.rag.grounded}`);
    console.log(`  Sources: ${payload.rag.sources.map((s) => `${s.name} (₹${s.price ?? "?"})`).join(", ") || "(none)"}`);
    console.log(`  Answer: ${payload.rag.answer}`);
  } else {
    console.log(`  Reply: ${payload.reply}`);
  }
};

const SINGLE_TURN = [
  ["English hard price + attribute", "black jacket under 1500"],
  ["English explicit negative", "jacket but not black"],
  ["English soft ('around') price", "jacket around 1500"],
  ["Hinglish reverse-order negative", "mujhe slim fit nahi chahiye jacket"],
  ["Hindi (Devanagari) negative", "मुझे काला जैकेट नहीं चाहिए"],
  ["Complex combined constraint", "women's cotton t-shirt under 2000, not black, something casual and comfortable"],
  ["Unsatisfiable budget (forces relaxation)", "black jacket under 50"],
];

const run = async () => {
  await connectDB();

  for (const [label, message] of SINGLE_TURN) {
    const { payload } = await callIntent(message);
    report(label, message, payload);
  }

  console.log("\n--- Follow-up sequence A: attribute swap ---");
  const turn1a = "show me a black t-shirt";
  const res1a = await callIntent(turn1a);
  report("A.1", turn1a, res1a.payload);
  const historyA = [
    { role: "user", content: turn1a },
    { role: "assistant", content: res1a.payload.rag?.answer || res1a.payload.reply || "" },
  ];
  const turn2a = "same but in blue";
  const res2a = await callIntent(turn2a, historyA);
  report("A.2 (follow-up)", turn2a, res2a.payload);

  console.log("\n--- Follow-up sequence B: cheaper alternative ---");
  const turn1b = "women's floral top under 2000";
  const res1b = await callIntent(turn1b);
  report("B.1", turn1b, res1b.payload);
  const historyB = [
    { role: "user", content: turn1b },
    { role: "assistant", content: res1b.payload.rag?.answer || res1b.payload.reply || "" },
  ];
  const turn2b = "cheaper one please";
  const res2b = await callIntent(turn2b, historyB);
  report("B.2 (follow-up)", turn2b, res2b.payload);

  await mongoose.connection.close();
};

run().catch((error) => {
  console.error("Live shopping-intelligence test failed:", error);
  process.exit(1);
});
