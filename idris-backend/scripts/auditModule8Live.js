// MODULE 8 live audit - NOT a permanent regression test, a one-shot
// diagnostic script. Exercises the REAL controllers/intentController.js
// path (not just individual RAG functions) for every category in the
// module 8 spec, counts real Gemini network calls (by wrapping
// globalThis.fetch - the @google/genai SDK falls back to it when no custom
// fetch is supplied, which nothing in this codebase does), and measures
// latency. Read-only - makes no database writes.
//
//   node scripts/auditModule8Live.js

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import { detectAIIntent } from "../controllers/intentController.js";

// --- Gemini call counter (network-level, via global fetch) ---
let geminiCallLog = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const urlString = String(url);
  if (urlString.includes("generativelanguage.googleapis.com")) {
    const method = urlString.includes(":embedContent")
      ? "embedContent"
      : urlString.includes(":generateContent")
      ? "generateContent"
      : "other";
    geminiCallLog.push(method);
  }
  return realFetch(url, options);
};

const resetCallLog = () => {
  geminiCallLog = [];
};

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

const section = (title) => console.log(`\n${"=".repeat(3)} ${title} ${"=".repeat(3)}`);

const run = async () => {
  await connectDB();

  section("PART 2 - END-TO-END QUERY FLOW AUDIT");

  const categories = [
    ["A. Semantic product discovery (Hinglish)", "mujhe purple floral top chahiye"],
    ["B. English equivalent", "show me a purple floral top"],
    ["C. Budget query (Hinglish)", "mujhe 2000 ke andar denim jacket chahiye"],
    ["D. Product attributes", "show me men's cotton t shirts"],
    ["E. Recommendation", "something floral for a summer party"],
    ["F. No-match query", "show me a neon green leather astronaut jacket under 500"],
    ["G. Non-product conversational", "hi"],
    ["H. Non-RAG business request", "what is your return policy?"],
    ["I. Deterministic navigation tool", "take me to the cart"],
    ["J1. Hinglish", "mujhe summer ke liye casual top chahiye"],
    ["J2. Hinglish", "2000 ke andar men's t shirt dikhao"],
    ["J3. Hinglish", "party ke liye floral dress suggest karo"],
    ["J4. Hinglish", "black jacket dikhao"],
  ];

  const timings = [];

  for (const [label, message] of categories) {
    resetCallLog();
    const start = Date.now();
    const { payload } = await callIntent(message);
    const elapsedMs = Date.now() - start;
    timings.push({ label, elapsedMs, geminiCalls: geminiCallLog.length });

    console.log(`\n--- ${label} ---`);
    console.log(`Message: "${message}"`);
    console.log(`Tool: ${payload.tool || "(none)"}`);
    if (payload.arguments) console.log(`Arguments: ${JSON.stringify(payload.arguments)}`);
    console.log(`RAG invoked: ${Boolean(payload.rag)}`);
    if (payload.rag) {
      console.log(`  grounded=${payload.rag.grounded} sources=${payload.rag.sources.length} contextCount=${payload.rag.meta.contextCount}`);
      console.log(`  answer: ${payload.rag.answer.slice(0, 200)}${payload.rag.answer.length > 200 ? "..." : ""}`);
    }
    if (!payload.tool && !payload.rag) {
      console.log(`Reply: ${(payload.reply || "").slice(0, 150)}`);
    }
    console.log(`Gemini network calls observed: ${geminiCallLog.length} [${geminiCallLog.join(", ")}]`);
    console.log(`Latency: ${elapsedMs}ms`);
  }

  section("PART 9 - GEMINI CALL COUNT SUMMARY");
  timings.forEach((t) => console.log(`${t.label}: ${t.geminiCalls} call(s), ${t.elapsedMs}ms`));

  section("PART 13 - LATENCY SUMMARY");
  const ragTimings = timings.filter((t) => t.geminiCalls >= 2); // tool-select + embed + generate
  const avg = (arr) => (arr.length ? (arr.reduce((s, t) => s + t.elapsedMs, 0) / arr.length).toFixed(0) : "n/a");
  console.log(`Full RAG-eligible requests (n=${ragTimings.length}): avg ${avg(ragTimings)}ms, individual: ${ragTimings.map((t) => t.elapsedMs).join(", ")}ms`);
  const nonRag = timings.filter((t) => t.geminiCalls < 2);
  console.log(`Non-RAG requests (n=${nonRag.length}): avg ${avg(nonRag)}ms`);

  section("PART 4 - NO-RESULT / LOW-CONFIDENCE QUERIES");
  const noResultQueries = [
    "neon green leather astronaut jacket under 500",
    "diamond space suit for cats",
    "golden waterproof silk motorcycle helmet for 100 rupees",
  ];
  for (const message of noResultQueries) {
    resetCallLog();
    const { payload } = await callIntent(message);
    console.log(`\nQuery: "${message}"`);
    console.log(`Tool: ${payload.tool}, RAG invoked: ${Boolean(payload.rag)}`);
    if (payload.rag) {
      console.log(`grounded=${payload.rag.grounded}, sources=${payload.rag.sources.length}`);
      console.log(`answer: ${payload.rag.answer}`);
    }
  }

  section("PART 5 - BUDGET / PRICE PHRASING AUDIT");
  const priceQueries = [
    "black jacket under 500",
    "black jacket 500 ke andar",
    "black jacket ₹2000 tak",
    "black jacket below 1000 rupees",
    "black jacket under 1k",
  ];
  for (const message of priceQueries) {
    const { payload } = await callIntent(message);
    console.log(`\nQuery: "${message}"`);
    console.log(`Tool args: ${JSON.stringify(payload.arguments)}`);
    if (payload.rag) {
      const prices = payload.rag.sources.map((s) => s.price);
      console.log(`Source prices: ${prices.join(", ")}`);
    }
  }

  section("PART 10 - EXISTING TOOL PRECEDENCE AUDIT");
  const toolQueries = [
    ["navigate", "go to my cart"],
    ["open_product", "open the most expensive product"],
    ["sort_products", "sort by price low to high"],
    ["track_order", "track my order"],
  ];
  for (const [expectedFamily, message] of toolQueries) {
    resetCallLog();
    const { payload } = await callIntent(message);
    console.log(`\nQuery: "${message}" (expected family: ${expectedFamily})`);
    console.log(`Tool selected: ${payload.tool}`);
    console.log(`RAG invoked: ${Boolean(payload.rag)} (must be false for these)`);
    console.log(`Gemini calls: ${geminiCallLog.length}`);
  }

  section("PART 11 - VOICE PATH (TEXT-PAYLOAD LEVEL)");
  console.log(
    "No live audio pipeline is available in this environment - voiceController.js only performs " +
    "STT/TTS and forwards the transcribed text to this SAME /api/ai/intent flow (confirmed by " +
    "inspection, not re-tested here since that would require real audio input). The 4 representative " +
    "text payloads below are exactly what a voice request would produce after transcription.",
  );
  const voiceEquivalents = [
    "show me a purple floral top",
    "mujhe purple floral top chahiye",
    "black jacket under 2000",
    "hi",
  ];
  for (const message of voiceEquivalents) {
    const { payload } = await callIntent(message);
    console.log(`\n"${message}" -> tool=${payload.tool || "(none)"}, ragInvoked=${Boolean(payload.rag)}`);
  }

  await mongoose.connection.close();
  globalThis.fetch = realFetch;
};

run().catch((error) => {
  globalThis.fetch = realFetch;
  console.error("Module 8 live audit failed:", error);
  process.exit(1);
});
