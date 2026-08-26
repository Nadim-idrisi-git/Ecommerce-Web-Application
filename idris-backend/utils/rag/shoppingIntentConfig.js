// Server-controlled vocabulary/constants for module 10's shopping-
// intelligence layer (negation detection + soft-preference matching).
// Mirrors the style of hybridSearchConfig.js - nothing here is ever
// accepted from a caller.

// Negation trigger words/phrases (English + Hinglish), checked against the
// token(s) immediately following them. Deliberately conservative - only
// unambiguous negation markers, to avoid false positives (e.g. bare "no"
// alone is common in unrelated replies like "no thanks").
export const NEGATION_TRIGGERS = [
  "not", "no", "avoid", "except", "excluding", "skip", "without",
  "nahi", "nahin", "mat", "chodkar",
];

// MODULE 11 (part 6) — Devanagari-script negation triggers, kept separate
// from NEGATION_TRIGGERS above because plain \b word-boundary regex does
// not work on Devanagari text at all (Devanagari characters aren't in
// JS regex's \w class, so \b never fires between them - verified before
// adding this) - negativeIntent.js's Devanagari matching uses a
// whitespace-lookaround boundary instead, only for these.
export const DEVANAGARI_NEGATION_TRIGGERS = ["नहीं", "मत"];

// Generic descriptor nouns ("color"/"fit"/"pattern"/"material") that
// commonly sit between the negated attribute and the trailing negation
// word in natural Hindi - "लाल रंग नहीं चाहिए" ("don't want red color"),
// "स्लिम फिट नहीं चाहिए" ("don't want slim fit") - the Devanagari
// equivalent of FILLER_ALTERNATION's "color"/"fit"/"pattern"/"material"
// below. Deliberately does NOT include product-type nouns (e.g. "जैकेट")
// - a specific product the customer names is never a filler to skip over,
// same principle as the Roman-script filler list.
export const DEVANAGARI_FILLER_WORDS = ["रंग", "फिट", "पैटर्न", "मटीरियल", "मटेरियल", "सामग्री", "चाहिए", "चाहिये"];

// Soft-preference adjectives (Part 3/8) - influence ranking only, never a
// hard filter. Each maps to the CLOSEST word(s) that genuinely already
// exist in this catalog's controlled style vocabulary
// (productAttributes.js's STYLES: casual/minimal/basic/trendy/classic) or
// in real admin-entered `features` text (lightweight/breathable/soft/
// stretchable) - a deliberate, documented synonym mapping rather than
// inventing a new "premium"/"attractive" quality claim the catalog doesn't
// actually support. A preference word with no honest mapping here (e.g.
// "premium", "attractive", "flashy") simply produces no boost rather than
// a fabricated one.
export const SOFT_PREFERENCE_SYNONYMS = {
  stylish: ["trendy"],
  trendy: ["trendy"],
  chic: ["trendy"],
  smart: ["trendy"],
  elegant: ["classic"],
  classy: ["classic"],
  minimal: ["minimal"],
  simple: ["minimal", "basic"],
  casual: ["casual"],
  versatile: ["casual"],
  comfortable: ["lightweight", "breathable", "soft", "stretchable", "comfortable"],
};

export const SOFT_PREFERENCE_WORDS = Object.keys(SOFT_PREFERENCE_SYNONYMS);

// Soft ("approximate") price phrasing - distinct from priceIntent.js's
// hard under/below/upto/between patterns. "around"/"approximately"/"~" is
// a preference (closer is better), never a hard cutoff.
export const SOFT_PRICE_PATTERN =
  /\b(?:around|approximately|approx\.?|near|about)\s+(?:rs\.?|₹|rupees)?\s*(\d+(?:,\d{3})*)|~\s*(?:rs\.?|₹)?\s*(\d+(?:,\d{3})*)/;

// Bounded reranker boosts added by this module - kept in the same
// multiplicative-of-rrfScore scheme as RAG_RERANK_WEIGHTS
// (hybridSearchConfig.js), same reasoning: soft signals stay smaller than
// the core attribute-match weights already established there.
export const SHOPPING_INTELLIGENCE_WEIGHTS = {
  softPreferenceMatch: 0.04, // capped once, regardless of how many preference words matched
  softPriceProximity: 0.06, // scaled by closeness to the stated "around" target
};
