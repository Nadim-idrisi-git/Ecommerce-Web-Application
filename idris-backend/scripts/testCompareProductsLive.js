// MODULE 13 — live smoke test for grounded product comparison, through the
// REAL controllers/intentController.js detectAIIntent() (same harness as
// testShoppingQueryPlanLive.js): real Gemini tool-selection, real
// compare_products sanitization/reference-resolution, real ragDocumentModel
// lookup, real comparison generation. Read-only - makes no database writes.
//
//   node scripts/testCompareProductsLive.js

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import productModel from "../models/productModel.js";
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

const report = async (label, message, { history = [], uiContext = null } = {}) => {
  const { payload } = await callIntent(message, history, uiContext);
  console.log(`\n[${label}] "${message}"`);

  if (!payload.success) {
    console.log(`  FAILED: ${payload.message}`);
    return payload;
  }

  console.log(`  Tool: ${payload.tool || "(none)"}  Args: ${JSON.stringify(payload.arguments || {})}`);

  if (payload.rag) {
    console.log(`  Grounded: ${payload.rag.grounded}`);
    console.log(`  Sources: ${payload.rag.sources.map((s) => `${s.name} (₹${s.price ?? "?"})`).join(", ") || "(none)"}`);
    console.log(`  Answer: ${payload.rag.answer}`);
  } else if (!payload.tool) {
    console.log(`  Reply (${payload.replyType || "none"}): ${payload.reply}`);
  }

  return payload;
};

// Builds a minimal, realistic uiContext.visibleProducts array (same shape
// AIAssistant.jsx's summarizeProductForContext() sends) from two real
// catalog products, so Gemini can resolve "these two"/"first and second"/
// "the black one" the exact way it already does for open_product/
// add_to_cart - no special-casing for compare_products needed.
const buildUiContext = (products) => ({
  page: "collection",
  visibleProducts: products.map((p) => ({
    id: String(p._id),
    name: p.name,
    price: p.price,
    gender: p.gender,
    category: p.category,
    color: p.color,
    bestseller: p.bestseller,
  })),
  selectedProduct: null,
  activeSearch: "",
  cartLines: [],
  recentOrders: [],
  uiOpen: {},
});

const run = async () => {
  await connectDB();

  const jackets = await productModel.find({ category: "Winterwear" }).limit(2).lean();
  if (jackets.length < 2) {
    console.log("Not enough Winterwear products in the catalog to run the live comparison matrix.");
    await mongoose.connection.close();
    return;
  }
  const uiContext = buildUiContext(jackets);
  console.log(`Using real catalog products for the matrix: ${jackets.map((p) => p.name).join(" | ")}`);

  // TEST 14/15: "which is better for winter?" / "first vs second" - Gemini
  // must resolve both product ids purely from uiContext.visibleProducts,
  // the same reference-resolution mechanism already used for
  // open_product/add_to_cart.
  await report("14 - which is better for winter", "which one is better for winter?", { uiContext });
  await report("15 - first vs second", "compare the first and second one", { uiContext });
  await report("compare these two", "compare these two", { uiContext });

  // Hindi/Hinglish live comparison (tests 12/13, through the real pipeline).
  await report("Hinglish live", "in dono mein konsa better hai winter ke liye?", { uiContext });
  await report("Hindi live", "इन दोनों में से कौन सा बेहतर है?", { uiContext });

  // Deterministic no-product-resolvable behavior (test 17): nothing visible
  // to compare, so Gemini should either not call compare_products at all, or
  // (if it still calls it with <2 resolvable ids) compareProducts() should
  // return a real, honest clarification, never a crash/empty response.
  await report("17 - deterministic no-product behavior", "compare these products", {
    uiContext: { ...uiContext, visibleProducts: [] },
  });

  // Ambiguous reference with many products visible - Gemini should ask a
  // CLARIFY_PREFIX question (Comparison rules paragraph) rather than
  // guessing which 2 of many to compare.
  const manyProducts = await productModel.find({}).limit(6).lean();
  await report("ambiguous - which one is better (6 visible)", "which one is better?", {
    uiContext: buildUiContext(manyProducts),
  });

  // Vocabulary reconciliation live check (Part B): a real query using a
  // reconciled term should now hard-filter/search correctly.
  await report("vocab: joggers", "show me joggers");
  await report("vocab: fleece jacket", "I want a fleece jacket");

  await mongoose.connection.close();
};

run().catch((error) => {
  console.error("Live comparison test failed:", error);
  process.exit(1);
});
