// MODULE 13 — comparison-specific bounds. Kept separate from
// ragGenerationConfig.js since these are business-rule counts (how many
// products a comparison spans), not generation model/prompt constants -
// generateComparisonAnswer.js still reuses ragGenerationConfig.js's model/
// temperature/token/thinking-level constants unchanged.

// A comparison needs at least two things to compare.
export const RAG_COMPARISON_MIN_PRODUCTS = 2;

// A reasonable ceiling so a customer (or a misbehaving/malicious client)
// can never ask to "compare" an unbounded list - also keeps the generated
// context small and the answer genuinely comparative rather than a catalog
// dump.
export const RAG_COMPARISON_MAX_PRODUCTS = 4;
