// Single source of truth for every controlled product-attribute vocabulary
// on the storefront. Mirrors (does not import - no shared package exists
// across idris-backend/idris-admin/idris-frontend) idris-backend's
// utils/productAttributes.js. Keep the two in sync when a value list
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
