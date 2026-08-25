// Single source of truth for every controlled product-attribute vocabulary
// in the admin app. Mirrors (does not import - no shared package exists
// across idris-backend/idris-admin/idris-frontend) idris-backend's
// utils/productAttributes.js. Keep the two in sync when a value list
// changes here.

export const GENDERS = ["Men", "Women", "Kids"];

export const CATEGORIES = ["Topwear", "Bottomwear", "Winterwear"];

export const PRODUCT_TYPES = [
  "T-Shirt",
  "Shirt",
  "Top",
  "Trousers",
  "Jeans",
  "Palazzo",
  "Jacket",
  "Hoodie",
  "Sweater",
  "Dress",
  "Saree",
  "Shorts",
  "Skirt",
  "Kurta",
];

export const MATERIALS = ["Cotton", "Pure Cotton", "Denim", "Linen", "Wool", "Silk", "Polyester"];

export const FITS = ["Slim", "Regular", "Relaxed", "Tapered", "Oversized", "Loose"];

export const PATTERNS = ["Solid", "Striped", "Printed", "Checked", "Floral", "Graphic"];

export const OCCASIONS = ["Casual", "Daily Wear", "College", "Work", "Formal", "Party", "Travel"];

export const SEASONS = ["Summer", "Winter", "Spring", "Monsoon", "All Season"];

export const STYLES = ["Casual", "Minimal", "Basic", "Trendy", "Classic"];

export const SIZES = ["S", "M", "L", "XL", "XXL"];

// Fixed palette (matches the storefront's color filter and the AI
// assistant's color-search enum) so every product's color stays a
// controlled, filterable value instead of free text that could drift out
// of sync with those.
export const COLORS = [
  "Black",
  "White",
  "Blue",
  "Red",
  "Green",
  "Yellow",
  "Pink",
  "Brown",
  "Grey",
  "Beige",
  "Navy",
  "Maroon",
  "Olive",
  "Orange",
  "Purple",
  "Lavender",
  "Violet",
  "Magenta",
  "Cyan",
  "Turquoise",
  "Teal",
  "Mint",
  "Lime",
  "Sky Blue",
  "Royal Blue",
  "Light Blue",
  "Dark Blue",
  "Light Green",
  "Dark Green",
  "Bottle Green",
  "Forest Green",
  "Mustard",
  "Cream",
  "Ivory",
  "Off White",
  "Khaki",
  "Tan",
  "Camel",
  "Rust",
  "Coral",
  "Peach",
  "Wine",
  "Burgundy",
  "Plum",
  "Mauve",
  "Rose",
  "Gold",
  "Silver",
  "Bronze",
  "Charcoal",
  "Ash",
  "Nude",
];
