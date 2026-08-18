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

// Cart contents: product id/name/size/quantity/price only - never anything
// about the delivery address or payment method (that never enters the
// assistant's context at all, at any point in the flow).
const clampCartLine = (line) => {
  if (!line || typeof line !== "object") return null;

  const productId = clampString(line.productId, 50);
  const name = clampString(line.name, 150);
  const size = clampString(line.size, 20);
  if (!productId || !name) return null;

  const quantity = Number(line.quantity);
  const price = Number(line.price);

  return {
    productId,
    name,
    size,
    quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 0,
    price: Number.isFinite(price) ? price : null,
  };
};

const KNOWN_ORDER_STATUSES = [
  "Order Placed", "Packing", "Shipped", "Out for Delivery", "Delivered", "Cancelled",
];

// Order summary: id/status/item names/date only - never the shipping
// address, phone, email, or any payment detail.
const clampOrder = (order) => {
  if (!order || typeof order !== "object") return null;

  const id = clampString(order.id, 50);
  if (!id) return null;

  const status = clampString(order.status, 30);
  const itemNames = Array.isArray(order.itemNames)
    ? order.itemNames.slice(0, 3).map((name) => clampString(name, 100)).filter(Boolean)
    : [];

  return {
    id,
    status: KNOWN_ORDER_STATUSES.includes(status) ? status : "Order Placed",
    itemNames,
    date: Number.isFinite(Number(order.date)) ? Number(order.date) : null,
  };
};

export const sanitizeUIContext = (uiContext) => {
  if (!uiContext || typeof uiContext !== "object") return null;

  const page = clampString(uiContext.page, 30);
  const visibleProducts = Array.isArray(uiContext.visibleProducts)
    ? uiContext.visibleProducts.slice(0, 12).map(clampProduct).filter(Boolean)
    : [];
  const cartLines = Array.isArray(uiContext.cartLines)
    ? uiContext.cartLines.slice(0, 20).map(clampCartLine).filter(Boolean)
    : [];
  const recentOrders = Array.isArray(uiContext.recentOrders)
    ? uiContext.recentOrders.slice(0, 5).map(clampOrder).filter(Boolean)
    : [];

  return {
    page: KNOWN_PAGES.includes(page) ? page : "other",
    visibleProducts,
    selectedProduct: clampProduct(uiContext.selectedProduct),
    activeSearch: clampString(uiContext.activeSearch, 200),
    cartLines,
    recentOrders,
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
