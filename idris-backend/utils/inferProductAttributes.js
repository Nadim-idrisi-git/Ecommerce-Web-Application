// Backfills productType/material/fit/pattern for products that don't have
// them yet (existing catalog rows, or new asset-seed imports), by matching
// words that are literally present in the product name. Deliberately does
// NOT touch features/occasions/seasons/style - those have no textual
// grounding in the current names/descriptions, and guessing them would mean
// inventing catalog claims the product data doesn't actually support.
const PRODUCT_TYPE_RULES = [
  { value: "T-Shirt", pattern: /t-?shirts?|\btees?\b/i },
  { value: "Shirt", pattern: /\bshirts?\b/i },
  { value: "Top", pattern: /\btops?\b/i },
  { value: "Jeans", pattern: /\bjeans?\b/i },
  { value: "Palazzo", pattern: /\bpalazzo\b/i },
  { value: "Trousers", pattern: /\btrousers?\b|\bpants?\b/i },
  { value: "Jacket", pattern: /\bjackets?\b/i },
  { value: "Hoodie", pattern: /\bhoodies?\b/i },
  { value: "Sweater", pattern: /\bsweaters?\b/i },
  { value: "Dress", pattern: /\bdresses?\b/i },
  { value: "Saree", pattern: /\bsarees?\b/i },
  { value: "Shorts", pattern: /\bshorts?\b/i },
  { value: "Skirt", pattern: /\bskirts?\b/i },
  { value: "Kurta", pattern: /\bkurtas?\b/i },
];

const MATERIAL_RULES = [
  { value: "Pure Cotton", pattern: /\bpure cotton\b/i },
  { value: "Cotton", pattern: /\bcotton\b/i },
  { value: "Denim", pattern: /\bdenim\b/i },
  { value: "Linen", pattern: /\blinen\b/i },
  { value: "Wool", pattern: /\bwool\b/i },
  { value: "Silk", pattern: /\bsilk\b/i },
  { value: "Polyester", pattern: /\bpolyester\b/i },
];

const FIT_RULES = [
  { value: "Slim", pattern: /\bslim\b/i },
  { value: "Relaxed", pattern: /\brelaxed\b/i },
  { value: "Tapered", pattern: /\btapered\b/i },
  { value: "Oversized", pattern: /\boversized\b/i },
  { value: "Loose", pattern: /\bloose\b/i },
  { value: "Regular", pattern: /\bregular\b/i },
];

const PATTERN_RULES = [
  { value: "Printed", pattern: /\bprinted\b/i },
  { value: "Striped", pattern: /\bstriped\b/i },
  { value: "Checked", pattern: /\bchecked\b/i },
  { value: "Floral", pattern: /\bfloral\b/i },
  { value: "Graphic", pattern: /\bgraphic\b/i },
];

const matchFirst = (text, rules) => rules.find(({ pattern }) => pattern.test(text))?.value || "";

export const inferProductAttributes = (name) => {
  const text = name || "";

  return {
    productType: matchFirst(text, PRODUCT_TYPE_RULES),
    material: matchFirst(text, MATERIAL_RULES),
    fit: matchFirst(text, FIT_RULES),
    pattern: matchFirst(text, PATTERN_RULES),
  };
};
