// Deterministic gate for product-fact questions that should be answered from
// retrieved catalog documents rather than from the general chat prompt.
// This intentionally runs only after tool selection found no action, so
// explicit search/recommend/compare requests keep their existing tool path.

const CATALOG_TERMS = [
  "product", "item", "jacket", "shirt", "top", "dress", "jeans", "trouser",
  "pants", "legging", "jogger", "puffer", "windbreaker", "bomber", "hoodie",
  "skirt", "shorts", "shoe", "bag", "accessor", "clothing", "wear",
  "प्रोडक्ट", "जैकेट", "शर्ट", "ड्रेस", "कपड़े",
];

const FACT_TERMS = [
  "price", "cost", "how much", "size", "sizing", "colour", "color", "material",
  "fabric", "fit", "pattern", "style", "detail", "describe", "description",
  "available", "availability", "stock", "feature", "features", "made of",
  "कीमत", "दाम", "साइज़", "रंग", "मटेरियल", "उपलब्ध",
];

const QUESTION_TERMS = [
  "what", "which", "how", "is", "are", "does", "do", "can", "tell", "about",
  "this", "that", "it", "क्या", "कौन", "कैसे", "बताओ",
];

const NON_CATALOG_TERMS = [
  "return policy", "refund", "shipping", "delivery", "track order", "cancel order",
  "my order", "checkout", "cart", "login", "account", "contact", "about the store",
];

const escapeRegExp = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const includesTerm = (text, terms) =>
  terms.some((term) => {
    // Word boundaries prevent short terms such as "how" matching "show".
    // Devanagari has no reliable JavaScript \b behavior, so retain a plain
    // substring check for non-ASCII terms and multi-word phrases.
    if (/[^\x00-\x7F]/.test(term) || /\s/.test(term)) return text.includes(term);
    return new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(text);
  });

const normalizeProductName = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Returns true only for a likely product-fact question. Product names are
// checked against the caller's already-cached catalog so a generic question
// about an unrelated object is not forced through product RAG.
export const isCatalogQuestion = (message, products = []) => {
  const text = String(message || "").toLowerCase().trim();
  if (!text || includesTerm(text, NON_CATALOG_TERMS)) return false;

  const namedProduct = products.some((product) => {
    const name = normalizeProductName(product?.name);
    return name.length >= 5 && text.includes(name);
  });

  const productMentioned = includesTerm(text, CATALOG_TERMS) || namedProduct;
  if (!productMentioned) return false;

  return includesTerm(text, FACT_TERMS) || includesTerm(text, QUESTION_TERMS);
};
