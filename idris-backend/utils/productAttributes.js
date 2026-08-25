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
];

export const MATERIALS = ["cotton", "pure cotton", "denim", "linen", "wool", "silk", "polyester"];

export const FITS = ["slim", "regular", "relaxed", "tapered", "oversized", "loose"];

export const PATTERNS = ["solid", "striped", "printed", "checked", "floral", "graphic"];

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
