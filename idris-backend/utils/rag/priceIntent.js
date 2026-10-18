import { SOFT_PRICE_PATTERN } from "./shoppingIntentConfig.js";

// "k" shorthand ("1k", "2.5k") - a different numeric shape than the
// comma-grouped \d+(?:,\d{3})* pattern, so parsed separately.
const parseAmount = (raw) => {
  const kShorthand = String(raw).match(/^(\d+(?:\.\d+)?)\s*k$/i);
  if (kShorthand) return Math.round(Number(kShorthand[1]) * 1000);
  return Number(String(raw).replace(/,/g, ""));
};

const AMOUNT = "(\\d+(?:,\\d{3})*(?:\\.\\d+)?\\s*k|\\d+(?:,\\d{3})*)";

// Spoken Indian amounts -> digits, before any pattern below runs. Prices are
// in the thousands, and customers say them the way they speak: "teen hazaar
// tak", "do hazaar paanch sau", "dedh hazaar", "dhai hazaar", "saadhe teen
// hazaar", "३०००", "ढाई हज़ार तक". A number word is only converted when a
// multiplier (hazaar/sau) follows it, so "dikha do" or "ek jacket" are never
// read as amounts.
const NUMBER_WORDS = {
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, paanch: 5, panch: 5,
  chhe: 6, chhah: 6, chah: 6, saat: 7, sat: 7, aath: 8, ath: 8, nau: 9, das: 10, dus: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5, "छह": 6, "छः": 6,
  "सात": 7, "आठ": 8, "नौ": 9, "दस": 10,
  dedh: 1.5, dhai: 2.5, dhaai: 2.5, "डेढ़": 1.5, "डेढ": 1.5, "ढाई": 2.5,
};
const NUMBER_PREFIXES = {
  sava: 0.25, savaa: 0.25, "सवा": 0.25,
  sadhe: 0.5, saadhe: 0.5, sade: 0.5, saade: 0.5, "साढ़े": 0.5, "साढे": 0.5,
};
const MULTIPLIERS = {
  hazaar: 1000, hazar: 1000, hajar: 1000, hajaar: 1000, thousand: 1000, "हज़ार": 1000, "हजार": 1000,
  sau: 100, so: 100, hundred: 100, "सौ": 100,
};
const DEVANAGARI_DIGITS = "०१२३४५६७८९";
// Devanagari price phrasing -> the Roman forms the patterns below match.
const DEVANAGARI_PHRASES = [
  [/से\s*कम/g, " se kam "], [/से\s*नीचे/g, " se neeche "], [/के\s*नीचे/g, " ke neeche "],
  [/से\s*ऊपर/g, " se upar "], [/से\s*(?:ज़्यादा|ज्यादा)/g, " se zyada "],
  [/के\s*अंदर/g, " ke andar "], [/के\s*बीच/g, " ke beech "], [/तक/g, " tak "], [/से/g, " se "],
  [/रुपये|रुपए|रूपये|रुपया/g, " rupaye "], [/बजट/g, " budget "],
];

const cleanToken = (token) => token.replace(/^[^\p{L}\p{N}.]+|[^\p{L}\p{N}.]+$/gu, "");

