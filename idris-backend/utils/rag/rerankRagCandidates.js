// Lightweight, deterministic reranker - no LLM call. Applies bounded,
// explainable boosts (documented with exact weights in hybridSearchConfig.js)
// on top of each candidate's RRF score, using only signals that are
// actually present in the RAG document's metadata/text - never invents an
// attribute a product doesn't have.
import {
  RAG_RERANK_WEIGHTS,
  RAG_RERANK_MAX_BOOST_FRACTION,
  RAG_RERANK_MIN_TOKEN_LENGTH,
} from "./hybridSearchConfig.js";
import { tokenizeQuery } from "./queryTokenize.js";
import { detectPriceIntent, detectSoftPriceIntent, priceSatisfiesIntent, priceProximity } from "./priceIntent.js";
import { detectExclusions, hasExclusions } from "./negativeIntent.js";
import { SOFT_PREFERENCE_SYNONYMS, SHOPPING_INTELLIGENCE_WEIGHTS } from "./shoppingIntentConfig.js";

const includesToken = (haystackLower, token) =>
  token.length >= RAG_RERANK_MIN_TOKEN_LENGTH && haystackLower.includes(token);

const EXCLUSION_METADATA_FIELDS = ["color", "material", "fit", "pattern", "productType"];

// Whether a candidate matches any explicitly-excluded value (color/
// material/fit/pattern/productType) - a scalar-field, case-insensitive
// exact-ish match (substring, same convention as the rest of this file),
// since metadata casing varies by field (color lowercase, others Title
// Case - see utils/rag/searchRag.js's sanitizeRagFilters for the same
// convention).
export const candidateViolatesExclusions = (candidate, exclusions) => {
  if (!hasExclusions(exclusions)) return false;

  const metadata = candidate.metadata || {};

  return EXCLUSION_METADATA_FIELDS.some((field) => {
    const excludedValues = exclusions[field] || [];
    if (excludedValues.length === 0) return false;

    const value = String(metadata[field] || "").toLowerCase();
    if (!value) return false;

    return excludedValues.some((excluded) => value.includes(excluded));
  });
};

// Hard-filters out any candidate violating an explicit exclusion, BEFORE
// scoring - an excluded product must never reach the final ranked list,
// never just receive a lower score (same principle as module 8's
// candidateSatisfiesFilters for price/attribute filters).
export const filterExcludedCandidates = (candidates, exclusions) => {
  if (!hasExclusions(exclusions)) return candidates;
  return candidates.filter((candidate) => !candidateViolatesExclusions(candidate, exclusions));
};

// LIVE-TESTING FINDING (module 10): a query like "mujhe slim fit nahi
// chahiye jacket" ("I don't want slim fit, [give me a] jacket") is
// genuinely ambiguous for detectExclusions()'s local, clause-unaware regex
// matching - "nahi chahiye jacket" reads exactly like the supported "nahi
// chahiye <excluded term>" shape, so "jacket" itself gets swept into the
// exclusion set even though the customer's own explicit productType filter
// (already sanitized/whitelisted via assistantTools.js's tool schema) is
// "jacket" - i.e. the SAME product they're asking for. Left unguarded, this
// silently zeroed out every jacket candidate (reproduced live). Rather than
// attempt a riskier clause-boundary parse that could easily regress the
// task's own supported example ("mujhe slim fit nahi chahiye" with no
// trailing noun), this applies one narrow, principled rule: an explicit
// structural inclusion filter for a field must never be cancelled by a
// same-valued exclusion inferred from ambiguous query text - the sanitized
// hard filter always wins for that field (same "hard filters win"
// precedent as module 8's candidateSatisfiesFilters).
export const stripExclusionsContradictingHardFilter = (exclusions, hardFilter) => {
  if (!hardFilter || typeof hardFilter !== "object") return exclusions;

  const result = {};
  Object.entries(exclusions).forEach(([field, values]) => {
    const hardValue = hardFilter[`metadata.${field}`];
    if (typeof hardValue !== "string") {
      result[field] = values;
      return;
    }
    const hardValueLower = hardValue.toLowerCase();
    result[field] = values.filter((value) => value.toLowerCase() !== hardValueLower);
  });
  return result;
};

