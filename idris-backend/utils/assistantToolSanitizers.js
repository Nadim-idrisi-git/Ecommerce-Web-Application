import {
  NAVIGATE_DESTINATIONS,
  PRODUCT_CATEGORIES,
  PRODUCT_COLORS,
  SORT_OPTIONS,
} from "./assistantTools.js";

// Never trust the model's function-call arguments as-is, even though the
// tool schema already constrains them - re-check every value on the backend.
// Each sanitizer returns null when the call should be rejected outright.

const asString = (value) => (typeof value === "string" ? value.trim() : "");
const asEnum = (value, allowed) => {
  const normalized = asString(value).toLowerCase();
  return allowed.includes(normalized) ? normalized : "";
};

export const assistantToolSanitizers = {
  navigate: (args = {}) => {
    const destination = asEnum(args.destination, NAVIGATE_DESTINATIONS);
    if (!destination) return null;
    return { destination };
  },

  search_products: (args = {}) => {
    const maxPriceNumber = Number(args.maxPrice);
    return {
      query: asString(args.query).slice(0, 200),
      category: asEnum(args.category, PRODUCT_CATEGORIES),
      color: asEnum(args.color, PRODUCT_COLORS),
      maxPrice: Number.isFinite(maxPriceNumber) && maxPriceNumber >= 0 ? maxPriceNumber : null,
      sortBy: asEnum(args.sortBy, SORT_OPTIONS),
    };
  },

  recommend_products: (args = {}) => {
    const query = asString(args.query).slice(0, 200);
    if (!query) return null;
    return { query };
  },

  sort_products: (args = {}) => {
    const sortBy = asEnum(args.sortBy, SORT_OPTIONS);
    if (!sortBy) return null;
    return { sortBy };
  },

  open_product: (args = {}) => {
    const productId = asString(args.productId).slice(0, 100);
    const query = asString(args.query).slice(0, 200);
    if (!productId && !query) return null;
    return { productId, query };
  },

  add_to_cart: (args = {}) => {
    const productId = asString(args.productId).slice(0, 100);
    const query = asString(args.query).slice(0, 200);
    if (!productId && !query) return null;

    const quantityNumber = Number(args.quantity);

    return {
      productId,
      query,
      size: asString(args.size).slice(0, 20),
      quantity: Number.isFinite(quantityNumber) && quantityNumber > 0
        ? Math.min(Math.round(quantityNumber), 5)
        : 1,
      autoSelectSize: Boolean(args.autoSelectSize),
    };
  },

  update_cart_quantity: (args = {}) => {
    const productId = asString(args.productId).slice(0, 100);
    const query = asString(args.query).slice(0, 200);
    if (!productId && !query) return null;

    const quantityNumber = Number(args.quantity);
    if (!Number.isFinite(quantityNumber) || quantityNumber < 0) return null;

    return {
      productId,
      query,
      size: asString(args.size).slice(0, 20),
      quantity: Math.min(Math.round(quantityNumber), 10),
    };
  },

  remove_from_cart: (args = {}) => {
    const productId = asString(args.productId).slice(0, 100);
    const query = asString(args.query).slice(0, 200);
    if (!productId && !query) return null;

    return {
      productId,
      query,
      size: asString(args.size).slice(0, 20),
    };
  },

  place_order: () => ({}),

  cancel_order: (args = {}) => {
    const orderId = asString(args.orderId).slice(0, 100);
    if (!orderId) return null;
    return { orderId };
  },

  track_order: (args = {}) => ({
    orderId: asString(args.orderId).slice(0, 100),
  }),
};
