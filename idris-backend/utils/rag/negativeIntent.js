// Pure, deterministic negative-constraint (exclusion) detection - no
// Gemini call. Fills a real, reproducible gap: without this, a query like
// "not black" tokenizes to include "black", which the existing reranker's
// substring matching (rerankRagCandidates.js) would treat as a POSITIVE
// color signal - the opposite of what the customer asked for.
//
// Only ever matches against the existing controlled vocabulary
// (utils/productAttributes.js) - never invents a new category/value that
// isn't already a real, indexed product attribute.
import { COLORS, MATERIALS, FITS, PATTERNS, PRODUCT_TYPES } from "../productAttributes.js";
import { NEGATION_TRIGGERS, DEVANAGARI_NEGATION_TRIGGERS, DEVANAGARI_FILLER_WORDS } from "./shoppingIntentConfig.js";
import { DEVANAGARI_COLOR_ALIASES, DEVANAGARI_FIT_ALIASES } from "./attributeNormalization.js";

const VOCAB_BY_FIELD = {
  color: COLORS,
  material: MATERIALS,
  fit: FITS,
  pattern: PATTERNS,
  productType: PRODUCT_TYPES,
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TRIGGER_ALTERNATION = NEGATION_TRIGGERS.map(escapeRegex).join("|");

// "chahiye"/"chahiyen" ("want"/"need") commonly sits between a Hinglish
// negation word and the excluded term - "nahi chahiye slim fit" ("don't
// want slim fit") - so it's a filler here too, the same role "a/an/the"
// plays in English phrasing. The descriptor nouns (fit/pattern/material/
// color/print) are needed for the REVERSE direction specifically - "slim
// FIT nahi" ("not slim fit") is the natural Hindi/Hinglish word order
// (negation trailing the clause), and "fit" sits between the term and the
// trigger there.
const FILLER_ALTERNATION = "a|an|the|too|very|chahiye|chahiyen|fit|pattern|material|color|print";

// FORWARD: negation trigger, then an optional filler, then the term -
// "not black", "avoid the floral pattern", "nahi chahiye slim fit".
const FORWARD_PATTERN = new RegExp(
  `\\b(?:${TRIGGER_ALTERNATION})\\b\\s+(?:(?:${FILLER_ALTERNATION})\\s+)?([a-z]+(?:\\s+[a-z]+)?)`,
  "gi",
);

// MODULE 11 finding: a customer plural ("jackets") never exactly matches
// the vocab's singular canonical form ("jacket") via plain .includes() -
// tolerating a stripped trailing s/es stays bounded to the SAME controlled
// value (never invents a new one) and is needed for Part 5's own compound
// examples to work with natural phrasing.
const resolveVocabTerm = (candidate, vocabList) => {
  if (vocabList.includes(candidate)) return candidate;
  if (candidate.endsWith("es") && vocabList.includes(candidate.slice(0, -2))) return candidate.slice(0, -2);
  if (candidate.endsWith("s") && vocabList.includes(candidate.slice(0, -1))) return candidate.slice(0, -1);
  return null;
};

const findVocabMatch = (phrase) => {
  const singleWord = phrase.split(/\s+/)[0];

  // Prefer a two-word vocab match (e.g. "pure cotton") over just the first
  // word, so "not pure cotton" excludes the material "pure cotton" rather
  // than merely registering "pure" (not itself a vocab term anyway).
  for (const [field, vocabList] of Object.entries(VOCAB_BY_FIELD)) {
    const resolved = resolveVocabTerm(phrase, vocabList);
    if (resolved) return [field, resolved];
  }
  for (const [field, vocabList] of Object.entries(VOCAB_BY_FIELD)) {
    const resolved = resolveVocabTerm(singleWord, vocabList);
    if (resolved) return [field, resolved];
  }
  return null;
};

// REVERSE: the term, then an optional filler, then the negation trigger -
// natural Hindi/Hinglish word order routinely puts negation at the end of
// the clause: "slim fit nahi" ("not slim fit"), "mujhe slim fit nahi
// chahiye" ("I don't want slim fit") - the exact phrasing in this
// module's own example #9. Built per-vocab-term (the term is the anchor
// here, not the trigger) since multi-word terms need their own boundary.
const buildReversePattern = (term) =>
  new RegExp(
    `\\b${escapeRegex(term)}(?:es|s)?\\b\\s+(?:(?:${FILLER_ALTERNATION})\\s+)?(?:${TRIGGER_ALTERNATION})\\b`,
    "i",
  );

// MODULE 11 (part 6) — Devanagari reverse-order negation: "TERM [filler]
// TRIGGER", the same shape as buildReversePattern above, but using a
// whitespace-lookaround boundary instead of \b (plain \b never matches
// around Devanagari characters - see shoppingIntentConfig.js's comment)
// and Devanagari trigger/filler vocab. Only scans the bounded
// DEVANAGARI_COLOR_ALIASES/DEVANAGARI_FIT_ALIASES tables (colors + fits),
// mapping a matched Devanagari term to its canonical Roman vocab value.
const DEVANAGARI_VOCAB_BY_FIELD = {
  color: DEVANAGARI_COLOR_ALIASES,
  fit: DEVANAGARI_FIT_ALIASES,
};

const DEVANAGARI_TRIGGER_ALTERNATION = DEVANAGARI_NEGATION_TRIGGERS.map(escapeRegex).join("|");
const DEVANAGARI_FILLER_ALTERNATION = DEVANAGARI_FILLER_WORDS.map(escapeRegex).join("|");

const buildDevanagariReversePattern = (term) =>
  new RegExp(
    `(?<!\\S)${escapeRegex(term)}(?!\\S)\\s+(?:(?:${DEVANAGARI_FILLER_ALTERNATION})\\s+)?(?:${DEVANAGARI_TRIGGER_ALTERNATION})(?!\\S)`,
  );

// Known, tested limitation (see the Module 11 report): a Devanagari
// attribute followed by an explicit product noun before the trailing
// negation (e.g. "काली जैकेट नहीं चाहिए" - "black JACKET not wanted") is
// NOT detected here, the same way "not black JACKET" would be handled
// differently in Roman script - "जैकेट" is a specific product noun, not a
// generic descriptor filler, and is deliberately not treated as skippable
// (skipping arbitrary nouns would risk swallowing the customer's actual
// desired product into the exclusion set, the exact class of bug Module
// 10's stripExclusionsContradictingHardFilter guards against). The
// simpler, more common shape without an intervening noun - "लाल रंग नहीं
// चाहिए", "स्लिम फिट नहीं चाहिए" - IS detected.
const detectDevanagariExclusions = (normalized, add) => {
  Object.entries(DEVANAGARI_VOCAB_BY_FIELD).forEach(([field, aliasMap]) => {
    Object.entries(aliasMap).forEach(([devanagariTerm, canonicalValue]) => {
      if (buildDevanagariReversePattern(devanagariTerm).test(normalized)) {
        add(field, canonicalValue);
      }
    });
  });
};

// query: string -> { color: string[], material: string[], fit: string[], pattern: string[], productType: string[] }
// Every array is empty by default; values are the exact lowercase vocab
// strings from productAttributes.js.
export const detectExclusions = (query) => {
  const result = { color: [], material: [], fit: [], pattern: [], productType: [] };

  if (typeof query !== "string" || !query.trim()) {
    return result;
  }

  const normalized = query.toLowerCase();
  const add = (field, term) => {
    if (!result[field].includes(term)) result[field].push(term);
  };

  let match;
  FORWARD_PATTERN.lastIndex = 0;
  while ((match = FORWARD_PATTERN.exec(normalized)) !== null) {
    const found = findVocabMatch(match[1].trim());
    if (found) add(found[0], found[1]);
  }

  Object.entries(VOCAB_BY_FIELD).forEach(([field, vocabList]) => {
    vocabList.forEach((term) => {
      if (buildReversePattern(term).test(normalized)) add(field, term);
    });
  });

  detectDevanagariExclusions(normalized, add);

  return result;
};

export const hasExclusions = (exclusions) =>
  Boolean(exclusions) && Object.values(exclusions).some((list) => Array.isArray(list) && list.length > 0);
