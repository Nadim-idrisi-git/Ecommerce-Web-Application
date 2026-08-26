// Server-controlled constants for hybrid recall + reranking. Nothing here
// is ever accepted from a caller - keeps every magic number in one place
// instead of scattered across lexicalSearchRag.js/hybridSearchRag.js/
// rerankRagCandidates.js.

// Lexical (Atlas Search, not vectorSearch) index on ragdocuments.text.
export const RAG_LEXICAL_INDEX_NAME = "rag_text_search_index";

export const RAG_LEXICAL_LIMIT_DEFAULT = 20;
export const RAG_LEXICAL_LIMIT_MAX = 30;

// Per-branch recall pool sizes for hybrid search specifically (module 4's
// searchRag() keeps its own smaller defaults for direct/non-hybrid callers -
// see utils/rag/vectorSearchConfig.js).
export const RAG_HYBRID_VECTOR_LIMIT = 20;
export const RAG_HYBRID_LEXICAL_LIMIT = 20;
export const RAG_HYBRID_FINAL_LIMIT = 8;

// Reciprocal Rank Fusion constant - standard default from the RRF
// literature (higher k flattens the influence of very top ranks; 60 is the
// conventional choice, not tuned specifically for this catalog).
export const RAG_RRF_K = 60;

// Deterministic reranker boosts (see utils/rag/rerankRagCandidates.js).
// Every boost is a *fraction* of the candidate's own RRF score, not a flat
// addition - so a candidate with a weak RRF score still can't leapfrog a
// strongly-recalled one just by matching one field, and the scale is
// self-relative regardless of RRF's absolute magnitude. finalScore =
// rrfScore * (1 + min(sum of matched boosts, RAG_RERANK_MAX_BOOST_FRACTION)).
//
// Ordering rationale (task's part 11): exact name/phrase matches get the
// largest weight; broad metadata matches get progressively smaller ones;
// an explicit price-constraint violation is penalized harder than any
// single positive match is rewarded, since ignoring a customer's stated
// budget is a worse mistake than missing one attribute.
export const RAG_RERANK_WEIGHTS = {
  exactPhraseMatch: 0.40, // full normalized query appears verbatim in the RAG text
  nameTokenMatch: 0.20, // scaled by the fraction of query tokens found in the product name line
  productTypeMatch: 0.15,
  genderMatch: 0.10,
  colorMatch: 0.10,
  priceSatisfied: 0.10,
  materialMatch: 0.08,
  categoryMatch: 0.08,
  patternMatch: 0.06,
  seasonMatch: 0.05,
  occasionOrStyleMatch: 0.05,
  featureMatch: 0.05, // capped once, regardless of how many features matched
  bestsellerMatch: 0.03,
  priceViolated: -0.30, // penalty, not a boost - explicit budget stated and not met
};

export const RAG_RERANK_MAX_BOOST_FRACTION = 1.5;

// Only tokens at least this long participate in metadata substring
// matching (part 9) - guards against a short/generic token like "a" or "to"
// spuriously "matching" nearly every metadata value.
export const RAG_RERANK_MIN_TOKEN_LENGTH = 3;
