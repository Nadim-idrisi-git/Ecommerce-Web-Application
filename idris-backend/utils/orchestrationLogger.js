// MODULE 15 — minimal structured server-side logging for AI agent
// orchestration events (see the Module 15 report, Part I). No new logging
// dependency is introduced - this reuses the same plain `console.*`
// convention already used throughout this backend (e.g.
// controllers/intentController.js's own console.error calls), just given a
// single consistent JSON shape so orchestration events can actually be
// found/filtered in production logs.
//
// Deliberately narrow: only orchestration-relevant, non-sensitive
// STRUCTURAL fields are ever logged - tool names, counts, booleans, and
// short enums. Never the customer's raw message text, never a full tool
// `arguments` object (which could carry a query string), never uiContext,
// never anything from cartLines/recentOrders/addresses, and never any
// token/header/credential - none of those are ever passed to this
// function's `data` in the first place (see every call site in
// agentOrchestrator.js).
export const logOrchestrationEvent = (event, data = {}) => {
  console.log(JSON.stringify({
    scope: "agentOrchestrator",
    event,
    ...data,
    ts: new Date().toISOString(),
  }));
};