// One-directional substring match (query token found inside the metadata
// value) - this is what lets "purple" match "purple multicolor" without
// requiring exact equality, per module 5 part 9's explicit example.
const anyTokenMatches = (tokens, valueLower) =>
  Boolean(valueLower) && tokens.some((token) => includesToken(valueLower, token));

// Exported separately from rerankRagCandidates() so a single candidate's
// boost/matched-signal breakdown can be unit-tested directly.
export const computeRerankBoost = (candidate, query, tokens, priceIntent, softPriceIntent) => {
  const metadata = candidate.metadata || {};
  const textLower = (candidate.text || "").toLowerCase();
  const nameLine = textLower.split("\n")[0] || "";
  const normalizedQuery = (query || "").trim().toLowerCase();

  let boost = 0;
  const matched = [];

  // 1-2. Exact phrase + product name token overlap.
  if (normalizedQuery.length >= RAG_RERANK_MIN_TOKEN_LENGTH && textLower.includes(normalizedQuery)) {
    boost += RAG_RERANK_WEIGHTS.exactPhraseMatch;
    matched.push("exactPhraseMatch");
  }

  if (tokens.length > 0) {
    const matchedTokenCount = tokens.filter((token) => includesToken(nameLine, token)).length;
    const ratio = matchedTokenCount / tokens.length;
    if (ratio > 0) {
      boost += RAG_RERANK_WEIGHTS.nameTokenMatch * ratio;
      matched.push(`nameTokenMatch(${matchedTokenCount}/${tokens.length})`);
    }
  }

  // 3-7. Scalar metadata fields: category, productType, color, material, pattern, gender.
  const scalarFieldChecks = [
    ["productType", RAG_RERANK_WEIGHTS.productTypeMatch, "productTypeMatch"],
    ["gender", RAG_RERANK_WEIGHTS.genderMatch, "genderMatch"],
    ["color", RAG_RERANK_WEIGHTS.colorMatch, "colorMatch"],
    ["material", RAG_RERANK_WEIGHTS.materialMatch, "materialMatch"],
    ["category", RAG_RERANK_WEIGHTS.categoryMatch, "categoryMatch"],
    ["pattern", RAG_RERANK_WEIGHTS.patternMatch, "patternMatch"],
  ];

  scalarFieldChecks.forEach(([field, weight, label]) => {
    const value = String(metadata[field] || "").toLowerCase();
    if (anyTokenMatches(tokens, value)) {
      boost += weight;
      matched.push(label);
    }
  });

  // 9. Seasons (array).
  const seasons = (metadata.seasons || []).map((value) => String(value).toLowerCase());
  if (seasons.some((value) => anyTokenMatches(tokens, value))) {
    boost += RAG_RERANK_WEIGHTS.seasonMatch;
    matched.push("seasonMatch");
  }

  // 10. Occasions + style (arrays, combined into one signal).
  const occasionsAndStyle = [...(metadata.occasions || []), ...(metadata.style || [])].map((value) =>
    String(value).toLowerCase(),
  );
  if (occasionsAndStyle.some((value) => anyTokenMatches(tokens, value))) {
    boost += RAG_RERANK_WEIGHTS.occasionOrStyleMatch;
    matched.push("occasionOrStyleMatch");
  }

  // 11. Features (array).
  const features = (metadata.features || []).map((value) => String(value).toLowerCase());
  if (features.some((value) => anyTokenMatches(tokens, value))) {
    boost += RAG_RERANK_WEIGHTS.featureMatch;
    matched.push("featureMatch");
  }

  // 13. Bestseller - only rewarded if the customer actually asked for it.
  if (/\bbest\s?sell(er|ing)?\b|\bpopular\b|\btrending\b/.test(normalizedQuery) && metadata.bestseller === true) {
    boost += RAG_RERANK_WEIGHTS.bestsellerMatch;
    matched.push("bestsellerMatch");
  }

  // 12. Explicit price constraint - reward satisfying it, penalize violating
  // it (never inferred; only when the query actually states one).
  if (priceIntent) {
    const satisfied = priceSatisfiesIntent(metadata.price, priceIntent);
    if (satisfied === true) {
      boost += RAG_RERANK_WEIGHTS.priceSatisfied;
      matched.push("priceSatisfied");
    } else if (satisfied === false) {
      boost += RAG_RERANK_WEIGHTS.priceViolated;
      matched.push("priceViolated");
    }
  }

  // MODULE 10: soft ("around X") price preference - closeness to the
  // stated target scales a small bounded boost, never a cutoff (that's the
  // whole point of "soft" vs. the hard priceSatisfied/priceViolated above).
  if (softPriceIntent) {
    const proximity = priceProximity(metadata.price, softPriceIntent);
    if (proximity > 0) {
      boost += SHOPPING_INTELLIGENCE_WEIGHTS.softPriceProximity * proximity;
      matched.push(`softPriceProximity(${proximity.toFixed(2)})`);
    }
  }

  // MODULE 10: soft-preference adjectives (stylish/elegant/comfortable/...)
  // matched via an explicit, documented synonym mapping onto this
  // catalog's real style/occasions/features vocabulary - never a fabricated
  // "premium"/"attractive" quality claim (see shoppingIntentConfig.js).
  // Capped once regardless of how many preference words matched.
  const preferenceHaystack = [
    ...(metadata.style || []),
    ...(metadata.occasions || []),
    ...(metadata.features || []),
  ]
    .map((value) => String(value).toLowerCase())
    .join(" ");

  const matchedPreference = tokens.some((token) => {
    const synonyms = SOFT_PREFERENCE_SYNONYMS[token];
    return synonyms && synonyms.some((synonym) => preferenceHaystack.includes(synonym));
  });
  if (matchedPreference) {
    boost += SHOPPING_INTELLIGENCE_WEIGHTS.softPreferenceMatch;
    matched.push("softPreferenceMatch");
  }

  const boundedBoost = Math.max(-RAG_RERANK_MAX_BOOST_FRACTION, Math.min(RAG_RERANK_MAX_BOOST_FRACTION, boost));

  return { boost: boundedBoost, matched };
};