export const normalizeSpokenAmounts = (text) => {
  let value = String(text || "").replace(/[०-९]/g, (digit) => String(DEVANAGARI_DIGITS.indexOf(digit)));
  DEVANAGARI_PHRASES.forEach(([pattern, replacement]) => {
    value = value.replace(pattern, replacement);
  });

  const tokens = value.split(/\s+/).filter(Boolean);
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    let total = 0;
    let lastMultiplier = Infinity;
    let j = i;
    // One or more "<number> <multiplier>" groups in descending order:
    // "do hazaar paanch sau" -> 2000 + 500.
    for (;;) {
      let k = j;
      let prefix = 0;
      const first = cleanToken(tokens[k] || "").toLowerCase();
      if (NUMBER_PREFIXES[first] !== undefined) {
        prefix = NUMBER_PREFIXES[first];
        k += 1;
      }
      const word = cleanToken(tokens[k] || "").toLowerCase();
      const base = /^\d+(?:\.\d+)?$/.test(word) ? Number(word) : NUMBER_WORDS[word];
      const multiplier = MULTIPLIERS[cleanToken(tokens[k + 1] || "").toLowerCase()];
      if (base === undefined || !multiplier || multiplier >= lastMultiplier) break;
      total += (base + prefix) * multiplier;
      lastMultiplier = multiplier;
      j = k + 2;
    }
    if (j > i) {
      out.push(String(Math.round(total)));
      i = j;
    } else {
      out.push(tokens[i]);
      i += 1;
    }
  }
  return out.join(" ");
};
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

  const normalized = normalizeSpokenAmounts(query).toLowerCase();

  const between = normalized.match(
    new RegExp(`\\bbetween\\s+${CURRENCY_PREFIX}${AMOUNT}\\s+and\\s+${CURRENCY_PREFIX}${AMOUNT}`),
  );
  if (between) {
    const a = parseAmount(between[1]);
    const b = parseAmount(between[2]);
    return { minPrice: Math.min(a, b), maxPrice: Math.max(a, b) };
  }

  const range =
    normalized.match(new RegExp(`\\b${AMOUNT}\\s*-\\s*${AMOUNT}\\b`)) ||
    // Hinglish range: "1000 se 2000 tak", "1000 se 2000 ke beech".
    normalized.match(new RegExp(`\\b${CURRENCY_PREFIX}${AMOUNT}\\s*${CURRENCY_PREFIX}se\\s+${CURRENCY_PREFIX}${AMOUNT}\\s*${CURRENCY_PREFIX}(?:tak|ke\\s+beech)\\b`));
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
  // Hinglish additions: "1500 se kam", "2000 se neeche", "budget 2500",
  // "3000 ka budget", "max 2000".
  const maxOnly = normalized.match(
    new RegExp(
      `\\b(?:under|below|less than|up ?to|within|not above|no more than|not more than|max(?:imum)?|budget(?:\\s+(?:hai|is|of))?)\\s+${CURRENCY_PREFIX}${AMOUNT}` +
      `|${AMOUNT}\\s*${CURRENCY_PREFIX}(?:ke\\s+and[ae]r|tak|se\\s+(?:kam|neeche|niche)|ke\\s+(?:neeche|niche)|(?:ka|ki|ke)?\\s*budget|max(?:imum)?)\\b`,
    ),
  );
  if (maxOnly) {
    return { minPrice: null, maxPrice: parseAmount(maxOnly[1] || maxOnly[2]) };
  }

  // Lower bound only: "above 2000", "2000 se upar", "1500 se zyada".
  const minOnly = normalized.match(
    new RegExp(
      `\\b(?:above|over|more than|at least|min(?:imum)?)\\s+${CURRENCY_PREFIX}${AMOUNT}` +
      `|${AMOUNT}\\s*${CURRENCY_PREFIX}se\\s+(?:upar|uppar|zyada|jyada|ziada|adhik)\\b`,
    ),
  );
  if (minOnly) {
    return { minPrice: parseAmount(minOnly[1] || minOnly[2]), maxPrice: null };
  }

  return null;
};

// NEW: a SOFT ("around X") price signal - a ranking preference, never a
// hard cutoff. Kept as a separate function/return shape rather than
// folded into detectPriceIntent() so that function's existing contract
// (used by rerankRagCandidates.js and its own tests) is untouched.
export const detectSoftPriceIntent = (query) => {
  if (typeof query !== "string" || !query.trim()) return null;

  const match = normalizeSpokenAmounts(query).toLowerCase().match(SOFT_PRICE_PATTERN);
  if (!match) return null;

  return { targetPrice: parseAmount(match[1] || match[2] || match[3]) };
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
