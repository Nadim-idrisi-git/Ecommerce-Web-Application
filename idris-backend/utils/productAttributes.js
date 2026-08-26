// Single source of truth for every controlled product-attribute vocabulary
// on the backend. Mirrored (not imported - no shared package exists across
// idris-backend/idris-admin/idris-frontend) by idris-admin's
// src/constants/productOptions.js and idris-frontend's
// src/utils/productAttributes.js. Keep the three in sync when a value list
// changes here.

export const GENDERS = ["men", "women", "kids"];

export const CATEGORIES = ["topwear", "bottomwear", "winterwear"];

export const PRODUCT_TYPES = [
  "t-shirt",
  "shirt",
  "top",
  "trousers",
  "jeans",
  "palazzo",
  "jacket",
  "hoodie",
  "sweater",
  "dress",
  "saree",
  "shorts",
  "skirt",
  "kurta",
  // MODULE 13: verified live against the real catalog (Product.distinct()) -
  // these are real, currently-stored productType values that were missing
  // from this vocabulary entirely, so a customer asking for one of them
  // could never get a hard/deterministic productType match even though
  // matching products exist.
  "joggers",
  "leggings",
  "tank top",
  "track pants",
];

export const MATERIALS = [
  "cotton",
  "pure cotton",
  "denim",
  "linen",
  "wool",
  "silk",
  "polyester",
  // MODULE 13: verified live against the real catalog - see PRODUCT_TYPES comment above.
  "cotton blend",
  "fleece",
  "rayon",
];

export const FITS = [
  "slim",
  "regular",
  "relaxed",
  "tapered",
  "oversized",
  "loose",
  // MODULE 13: "Relaxed Fit" is verified to be a REAL, INDEPENDENTLY stored
  // value distinct from "Relaxed" in this catalog - kept separate rather
  // than aliased/collapsed together (same principle already established for
  // "navy" vs "navy blue" - see attributeNormalization.js).
  "relaxed fit",
];

export const PATTERNS = [
  "solid",
  "striped",
  "printed",
  "checked",
  "floral",
  "graphic",
  // MODULE 13: verified live against the real catalog. "Graphic Print" is a
  // real, independently stored value distinct from "Graphic" - kept
  // separate, not aliased, for the same reason as FITS above.
  "animal print",
  "colorblocked",
  "colourblocked",
  "graphic print",
  "ribbed",
  "typography",
  "washed",
];

export const OCCASIONS = ["casual", "daily wear", "college", "work", "formal", "party", "travel"];

export const SEASONS = ["summer", "winter", "spring", "monsoon", "all season"];

export const STYLES = ["casual", "minimal", "basic", "trendy", "classic"];

export const COLORS = [
  "black",
  "white",
  "blue",
  "red",
  "green",
  "yellow",
  "pink",
  "brown",
  "grey",
  "gray",
  "beige",
  "navy",
  "maroon",
  "olive",
];

export const SORT_OPTIONS = ["low-high", "high-low", "newest", "category", "relevant"];
