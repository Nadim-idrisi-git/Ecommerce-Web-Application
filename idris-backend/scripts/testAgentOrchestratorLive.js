// MODULE 14 — live smoke test for the bounded multi-step agent orchestrator,
// through the REAL controllers/intentController.js detectAIIntent() (same
// harness as testCompareProductsLive.js/testShoppingQueryPlanLive.js): real
// Gemini tool-selection + re-planning, real hybrid retrieval, real
// comparison, real ragDocumentModel lookups. Read-only - no cart/order
// mutation ever happens server-side (the orchestrator never executes one by
// construction - see utils/agentOrchestrator.js), and this script never
// calls any /api/user/cart or /api/order/* endpoint either.
//
//   node scripts/testAgentOrchestratorLive.js

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import { detectAIIntent } from "../controllers/intentController.js";

const callIntent = (message, history = [], uiContext = null) =>
  new Promise((resolve, reject) => {
    const req = { body: { message, uiContext, history, recentActivity: [] }, userId: null };
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

const report = async (label, message, uiContext = null) => {
  const start = Date.now();
  const { payload } = await callIntent(message, [], uiContext);
  const ms = Date.now() - start;
  console.log(`\n[${label}] "${message}" (${ms}ms)`);

  if (!payload.success) {
    console.log(`  FAILED: ${payload.message}`);
    return payload;
  }

  console.log(`  Final tool: ${payload.tool || "(none)"}  Args: ${JSON.stringify(payload.arguments || {})}`);

  if (payload.rag) {
    console.log(`  Grounded: ${payload.rag.grounded}`);
    console.log(`  Sources: ${payload.rag.sources.map((s) => `${s.name} (₹${s.price ?? "?"})`).join(", ") || "(none)"}`);
    console.log(`  Answer: ${payload.rag.answer}`);
  } else if (!payload.tool) {
    console.log(`  Reply (${payload.replyType || "none"}): ${payload.reply}`);
  } else {
    console.log(`  (mutation/action hand-off - no rag field, as expected; NEVER executed server-side)`);
  }

  return payload;
};

const run = async () => {
  await connectDB();

  // SPEC EXAMPLE 1: "Black jacket dikhao under ₹2000 aur jo sabse sasti hai
  // usko cart mein add kar do." Expected: search_products executes
  // server-side, then the orchestrator re-plans and hands off add_to_cart
  // with the actual cheapest RETRIEVED product's real id - never invented,
  // never executed here.
  await report(
    "SPEC EXAMPLE 1 (Hinglish, search->cart)",
    "black jacket dikhao under 2000 aur jo sabse sasti hai usko cart mein add kar do",
  );

  // SPEC EXAMPLE 2: "Mujhe winter ke liye black jackets dikhao, dono mein se
  // best batao aur second wale ko cart mein daal do." Expected:
  // search_products -> compare_products (on the retrieved results) ->
  // add_to_cart handed off for the "second" compared product.
  await report(
    "SPEC EXAMPLE 2 (Hinglish, search->compare->cart)",
    "mujhe winter ke liye black jackets dikhao, dono mein se best batao aur second wale ko cart mein daal do",
  );

  // English equivalent of example 1, for a same-behavior-different-language check.
  await report(
    "English equivalent of example 1 (search->cart)",
    "show me jackets under 1500 and add the cheapest one to my cart",
  );

  // Pure Hindi (Devanagari) multi-step request.
  await report(
    "Hindi (Devanagari) search->cart",
    "मुझे 2000 रुपये के अंदर काली जैकेट दिखाओ और जो सबसे सस्ती हो उसे कार्ट में डाल दो",
  );

  // Zero-result case: must stop after the ungrounded search, never proceed
  // to a re-plan/cart attempt (Part F).
  await report(
    "Zero-result short-circuit",
    "show me a purple leather saree under 5 rupees and add the cheapest to cart",
  );

  // Ambiguous single-tool request with nothing to chain from (no cart/
  // compare instruction at all) - must behave exactly like Module 12/13
  // (single search, no orchestration surprises).
  await report("Plain single-tool search (no chaining requested)", "show me black jackets");

  // Ambiguous compare-then-act request with many products, to exercise the
  // clarification path rather than a guess.
  await report(
    "Ambiguous multi-step (should clarify, not guess)",
    "show me all jackets, tell me which is best and add it to my cart",
  );

  await mongoose.connection.close();
};

run().catch((error) => {
  console.error("Live agent orchestrator test failed:", error);
  process.exit(1);
});
