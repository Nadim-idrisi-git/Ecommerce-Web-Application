// Single source of truth for RAG answer-generation constants. None of these
// are ever accepted from a caller - generateRagAnswer() only ever takes a
// query and candidates, never a model/temperature/prompt override.

// Same model already used by chatController.js/intentController.js/
// voiceController.js. No shared model-config constant exists anywhere in
// this backend to import (each of those three files hardcodes the string
// independently) - this becomes the first such constant, matching the
// value already in production use rather than introducing a different one.
export const RAG_GENERATION_MODEL = "gemini-3.6-flash";

// Low temperature: this is grounded factual product Q&A, not creative
// writing - minimizing variance also minimizes the chance of drifting from
// the supplied context.
export const RAG_GENERATION_TEMPERATURE = 0.3;

// Enough for a concise multi-product answer, bounded so a single call can
// never run away in cost/latency. Raised from an initial 500 after a live
// smoke test showed the model's natural verbose/bulleted formatting style
// getting cut off mid-sentence when covering several products at 500 -
// 800 was the smallest bump that stopped truncating in that same test.
export const RAG_GENERATION_MAX_OUTPUT_TOKENS = 800;

// Matches the thinkingLevel already used for every other conversational
// generateContent call in this backend (chatController/intentController/
// voiceController) - composing a grounded reply from supplied context is
// the same shape of task, not one that benefits from deeper reasoning.
export const RAG_GENERATION_THINKING_LEVEL = "low";

// Bump on a real prompt/behavior change (not a timestamp) - mirrors the
// same versioning convention as utils/rag/embeddingConfig.js.
export const RAG_GENERATION_VERSION = "v1";

// Candidates beyond this are never used, even if a caller passes more -
// matches module 5's RAG_HYBRID_FINAL_LIMIT, since that's already the
// intended final-result size feeding into generation.
export const RAG_GENERATION_MAX_CANDIDATES = 8;

// Fewer than this many *valid* candidates after filtering means there's
// nothing worth grounding an answer in - see buildRagContext.js/
// generateRagAnswer.js's no-context path, which makes zero Gemini calls.
export const RAG_GENERATION_MIN_USEFUL_CANDIDATES = 1;

// Hard ceiling on the assembled product-context block, independent of
// candidate count - protects against a small number of unusually long
// candidate texts still producing an oversized prompt.
export const RAG_GENERATION_MAX_CONTEXT_CHARS = 6000;

// Query validation (trim/empty/max-length) is intentionally NOT
// re-defined here - utils/rag/embedRagQuery.js's normalizeRagQuery() (from
// module 4) already owns that, and this module reuses it rather than
// creating a second, possibly-diverging length limit.
