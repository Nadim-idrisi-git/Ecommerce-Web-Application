// MODULE 15 — a small, bounded reliability wrapper for a Gemini
// generateContent call. Not a new Gemini client, not a new call site - every
// existing `generateContent = (params) => ai.models.generateContent(params)`
// default (intentController.js, agentOrchestrator.js, generateRagAnswer.js,
// generateComparisonAnswer.js) wraps its real call with this, while every
// test's own injected fake generateContent bypasses it entirely (tests never
// call through this file) - zero change to any test seam or existing
// contract, purely a hardening of the REAL network call path.
//
// Bounded on every axis: one fixed timeout, at most one retry, only for a
// transient-shaped failure, never for a deterministic one (bad argument,
// invalid request, etc.) - "no unbounded Gemini calls" per the module's own
// requirement. This never wraps a mutation - every call site it's used from
// is a read-only tool-selection/generation/RAG/comparison call; a cart/order
// mutation is never executed server-side at all (see agentOrchestrator.js),
// so a retry here can never duplicate one.

const GEMINI_CALL_TIMEOUT_MS = 12000;
const GEMINI_RETRY_DELAY_MS = 400;
const MAX_ATTEMPTS = 2; // one real attempt + at most one retry

// Same transient-failure heuristic already used elsewhere in this backend
// (utils/rag/embedRagQuery.js/embedRagDocument.js's own `message.includes("timeout")`
// check) - extended slightly to cover the other common transient shapes a
// network/provider-side hiccup actually presents as. A 4xx/invalid-argument/
// validation error never matches this and is never retried.
const RETRYABLE_MESSAGE_PATTERN = /timeout|timed out|econnreset|etimedout|eai_again|socket hang up|502|503|504|fetch failed|network error|unavailable/i;

export const isRetryableGeminiError = (error) => RETRYABLE_MESSAGE_PATTERN.test(String(error?.message || ""));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = (promise, ms) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Gemini call timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

// callFn: () => Promise<response> - a THUNK, not a bare promise, so a retry
// actually issues a fresh call rather than re-awaiting an already-settled
// one. Exported options are for direct testing only (never a real caller).
export const callGeminiWithRetry = async (
  callFn,
  { timeoutMs = GEMINI_CALL_TIMEOUT_MS, maxAttempts = MAX_ATTEMPTS, retryDelayMs = GEMINI_RETRY_DELAY_MS } = {},
) => {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await withTimeout(callFn(), timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableGeminiError(error)) {
        throw error;
      }
      await delay(retryDelayMs);
    }
  }
  throw lastError;
};
