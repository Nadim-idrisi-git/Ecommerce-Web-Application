import { SOFT_PRICE_PATTERN } from "./shoppingIntentConfig.js";

// "k" shorthand ("1k", "2.5k") - a different numeric shape than the
// comma-grouped \d+(?:,\d{3})* pattern, so parsed separately.
const parseAmount = (raw) => {
  const kShorthand = String(raw).match(/^(\d+(?:\.\d+)?)\s*k$/i);
  if (kShorthand) return Math.round(Number(kShorthand[1]) * 1000);
  return Number(String(raw).replace(/,/g, ""));
};

const AMOUNT = "(\\d+(?:,\\d{3})*(?:\\.\\d+)?\\s*k|\\d+(?:,\\d{3})*)";
const CURRENCY_PREFIX = "(?:rs\\.?|₹|rupees|rupaye|rupay)?\\s*";

// Detects an EXPLICIT HARD price constraint stated in the query text, for
// reranking support only (see rerankRagCandidates.js) - this does not
// touch or replace module 4's structured minPrice/maxPrice filter
// (utils/rag/searchRag.js's sanitizeRagFilters), which still requires the
// caller to pass an already-structured filter object. Never infers a
// budget the customer didn't state.
//
// Return shape is unchanged from the original module 5 version -
// {minPrice, maxPrice} | null - existing callers (rerankRagCandidates.js,
// scripts/testHybridRetrieval.js) rely on this exact contract. MODULE 10
// extends the *patterns* recognized (Hinglish "ke andar"/"tak", a plain
// "1500-2500" range, "1k" shorthand) without changing what's returned.
export const detectPriceIntent = (query) => {
  if (typeof query !== "string" || !query.trim()) return null;

  const normalized = query.toLowerCase();

  const between = normalized.match(
    new RegExp(`\\bbetween\\s+${CURRENCY_PREFIX}${AMOUNT}\\s+and\\s+${CURRENCY_PREFIX}${AMOUNT}`),
  );
  if (between) {
    const a = parseAmount(between[1]);
    const b = parseAmount(between[2]);
    return { minPrice: Math.min(a, b), maxPrice: Math.max(a, b) };
  }

  const range = normalized.match(new RegExp(`\\b${AMOUNT}\\s*-\\s*${AMOUNT}\\b`));
  if (range) {
    const a = parseAmount(range[1]);
    const b = parseAmount(range[2]);
    return { minPrice: Math.min(a, b), maxPrice: Math.max(a, b) };
  }

  // English (under/below/less than/upto/not above/no more than/not more
  // than) + Hinglish (ke andar/tak) hard upper-bound phrasing - the hard
  // Mongo filter (fed by Gemini's own tool-argument extraction, not this
  // file) already handled Hinglish phrasing robustly; this keeps the
  // reranker's own signal consistent with that rather than only ever
  // recognizing the English forms. MODULE 11: "not above"/"no more than"/
  // "not more than" added so a compound query like "around 2000 but not
  // above 2500" still yields a hard max (2500) alongside the separate soft
  // target (2000, from detectSoftPriceIntent) - see shoppingQueryPlan.js.
  const maxOnly = normalized.match(
    new RegExp(
      `\\b(?:under|below|less than|up ?to|not above|no more than|not more than)\\s+${CURRENCY_PREFIX}${AMOUNT}` +
      `|${AMOUNT}\\s*${CURRENCY_PREFIX}(?:ke\\s+and[ae]r|tak)\\b`,
    ),
  );
  if (maxOnly) {
    return { minPrice: null, maxPrice: parseAmount(maxOnly[1] || maxOnly[2]) };
  }

  return null;
};

// NEW: a SOFT ("around X") price signal - a ranking preference, never a
// hard cutoff. Kept as a separate function/return shape rather than
// folded into detectPriceIntent() so that function's existing contract
// (used by rerankRagCandidates.js and its own tests) is untouched.
export const detectSoftPriceIntent = (query) => {
  if (typeof query !== "string" || !query.trim()) return null;

  const match = query.toLowerCase().match(SOFT_PRICE_PATTERN);
  if (!match) return null;

  return { targetPrice: parseAmount(match[1] || match[2]) };
};

// Whether a candidate's price satisfies a detected HARD constraint. A
// candidate with no known price never counts as "satisfied" or "violated"
// - there's nothing to compare, so it gets neither the reward nor the
// penalty.
export const priceSatisfiesIntent = (price, intent) => {
  if (!intent || !Number.isFinite(Number(price))) return null;

  const value = Number(price);
  if (intent.minPrice !== null && intent.minPrice !== undefined && value < intent.minPrice) return false;
  if (intent.maxPrice !== null && intent.maxPrice !== undefined && value > intent.maxPrice) return false;
  return true;
};

// Bounded [0,1] closeness of a candidate's price to a soft "around X"
// target - 1.0 at the exact target, decaying linearly to 0 by the time the
// price is 50% away from it in either direction. Used only to scale a
// small ranking boost (shoppingIntentConfig.js's softPriceProximity) -
// never a filter.
export const priceProximity = (price, softIntent) => {
  if (!softIntent || !Number.isFinite(Number(price)) || !Number.isFinite(Number(softIntent.targetPrice))) {
    return 0;
  }

  const value = Number(price);
  const target = Number(softIntent.targetPrice);
  if (target <= 0) return 0;

  const relativeDistance = Math.abs(value - target) / target;
  return Math.max(0, 1 - relativeDistance / 0.5);
};
