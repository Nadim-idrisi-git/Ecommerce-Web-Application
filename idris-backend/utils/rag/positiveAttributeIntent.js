// MODULE 11 — pure, deterministic POSITIVE attribute detection (no Gemini
// call). Fills a real gap: search_products's tool schema (utils/
// assistantTools.js) only ever carries gender/category/productType/color/
// maxPrice/sortBy - there is no structured way for "slim fit" or "leather"
// to reach RAG as a hard constraint today, even though the customer stated
// it explicitly. This mirrors negativeIntent.js's controlled-vocabulary
// matching approach (same VOCAB_BY_FIELD style, same productAttributes.js
// source of truth) but detects plain (non-negated) mentions instead of
// negated ones - the two are deliberately kept as separate, single-purpose
// modules rather than one merged parser, and shoppingQueryPlan.js is the
// one place that reconciles when the same value shows up in both.
import {
  GENDERS,
  CATEGORIES,
  PRODUCT_TYPES,
  COLORS,
  MATERIALS,
  FITS,
  PATTERNS,
  STYLES,
  OCCASIONS,
  SEASONS,
} from "../productAttributes.js";
import {
  COLOR_ALIASES,
  PRODUCT_TYPE_ALIASES,
  DEVANAGARI_COLOR_ALIASES,
  DEVANAGARI_FIT_ALIASES,
} from "./attributeNormalization.js";

const VOCAB_BY_FIELD = {
  gender: GENDERS,
  category: CATEGORIES,
  productType: PRODUCT_TYPES,
  color: COLORS,
  material: MATERIALS,
  fit: FITS,
  pattern: PATTERNS,
  style: STYLES,
  occasion: OCCASIONS,
  season: SEASONS,
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Rewrites known spelling/phrasing variants (attributeNormalization.js) to
// their canonical vocab form BEFORE vocab matching, so "tee"/"gray"/
// Devanagari "काली" are recognized the same as "t-shirt"/"grey"/"black"
// without needing a second copy of every vocab list. Uses a whitespace
// lookaround instead of \b: plain \b never matches around Devanagari
// characters (they aren't in JS regex's \w class - verified empirically
// before relying on this), while the whitespace-lookaround form is
// correct for both Devanagari and Latin text (also verified) - so one
// boundary mechanism is used for every alias here rather than branching
// per script.
const applyAliases = (text, aliasMap) =>
  Object.entries(aliasMap).reduce(
    (result, [alias, canonical]) =>
      result.replace(new RegExp(`(?<!\\S)${escapeRegex(alias)}(?!\\S)`, "gi"), canonical),
    text,
  );

// When both "cotton" and "pure cotton" would match the same field, keep
// only the longer, more specific phrase - same "prefer the fuller phrase"
// principle negativeIntent.js's findVocabMatch already applies.
const dedupeSubphrases = (terms) => terms.filter((term) => !terms.some((other) => other !== term && other.includes(term)));

// query: string -> { gender: string[], category: string[], productType: string[],
//   color: string[], material: string[], fit: string[], pattern: string[],
//   style: string[], occasion: string[], season: string[] }
// Every array is empty by default; values are the exact lowercase vocab
// strings from productAttributes.js. Does NOT consider negation - a
// "not black jacket" query still reports color: ["black"] here; reconciling
// that against negativeIntent.js's exclusion for the same field/value is
// shoppingQueryPlan.js's job, not this module's.
export const detectPositiveAttributes = (query) => {
  const result = {
    gender: [], category: [], productType: [], color: [], material: [],
    fit: [], pattern: [], style: [], occasion: [], season: [],
  };

  if (typeof query !== "string" || !query.trim()) return result;

  let normalized = query.toLowerCase();
  normalized = applyAliases(normalized, COLOR_ALIASES);
  normalized = applyAliases(normalized, PRODUCT_TYPE_ALIASES);
  normalized = applyAliases(normalized, DEVANAGARI_COLOR_ALIASES);
  normalized = applyAliases(normalized, DEVANAGARI_FIT_ALIASES);

  Object.entries(VOCAB_BY_FIELD).forEach(([field, vocabList]) => {
    vocabList.forEach((term) => {
      // MODULE 11 finding: a plain \bterm\b never matches an ordinary
      // English plural ("jackets" for vocab term "jacket") since there's
      // no word boundary between "jacket" and the following "s" - verified
      // empirically (Part 10's own worked example says "black jackets").
      // Tolerating an optional trailing s/es on the vocab term (not the
      // customer's arbitrary suffix) stays bounded to the SAME controlled
      // value, it doesn't invent or fuzzy-match anything new.
      if (new RegExp(`\\b${escapeRegex(term)}(?:es|s)?\\b`, "i").test(normalized)) {
        result[field].push(term);
      }
    });
    result[field] = dedupeSubphrases(result[field]);
  });

  return result;
};

export const hasPositiveAttributes = (attributes) =>
  Boolean(attributes) && Object.values(attributes).some((list) => Array.isArray(list) && list.length > 0);
