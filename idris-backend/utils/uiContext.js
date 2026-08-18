// The frontend sends a redacted snapshot of what's currently on screen so
// the assistant can resolve references like "this one" or "the second one".
// It must never carry PII (address/phone/email/payment) - the frontend is
// responsible for never putting that in, and this sanitizer is the backend's
// independent check: only known-safe fields are read out of the payload,
// everything else is dropped, and every value is type/length-clamped before
// it goes anywhere near the prompt.

const KNOWN_PAGES = [
  "home", "collection", "product", "cart", "checkout",
  "orders", "track_order", "addresses", "profile", "login",
  "about", "contact", "other",
];

const clampString = (value, max) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const clampProduct = (product) => {
  if (!product || typeof product !== "object") return null;

  const id = clampString(product.id, 50);
  const name = clampString(product.name, 150);
  if (!id || !name) return null;

  const price = Number(product.price);

  return {
    id,
    name,
    category: clampString(product.category, 50),
    subCategory: clampString(product.subCategory, 50),
    price: Number.isFinite(price) ? price : null,
    bestseller: Boolean(product.bestseller),
  };
};

export const sanitizeUIContext = (uiContext) => {
  if (!uiContext || typeof uiContext !== "object") return null;

  const page = clampString(uiContext.page, 30);
  const visibleProducts = Array.isArray(uiContext.visibleProducts)
    ? uiContext.visibleProducts.slice(0, 12).map(clampProduct).filter(Boolean)
    : [];

  return {
    page: KNOWN_PAGES.includes(page) ? page : "other",
    visibleProducts,
    selectedProduct: clampProduct(uiContext.selectedProduct),
    activeSearch: clampString(uiContext.activeSearch, 200),
    uiOpen: {
      cart: Boolean(uiContext.uiOpen?.cart),
      checkout: Boolean(uiContext.uiOpen?.checkout),
      orders: Boolean(uiContext.uiOpen?.orders),
      productDetail: Boolean(uiContext.uiOpen?.productDetail),
      addresses: Boolean(uiContext.uiOpen?.addresses),
      profile: Boolean(uiContext.uiOpen?.profile),
    },
  };
};
