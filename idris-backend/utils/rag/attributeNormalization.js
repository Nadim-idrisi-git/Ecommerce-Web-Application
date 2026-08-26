// MODULE 11 — small, bounded, evidence-grounded spelling/phrasing
// normalization for the canonical shopping query plan. Every alias here was
// checked against the REAL stored Product.color/Product.productType values
// (not guessed) before being added - see the Module 11 report. Deliberately
// NOT a general fuzzy-matching or color-family mechanism: aliases only
// canonicalize a spelling/phrasing variant to the ONE controlled vocab term
// that's actually ever stored, they never widen matching to a family of
// different, independently-valid stored values (e.g. "navy blue" is its own
// real stored color, distinct from "navy" - aliasing one to the other would
// silently exclude real products, so that pairing is deliberately NOT here
// even though an earlier draft of this task suggested it).
//
// Only "gray" is ever typed by a customer but never stored (this catalog
// only ever stores "grey") - a pure spelling variant, safe to canonicalize.
export const COLOR_ALIASES = {
  gray: "grey",
};

// Only "T-Shirt" is ever stored; "t shirt"/"tee"/"tees" are common customer
// phrasings for the exact same product type - safe to canonicalize since
// there is no separate, distinct stored value any of these could collide
// with.
export const PRODUCT_TYPE_ALIASES = {
  "t shirt": "t-shirt",
  "tshirt": "t-shirt",
  "tee": "t-shirt",
  "tees": "t-shirt",
};

// value: string (already lowercase-trimmed by the caller) -> the canonical
// controlled-vocab spelling if an alias exists, otherwise the value
// unchanged - never invents a value that isn't already either the input or
// a known alias target.
export const normalizeColor = (value) => COLOR_ALIASES[value] || value;
export const normalizeProductType = (value) => PRODUCT_TYPE_ALIASES[value] || value;

// MODULE 11 (part 6) — bounded Devanagari transliterations of the SAME
// controlled COLORS/FITS vocab (productAttributes.js), not a translation
// dictionary: each key is how a Hindi speaker commonly writes that exact
// controlled value in Devanagari script (including gender-agreement forms
// for adjectives, e.g. काला/काली/काले all mean "black"). Only COLORS and
// FITS are covered - the two vocab classes this module's own worked
// examples actually exercise (काली जैकेट / स्लिम फिट). MATERIALS is
// deliberately not extended into Devanagari here: "leather" (used in every
// worked example that mentions material) does not exist anywhere in this
// catalog's real data or its MATERIALS vocab (verified against the live
// DB - see the Module 11 report), so there is no safe, real value to map a
// Devanagari material word onto in the first place.
export const DEVANAGARI_COLOR_ALIASES = {
  "काला": "black", "काली": "black", "काले": "black",
  "सफ़ेद": "white", "सफेद": "white",
  "नीला": "blue", "नीली": "blue", "नीले": "blue",
  "लाल": "red",
  "हरा": "green", "हरी": "green", "हरे": "green",
  "पीला": "yellow", "पीली": "yellow", "पीले": "yellow",
  "गुलाबी": "pink",
  "भूरा": "brown", "भूरी": "brown", "भूरे": "brown",
  "ग्रे": "grey", "स्लेटी": "grey",
  "बेज": "beige",
  "नेवी": "navy",
  "मरून": "maroon",
  "ऑलिव": "olive",
};

export const DEVANAGARI_FIT_ALIASES = {
  "स्लिम": "slim",
  "रेगुलर": "regular",
  "रिलैक्स्ड": "relaxed", "रिलैक्स": "relaxed",
  "टेपर्ड": "tapered",
  "ओवरसाइज़्ड": "oversized", "ओवरसाइज": "oversized",
  "लूज़": "loose", "लूज": "loose",
};
