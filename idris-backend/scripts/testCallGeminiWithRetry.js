// MODULE 15 — deterministic, network-free checks for the bounded Gemini
// call reliability wrapper (utils/callGeminiWithRetry.js). No real API call
// happens here - every scenario uses a fake `callFn` thunk.
//
//   node scripts/testCallGeminiWithRetry.js

import assert from "node:assert/strict";
import { callGeminiWithRetry, isRetryableGeminiError } from "../utils/callGeminiWithRetry.js";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};
const asyncTest = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

test("isRetryableGeminiError recognizes transient network/provider-side shapes", () => {
  ["Request timed out", "ETIMEDOUT", "ECONNRESET", "503 Service Unavailable", "fetch failed", "socket hang up"]
    .forEach((msg) => assert.equal(isRetryableGeminiError(new Error(msg)), true, msg));
});

test("isRetryableGeminiError never treats a deterministic/validation error as transient", () => {
  ["Invalid argument: temperature must be between 0 and 1", "API key not valid", "400 Bad Request: malformed JSON"]
    .forEach((msg) => assert.equal(isRetryableGeminiError(new Error(msg)), false, msg));
});

await asyncTest("a successful first attempt never retries", async () => {
  let calls = 0;
  const result = await callGeminiWithRetry(async () => {
    calls += 1;
    return { text: "ok" };
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { text: "ok" });
});

await asyncTest("a transient failure is retried exactly once, then succeeds", async () => {
  let calls = 0;
  const result = await callGeminiWithRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("503 Service Unavailable");
      return { text: "recovered" };
    },
    { retryDelayMs: 1 },
  );
  assert.equal(calls, 2);
  assert.deepEqual(result, { text: "recovered" });
});

await asyncTest("a persistent transient failure still stops after maxAttempts - never an unbounded retry loop", async () => {
  let calls = 0;
  await assert.rejects(
    () => callGeminiWithRetry(
      async () => {
        calls += 1;
        throw new Error("ETIMEDOUT");
      },
      { retryDelayMs: 1 },
    ),
  );
  assert.equal(calls, 2, "exactly one real attempt + one retry, never more");
});

await asyncTest("a deterministic/non-transient failure is never retried", async () => {
  let calls = 0;
  await assert.rejects(
    () => callGeminiWithRetry(async () => {
      calls += 1;
      throw new Error("Invalid argument: bad request shape");
    }),
    /Invalid argument/,
  );
  assert.equal(calls, 1, "a deterministic error must fail fast, not retry");
});

await asyncTest("a call exceeding the bounded timeout fails rather than hanging the request indefinitely", async () => {
  const neverResolves = () => new Promise(() => {});
  await assert.rejects(
    () => callGeminiWithRetry(neverResolves, { timeoutMs: 20, retryDelayMs: 1 }),
    /timed out/i,
  );
});

await asyncTest("maxAttempts=1 (no retry configured) never retries even a transient error", async () => {
  let calls = 0;
  await assert.rejects(
    () => callGeminiWithRetry(
      async () => {
        calls += 1;
        throw new Error("503 Service Unavailable");
      },
      { maxAttempts: 1 },
    ),
  );
  assert.equal(calls, 1);
});

console.log(`\n${passed} test(s) passed.`);
