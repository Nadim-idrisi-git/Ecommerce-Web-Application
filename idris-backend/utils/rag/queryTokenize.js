// Small deterministic tokenizer for the reranker's attribute-matching logic
// (see rerankRagCandidates.js). Deliberately conservative - only strips
// punctuation and a short list of universally-common English function
// words. Does NOT attempt to detect or strip Hindi/Hinglish function words
// (mujhe/ke/liye/chahiye etc.) since there's no reliable list for that here
// and mis-stripping risks dropping a meaningful term; the query text itself
// is left otherwise intact so phrase matching still sees the full query.
const STOP_WORDS = new Set([
  "a", "an", "the", "for", "of", "in", "on", "to", "and", "or",
  "with", "is", "are", "this", "that", "some", "any",
]);

export const tokenizeQuery = (query) => {
  if (typeof query !== "string") return [];

  const normalized = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return [];

  return normalized.split(" ").filter((token) => token && !STOP_WORDS.has(token));
};
