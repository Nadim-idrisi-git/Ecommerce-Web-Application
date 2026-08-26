// MODULE 11 — the canonical shopping query plan: the single, deterministic,
// server-controlled representation of what a customer explicitly wants
// (include), explicitly does NOT want (exclude), and their price
// constraint (hard and/or soft), reconciled across the current message and
// (for follow-ups) prior turns of the same conversation. Zero Gemini calls,
// zero DB calls, deterministic for the same input - reuses, never
// duplicates, detectPositiveAttributes()/detectExclusions()/
// detectPriceIntent()/detectSoftPriceIntent() and the existing
// sanitizeHistory() history sanitizer.
//
// WHY this exists (see the Module 11 report for the full audit): today
// Gemini's own tool-argument extraction (assistantToolSanitizers.js) is the
// ONLY source of hard gender/category/productType/color/maxPrice filters -
// there is no deterministic cross-check, so a mis-extracted maxPrice or
// attribute silently becomes a wrong hard Mongo filter. This module makes
// a deterministic parse of the customer's own words authoritative for any
// field it can establish, and only lets Gemini's structured tool argument
// fill a field the deterministic parse left empty (e.g. a vague reference
// resolved via uiContext that the raw text doesn't literally contain).
import { sanitizeHistory } from "../aiChatContext.js";
import { detectPositiveAttributes } from "./positiveAttributeIntent.js";
import { detectExclusions, hasExclusions } from "./negativeIntent.js";
import { detectPriceIntent, detectSoftPriceIntent } from "./priceIntent.js";
import { SOFT_PREFERENCE_WORDS } from "./shoppingIntentConfig.js";

const INCLUDE_FIELDS = [
  "gender", "category", "productType", "color", "material",
  "fit", "pattern", "style", "occasion", "season",
];

// Fields Gemini's OWN tool schema (utils/assistantTools.js's search_products)
// can ever carry - the only fields toolArguments is ever allowed to fill a
// gap for. material/fit/pattern/style/occasion/season have no tool-schema
// equivalent at all, so they can ONLY ever come from the deterministic text
// parse (current or prior turns) - toolArguments simply has nothing to
// offer them, by construction, not by an extra check here.
const TOOL_ARGUMENT_FIELDS = ["gender", "category", "productType", "color"];

// A single turn's own text can produce a contradictory result (e.g. "not
// black jacket" positively detects color:"black" via detectPositiveAttributes
// AND excludes color:"black" via detectExclusions, since neither function is
// negation-aware of the other). Exclude wins for the SAME turn's SAME
// field+value - the customer just said they don't want it.
const resolveSameTurnContradiction = (positive, negative) => {
  const resolved = {};
  INCLUDE_FIELDS.forEach((field) => {
    const excludedValues = negative[field] || [];
    resolved[field] = (positive[field] || []).filter((value) => !excludedValues.includes(value));
  });
  return resolved;
};

const emptyExclusions = () => ({ color: [], material: [], fit: [], pattern: [], productType: [] });

// Extracts prior USER turns only (oldest -> newest) as plain text, reusing
// the existing sanitizeHistory() sanitizer (length/count-capped, role-
// validated) rather than re-validating history a second way. Assistant
// turns are excluded - only the customer's own words are ever authoritative
// for a hard constraint.
const priorUserTurnTexts = (history) =>
  sanitizeHistory(history)
    .filter((entry) => entry.role === "user")
    .map((entry) => entry.parts[0]?.text || "")
    .filter(Boolean);

// query: string -> { hard: {minPrice,maxPrice}|null, soft: {targetPrice}|null }
// Thin wrapper solely so callers/tests can inspect both signals for one
// turn's text together - detectPriceIntent()/detectSoftPriceIntent() are
// still the only place either is actually computed.
const detectTurnPrice = (text) => ({
  hard: detectPriceIntent(text),
  soft: detectSoftPriceIntent(text),
});

