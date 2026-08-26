// Hybrid recall + reranking orchestrator - the module 5 entry point. Wires
// together (without reimplementing any of them): module 4's searchRag()
// (vector), lexicalSearchRag.js (keyword), mergeRagCandidates.js (dedup),
// computeRRFScore.js (fusion), and rerankRagCandidates.js (deterministic
// reranking). No Gemini generation call happens here - only the one query
// embedding call already made inside searchRag().
import { searchRag, sanitizeRagFilters } from "./searchRag.js";
import { searchRagLexical } from "./lexicalSearchRag.js";
import { mergeRagCandidates } from "./mergeRagCandidates.js";
import { computeRRFScore } from "./computeRRFScore.js";
import { rerankRagCandidates } from "./rerankRagCandidates.js";
import {
  RAG_HYBRID_VECTOR_LIMIT,
  RAG_HYBRID_LEXICAL_LIMIT,
  RAG_HYBRID_FINAL_LIMIT,
  RAG_RRF_K,
} from "./hybridSearchConfig.js";

export class HybridRagSearchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HybridRagSearchError";
    this.code = code;
  }
}

// Exported for direct testing (see scripts/testHybridRetrieval.js) - bounds
// the final result count to [1, RAG_HYBRID_FINAL_LIMIT] regardless of what
// a caller asks for.
export const clampFinalLimit = (limit) => {
  const n = Number(limit);
  if (!Number.isFinite(n)) return RAG_HYBRID_FINAL_LIMIT;
  return Math.min(RAG_HYBRID_FINAL_LIMIT, Math.max(1, Math.round(n)));
};

// Pure result-shaping step, exported so tests can assert the compact shape
// (no `embedding`, no internal Mongo fields) without running a live search.
export const shapeHybridResult = (candidate) => ({
  sourceId: candidate.sourceId,
  type: candidate.type,
  text: candidate.text,
  metadata: candidate.metadata,
  scores: {
    vectorRank: candidate.vectorRank,
    lexicalRank: candidate.lexicalRank,
    rrfScore: candidate.rrfScore,
    rerankScore: candidate.rerankScore,
  },
});

// MODULE 8 hardening fix: options.filters is applied natively by the vector
// branch (Atlas $vectorSearch.filter, inside searchRag()), but the lexical
// branch has no filterable fields at all - rag_text_search_index (module 5)
// only maps `text`, so searchRagLexical() can't be given a filter to apply
// even in principle. Left as-is, a lexically-recalled candidate that
// violates an explicit constraint (e.g. a customer's stated price budget)
// could still reach the merged/reranked result set - the deterministic
// reranker's priceViolated penalty discourages but does not exclude it.
// This reuses module 4's own sanitizeRagFilters() (not a second filter
// implementation) to deterministically drop any merged candidate that
// violates an explicitly-provided constraint, regardless of which branch
// recalled it - closing the gap without touching either Atlas index.
const candidateSatisfiesFilters = (candidate, mongoFilter) => {
  const metadata = candidate.metadata || {};

  return Object.entries(mongoFilter).every(([key, expected]) => {
    const field = key.replace(/^metadata\./, "");
    const actual = metadata[field];

    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if (expected.$gte !== undefined && !(Number(actual) >= expected.$gte)) return false;
      if (expected.$lte !== undefined && !(Number(actual) <= expected.$lte)) return false;
      return true;
    }

    return actual === expected;
  });
};