// candidates: array of { ...RAG fields, rrfScore } (rrfScore must already
// be computed - see computeRRFScore.js). Returns the same candidates with
// rerankScore/matchedSignals added, sorted best-first. RRF stays the
// dominant signal because every boost multiplies (never flatly adds to)
// the candidate's own rrfScore - see hybridSearchConfig.js's comment for
// the exact rationale.
// MODULE 11: `overrides` is an OPTIONAL escape hatch - when the caller
// already has a more accurate, multi-turn/Devanagari-aware exclusions/
// price reading from shoppingQueryPlan.js (utils/rag/shoppingQueryPlan.js),
// it hands that down here INSTEAD of having this function re-derive a
// weaker, single-turn/Romanized-only reading from `query` alone. Nothing
// here re-implements detectExclusions()/detectPriceIntent()/
// detectSoftPriceIntent() - shoppingQueryPlan.js still calls those exact
// functions itself, just across more text than a single `query` string.
// Omitted entirely (every existing caller/test), behavior is byte-for-byte
// what it was before this parameter existed.
export const rerankRagCandidates = (candidates, query, hardFilter = {}, overrides = {}) => {
  const tokens = tokenizeQuery(query);
  const priceIntent = overrides.priceIntent !== undefined ? overrides.priceIntent : detectPriceIntent(query);
  const softPriceIntent =
    overrides.softPriceIntent !== undefined ? overrides.softPriceIntent : detectSoftPriceIntent(query);

  // MODULE 10: explicit exclusions are enforced as a HARD pre-scoring
  // filter - an excluded candidate is removed entirely, not merely
  // demoted. Computed once per query, same as priceIntent above.
  // `hardFilter` (the same sanitized mongoFilter hybridSearchRag.js already
  // computes) strips any exclusion that would contradict an explicit
  // structural inclusion filter for the same field - see
  // stripExclusionsContradictingHardFilter's comment above.
  const rawExclusions = overrides.exclusions || detectExclusions(query);
  const exclusions = stripExclusionsContradictingHardFilter(rawExclusions, hardFilter);
  const eligibleCandidates = filterExcludedCandidates(candidates, exclusions);

  const reranked = eligibleCandidates.map((candidate) => {
    const { boost, matched } = computeRerankBoost(candidate, query, tokens, priceIntent, softPriceIntent);
    return {
      ...candidate,
      rerankScore: candidate.rrfScore * (1 + boost),
      matchedSignals: matched,
    };
  });

  reranked.sort((a, b) => b.rerankScore - a.rerankScore);

  return reranked;
};