// { originalQuery, toolArguments?, history? } -> canonical plan (see the
// Module 11 report for the exact schema/example). Deterministic: the same
// input always produces the same output. Makes zero Gemini/DB calls, never
// constructs a raw Mongo operator (every field here is plain string/number
// data, assembled into an actual filter object only by the caller).
export const buildShoppingQueryPlan = ({ originalQuery, toolArguments = {}, history = [] } = {}) => {
  const include = {};
  const exclude = emptyExclusions();
  let hardPrice = null;
  let softPrice = null;

  const turns = [...priorUserTurnTexts(history), String(originalQuery || "")];
  let currentTurnHasSignal = false;

  turns.forEach((text, index) => {
    const positive = resolveSameTurnContradiction(detectPositiveAttributes(text), detectExclusions(text));
    const negative = detectExclusions(text);
    const { hard, soft } = detectTurnPrice(text);

    if (index === turns.length - 1) {
      currentTurnHasSignal =
        INCLUDE_FIELDS.some((field) => positive[field]?.length > 0) || hasExclusions(negative) || Boolean(hard) || Boolean(soft);
    }

    INCLUDE_FIELDS.forEach((field) => {
      if (positive[field] && positive[field].length > 0) {
        // A later turn's explicit include for this field overrides an
        // earlier turn's value (Part 10), AND clears any earlier exclusion
        // for the same field - the customer changed their mind.
        include[field] = positive[field][0];
        if (Object.prototype.hasOwnProperty.call(exclude, field)) {
          exclude[field] = [];
        }
      }
    });

    if (hasExclusions(negative)) {
      Object.entries(negative).forEach(([field, values]) => {
        values.forEach((value) => {
          if (!exclude[field].includes(value)) exclude[field].push(value);
        });
      });
    }

    if (hard) {
      hardPrice = hard;
    }
    if (soft) {
      softPrice = soft;
    }
  });

  // toolArguments only ever fills a gap the deterministic multi-turn text
  // parse left empty - it never overrides a field the text parse already
  // established (Part 3's explicit requirement).
  TOOL_ARGUMENT_FIELDS.forEach((field) => {
    const fallback = toolArguments?.[field];
    if (!include[field] && typeof fallback === "string" && fallback.trim()) {
      include[field] = fallback.trim();
    }
  });

  // Gemini's own maxPrice is used ONLY when deterministic parsing (across
  // every turn) found no hard price constraint at all - the weakest
  // possible precedence, per Part 4.
  //
  // CRITICAL FIX (found live): `toolArguments.maxPrice` is `null` whenever
  // Gemini/the sanitizer didn't extract a price at all (the normal,
  // majority case) - `Number(null)` evaluates to `0`, which
  // `Number.isFinite(0) && 0 >= 0` then wrongly accepted as a real,
  // customer-stated "budget of ₹0". That fabricated ₹0 cap then made
  // nearly every retrieval fail and triggered the relaxation narration to
  // falsely tell the customer their "budget of ₹0 could not be met" -
  // reproduced live for "show me a black jacket" (no price ever mentioned)
  // before this guard was added. Must check for null/undefined explicitly
  // BEFORE calling Number() on it.
  const rawFallbackMaxPrice = toolArguments?.maxPrice;
  if (!hardPrice && rawFallbackMaxPrice !== null && rawFallbackMaxPrice !== undefined) {
    const fallbackMaxPrice = Number(rawFallbackMaxPrice);
    if (Number.isFinite(fallbackMaxPrice) && fallbackMaxPrice >= 0) {
      hardPrice = { minPrice: null, maxPrice: fallbackMaxPrice };
    }
  }

  // An include for a field must never coexist with an exclude of the exact
  // same value for that field - the final structural "yes" always wins
  // over a same-value "no" (same principle as Module 10's
  // stripExclusionsContradictingHardFilter, applied here too so the plan
  // itself is never self-contradictory regardless of which layer
  // ultimately enforces it).
  Object.keys(exclude).forEach((field) => {
    if (include[field]) {
      exclude[field] = exclude[field].filter((value) => value !== include[field]);
    }
  });

  let mode = "none";
  if (hardPrice?.minPrice != null && hardPrice?.maxPrice != null) mode = "hard_range";
  else if (hardPrice?.maxPrice != null) mode = "hard_max";
  else if (hardPrice?.minPrice != null) mode = "hard_min";
  else if (softPrice) mode = "soft_around";

  // LIVE-TESTING FINDING (module 11): a pure conversational follow-up with
  // no product-relevant words of its own ("show me something similar but
  // cheaper") - when Gemini's own tool-extracted query is also empty -
  // falls back to that vague verbatim text, which reproducibly recalls
  // ZERO vector/lexical candidates (searchHybridRag's own diagnostics
  // confirmed vectorCount:0/lexicalCount:0, before any filter/exclusion
  // logic even runs). Purely a retrieval-recall gap, not a constraint-
  // reconciliation one - the resolved `include` (often inherited from a
  // prior turn) is a strictly better retrieval string in exactly this
  // narrow case, so it's used ONLY when the current turn itself added no
  // signal of its own AND Gemini's own tool query is empty - every other
  // case keeps today's exact fallback behavior unchanged.
  const toolQuery = toolArguments?.query && toolArguments.query.trim();
  let retrievalQuery = toolQuery || String(originalQuery || "");
  if (!toolQuery && !currentTurnHasSignal) {
    const synthesized = [include.color, include.material, include.pattern, include.fit, include.productType]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (synthesized) retrievalQuery = synthesized;
  }

  const currentTurnText = String(originalQuery || "").toLowerCase();
  const matchedSoftPreferenceTerms = SOFT_PREFERENCE_WORDS.filter((word) =>
    new RegExp(`\\b${word}\\b`).test(currentTurnText),
  );

  return {
    include,
    exclude,
    price: {
      mode,
      minPrice: hardPrice?.minPrice ?? null,
      maxPrice: hardPrice?.maxPrice ?? null,
      targetPrice: softPrice?.targetPrice ?? null,
    },
    softPreferences: { matchedTerms: matchedSoftPreferenceTerms },
    retrievalQuery,
    originalQuery: String(originalQuery || ""),
  };
};