// query: string
// options.filters: passed through to the vector branch's metadata prefilter
//   (module 4's sanitizeRagFilters - not duplicated here) AND enforced as a
//   hard post-merge constraint on the combined result set (see above).
// options.limit: final result count, bounded to [1, RAG_HYBRID_FINAL_LIMIT]
//
// Returns { results, diagnostics }. `results` is the compact ranked array
// (never contains `embedding`); `diagnostics` is counts/warnings only, for
// test/dev observability (part 15) - a production caller can ignore it.
export const searchHybridRag = async (query, options = {}) => {
  const finalLimit = clampFinalLimit(options.limit);

  // Run both recall branches concurrently. Promise.allSettled (not
  // Promise.all) is used deliberately: the task's own failure policy -
  // "if one branch fails, return the other's results with a warning; only
  // throw if both fail" - is impossible to implement with Promise.all,
  // which rejects and discards the other branch's outcome the instant
  // either promise rejects. allSettled still starts both requests in
  // parallel (the actual latency requirement), it just doesn't short-
  // circuit on a single failure.
  const [vectorSettled, lexicalSettled] = await Promise.allSettled([
    searchRag(query, { limit: RAG_HYBRID_VECTOR_LIMIT, filters: options.filters }),
    searchRagLexical({ query, limit: RAG_HYBRID_LEXICAL_LIMIT }),
  ]);

  const warnings = [];
  const vectorResults = vectorSettled.status === "fulfilled" ? vectorSettled.value : [];
  const lexicalResults = lexicalSettled.status === "fulfilled" ? lexicalSettled.value : [];

  if (vectorSettled.status === "rejected") {
    warnings.push(`vector recall failed: ${vectorSettled.reason?.message || "unknown error"}`);
  }
  if (lexicalSettled.status === "rejected") {
    warnings.push(`lexical recall failed: ${lexicalSettled.reason?.message || "unknown error"}`);
  }

  if (vectorSettled.status === "rejected" && lexicalSettled.status === "rejected") {
    throw new HybridRagSearchError("RETRIEVAL_FAILED", "Both vector and lexical retrieval failed.");
  }

  const merged = mergeRagCandidates(vectorResults, lexicalResults);

  // hardFilter is passed through to rerankRagCandidates() so a query-
  // derived exclusion (module 10's negativeIntent.js) can never contradict
  // an explicit structural inclusion filter for the same field - e.g. a
  // customer asking for a "jacket" via the tool's productType filter must
  // never have every jacket candidate excluded again just because the same
  // query text ambiguously reads as excluding "jacket" too (reproduced
  // live - see rerankRagCandidates.js's stripExclusionsContradictingHardFilter).
  // MODULE 11: an optional, more-accurate exclusions/price reading (from
  // shoppingQueryPlan.js, threaded in by assistantRag.js) that overrides
  // rerankRagCandidates()'s own single-turn/query-string-only detection -
  // see rerankRagCandidates.js's own comment. Omitted by every caller that
  // predates this, so behavior is unchanged unless a caller opts in.
  const rerankOverrides = options.rerankOverrides || {};

  const rankAndSlice = (candidatePool, hardFilter) => {
    const withRRF = candidatePool.map((candidate) => ({
      ...candidate,
      rrfScore: computeRRFScore(candidate.vectorRank, candidate.lexicalRank, RAG_RRF_K),
    }));
    // Exclusions (module 10's negativeIntent.js) are enforced inside
    // rerankRagCandidates() itself, as a hard pre-scoring filter - see
    // that file. This function only carries the module 8 positive-filter
    // enforcement (gender/category/color/price/etc.).
    const reranked = rerankRagCandidates(withRRF, query, hardFilter, rerankOverrides);
    return reranked.slice(0, finalLimit);
  };

  const mongoFilter = sanitizeRagFilters(options.filters);
  const constraintFiltered =
    Object.keys(mongoFilter).length > 0
      ? merged.filter((candidate) => candidateSatisfiesFilters(candidate, mongoFilter))
      : merged;

  let final = rankAndSlice(constraintFiltered, mongoFilter);
  let relaxed = null;

  // MODULE 10 no-result relaxation (part 12), deliberately narrow in
  // scope: only ever relaxes an explicit PRICE cap, and only when nothing
  // survives the hard filters/exclusions otherwise. Never relaxes gender,
  // category, productType, color, or an explicit exclusion - those stay
  // hard no matter what. On success the caller gets `relaxed` so
  // generation can say so honestly instead of silently complying or
  // silently returning nothing.
  if (final.length === 0 && options.filters && Number.isFinite(Number(options.filters.maxPrice))) {
    const relaxedFilters = { ...options.filters, maxPrice: undefined };
    const relaxedMongoFilter = sanitizeRagFilters(relaxedFilters);
    const relaxedPool =
      Object.keys(relaxedMongoFilter).length > 0
        ? merged.filter((candidate) => candidateSatisfiesFilters(candidate, relaxedMongoFilter))
        : merged;

    const relaxedFinal = rankAndSlice(relaxedPool, relaxedMongoFilter);
    if (relaxedFinal.length > 0) {
      final = relaxedFinal;
      relaxed = { field: "maxPrice", requestedValue: Number(options.filters.maxPrice) };
    }
  }

  return {
    results: final.map(shapeHybridResult),
    relaxed,
    diagnostics: {
      vectorCount: vectorResults.length,
      lexicalCount: lexicalResults.length,
      mergedCount: merged.length,
      constraintFilteredCount: merged.length - constraintFiltered.length,
      finalCount: Math.min(final.length, finalLimit),
      warnings,
    },
  };
};
