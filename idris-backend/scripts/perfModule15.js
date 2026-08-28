// MODULE 15 — PART F performance measurement. Measures real, end-to-end
// wall-clock latency through the actual detectAIIntent() pipeline for the
// 5 required comparison scenarios, and derives Gemini-call/agent-step/
// tool-call counts from the structured orchestration log events emitted by
// utils/agentOrchestrator.js (Part I) - no separate instrumentation is
// added elsewhere; this script only observes what's already logged.
//
//   node scripts/perfModule15.js

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import { detectAIIntent } from "../controllers/intentController.js";

const callIntent = (message, uiContext = null) =>
  new Promise((resolve, reject) => {
    const req = { body: { message, uiContext, history: [], recentActivity: [] }, userId: null };
    const res = {
      _status: 200,
      status(code) { this._status = code; return this; },
      json(payload) { resolve({ status: this._status, payload }); },
    };
    Promise.resolve(detectAIIntent(req, res)).catch(reject);
  });

// Captures every structured orchestration log line emitted during one call,
// by temporarily wrapping console.log - the same plain-console mechanism
// utils/orchestrationLogger.js already uses, nothing new added to production code.
const measure = async (label, message, uiContext = null) => {
  const events = [];
  const originalLog = console.log;
  console.log = (line) => {
    try {
      const parsed = JSON.parse(line);
      if (parsed?.scope === "agentOrchestrator") events.push(parsed);
    } catch {
      // non-JSON console output (e.g. a raw console.error string) - ignore for this measurement
    }
  };

  const start = Date.now();
  const { payload } = await callIntent(message, uiContext);
  const totalMs = Date.now() - start;
  console.log = originalLog;

  const toolExecs = events.filter((e) => e.event === "tool_executed").length;
  const replanCalls = events.filter((e) => e.event === "planner_decision").length;
  const finalStep = events.find((e) => e.event === "terminated")?.step ?? events.find((e) => e.event === "mutation_handoff" || e.event === "readonly_handoff")?.step ?? 1;
  const finalToolCallCount = events.find((e) => e.event === "terminated")?.toolCallCount
    ?? events.find((e) => e.event === "mutation_handoff" || e.event === "readonly_handoff")?.toolCallCount
    ?? toolExecs;
  // Gemini call count = 1 initial tool-selection call + 1 generation call per
  // server-executed tool (search/recommend/compare each make exactly one
  // generation call when grounded, per Modules 6/13) + 1 re-plan call per
  // planner_decision event.
  const estimatedGeminiCalls = 1 + toolExecs + replanCalls;

  console.log(`\n[${label}] "${message}"`);
  console.log(`  total latency:        ${totalMs}ms`);
  console.log(`  final tool:           ${payload.tool || "(none)"}${payload.rag ? ` (grounded=${payload.rag.grounded})` : ""}`);
  console.log(`  agent steps:          ${finalStep}`);
  console.log(`  server tool calls:    ${finalToolCallCount}`);
  console.log(`  re-plan calls:        ${replanCalls}`);
  console.log(`  estimated Gemini calls: ${estimatedGeminiCalls} (1 tool-select + ${toolExecs} generation + ${replanCalls} re-plan)`);

  return { label, totalMs, agentSteps: finalStep, toolCalls: finalToolCallCount, replanCalls, estimatedGeminiCalls };
};

const run = async () => {
  await connectDB();

  const summary = [];
  summary.push(await measure("1. Normal single-tool search", "show me black jackets"));
  summary.push(await measure("2. Grounded search, no further action", "show me a fleece jacket"));
  summary.push(await measure("3. Search -> mutation handoff", "black jacket dikhao under 2000 aur jo sabse sasti hai usko cart mein add kar do"));
  summary.push(await measure("4. Search -> comparison", "compare winter jackets for me and tell me which is warmer"));
  summary.push(await measure("5. Search -> comparison -> mutation handoff", "mujhe winter ke liye black jackets dikhao, dono mein se best batao aur second wale ko cart mein daal do"));

  console.log("\n\n=== SUMMARY ===");
  console.table(summary.map((s) => ({
    scenario: s.label,
    "latency (ms)": s.totalMs,
    "agent steps": s.agentSteps,
    "server tool calls": s.toolCalls,
    "re-plan calls": s.replanCalls,
    "~Gemini calls": s.estimatedGeminiCalls,
  })));

  await mongoose.connection.close();
};

run().catch((error) => {
  console.error("Module 15 performance measurement failed:", error);
  process.exit(1);
});
