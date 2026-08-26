// MODULE 11 — live smoke test for the canonical shopping query plan,
// through the REAL controllers/intentController.js detectAIIntent() (same
// harness as testAssistantRagIntegrationLive.js/testShoppingIntelligenceLive.js):
// real Gemini tool-selection, real hybrid retrieval with the plan's
// deterministic hard filters/exclusions/price now authoritative, real
// grounded generation. Read-only - makes no database writes. Rebuilds the
// same plan the controller itself built (via the exported
// buildShoppingQueryPlan()) purely for inspection/reporting here - it does
// not re-run retrieval or make any extra Gemini/DB call.
//
//   node scripts/testShoppingQueryPlanLive.js

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import { detectAIIntent } from "../controllers/intentController.js";
import { buildShoppingQueryPlan } from "../utils/rag/shoppingQueryPlan.js";

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

const report = async (label, message, history = []) => {
  const { payload } = await callIntent(message, history);
  console.log(`\n[${label}] "${message}"`);

  if (!payload.success) {
    console.log(`  FAILED: ${payload.message}`);
    return payload;
  }

  console.log(`  Tool: ${payload.tool || "(none)"}  Args: ${JSON.stringify(payload.arguments || {})}`);

  if (payload.tool) {
    // Inspection-only rebuild - same inputs the controller itself used,
    // shown here so the plan's effective constraints are visible for the
    // report without exposing them to the customer-facing response itself
    // (Part 15's explicit instruction).
    const plan = buildShoppingQueryPlan({ originalQuery: message, toolArguments: payload.arguments, history });
    console.log(`  Plan include: ${JSON.stringify(plan.include)}`);
    console.log(`  Plan exclude: ${JSON.stringify(plan.exclude)}`);
    console.log(`  Plan price: ${JSON.stringify(plan.price)}`);
  }

  if (payload.rag) {
    console.log(`  Grounded: ${payload.rag.grounded}`);
    console.log(`  Sources: ${payload.rag.sources.map((s) => `${s.name} (₹${s.price ?? "?"})`).join(", ") || "(none)"}`);
    console.log(`  Answer: ${payload.rag.answer}`);
  } else if (!payload.tool) {
    console.log(`  Reply: ${payload.reply}`);
  }

  return payload;
};

const run = async () => {
  await connectDB();

  await report("1", "mujhe black slim fit jacket chahiye lekin leather nahi, 2000 ke andar");

  const p2a = await report("2a (setup)", "show me something similar to a black jacket");
  await report("2b (follow-up)", "show me something similar but cheaper", [
    { role: "user", content: "show me something similar to a black jacket" },
    { role: "assistant", content: p2a.rag?.answer || p2a.reply || "" },
  ]);

  const p3a = await report("3a (setup)", "show me a black jacket");
  await report("3b (follow-up)", "same jacket but in blue", [
    { role: "user", content: "show me a black jacket" },
    { role: "assistant", content: p3a.rag?.answer || p3a.reply || "" },
  ]);

  await report("4", "mujhe red nahi chahiye, black dikhao");
  await report("5", "मुझे काली जैकेट चाहिए लेकिन स्लिम फिट नहीं");
  await report("6", "around 2000 rupees");
  await report("7", "under 1500");
  await report("8", "show me men's cotton t shirts under 1000");
  await report("9", "something stylish for a summer party");
  await report("10", "not leather and not slim fit");

  await mongoose.connection.close();
};

run().catch((error) => {
  console.error("Live shopping query plan test failed:", error);
  process.exit(1);
});
