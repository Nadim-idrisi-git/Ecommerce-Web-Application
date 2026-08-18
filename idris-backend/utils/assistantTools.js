import { Type } from "@google/genai";

// Single source of truth for what the AI assistant is allowed to do.
// Gemini can only ever request one of these declared functions - it has no
// way to invent a tool name or call anything not listed here. The backend
// still re-validates every argument before acting on it (see sanitizers.js).
//
// Cart/order tools never carry address, payment, or full-user-object data -
// the frontend resolves those (from its own already-authenticated context)
// entirely outside the model, using only an opaque productId/orderId the
// model picked from the redacted UI context.

export const NAVIGATE_DESTINATIONS = [
  "home",
  "about",
  "contact",
  "cart",
  "collection",
  "profile",
  "addresses",
  "orders",
  "login",
  "checkout",
];

export const PRODUCT_CATEGORIES = [
  "jacket",
  "hoodie",
  "sweater",
  "shirt",
  "t-shirt",
  "pant",
  "dress",
  "saree",
  "kids",
  "winterwear",
  "topwear",
  "bottomwear",
];

export const PRODUCT_COLORS = [
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

export const assistantTools = [
  {
    name: "navigate",
    description: "Go to a specific page or section of the store.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        destination: {
          type: Type.STRING,
          enum: NAVIGATE_DESTINATIONS,
          description: "The page to open.",
        },
      },
      required: ["destination"],
    },
  },
  {
    name: "search_products",
    description:
      "Search the product catalog using natural-language filters extracted from the customer's request.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Free-text search terms, e.g. product name or keywords." },
        category: { type: Type.STRING, enum: PRODUCT_CATEGORIES },
        color: { type: Type.STRING, enum: PRODUCT_COLORS },
        maxPrice: { type: Type.NUMBER, description: "Maximum price the customer is willing to pay." },
        sortBy: { type: Type.STRING, enum: SORT_OPTIONS },
      },
    },
  },
  {
    name: "recommend_products",
    description:
      "Recommend products for an occasion or use-case described by the customer (e.g. winter, office, party, travel, sport).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "The occasion/use-case the customer described." },
      },
      required: ["query"],
    },
  },
  {
    name: "sort_products",
    description: "Re-sort the product list currently shown to the customer.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        sortBy: { type: Type.STRING, enum: SORT_OPTIONS },
      },
      required: ["sortBy"],
    },
  },
  {
    name: "open_product",
    description:
      "Open the detail page of one specific product the customer names or references (e.g. 'this one', 'the second one').",
    parameters: {
      type: Type.OBJECT,
      properties: {
        productId: {
          type: Type.STRING,
          description:
            "The id of the product, taken from visibleProducts/selectedProduct in the UI context, when the customer refers to something currently on screen. Leave empty otherwise.",
        },
        query: {
          type: Type.STRING,
          description: "The product name (or close match) when the customer names a product not currently visible.",
        },
      },
    },
  },
  {
    name: "add_to_cart",
    description:
      "Add one specific product the customer explicitly asked for to their cart. Never call this proactively just because a product was shown or recommended.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        productId: {
          type: Type.STRING,
          description: "id from visibleProducts/selectedProduct/cartLines if the product is currently on screen.",
        },
        query: { type: Type.STRING, description: "Product name, if not currently visible." },
        size: { type: Type.STRING, description: "The size the customer stated, if any." },
        quantity: { type: Type.NUMBER, description: "How many to add. Defaults to 1 if not stated." },
        autoSelectSize: {
          type: Type.BOOLEAN,
          description:
            "True only if the customer explicitly said something like 'any size', 'you choose', or 'doesn't matter'. Never true by default.",
        },
      },
    },
  },
  {
    name: "update_cart_quantity",
    description:
      "Change the quantity of an item already in the customer's cart to an exact amount they stated. Only call this when the customer gives an explicit new quantity.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        productId: { type: Type.STRING, description: "id from cartLines in the UI context." },
        query: { type: Type.STRING, description: "Product name, if productId is unknown." },
        size: { type: Type.STRING, description: "Which size line item in the cart to update." },
        quantity: { type: Type.NUMBER, description: "The exact target quantity the customer stated." },
      },
      required: ["quantity"],
    },
  },
  {
    name: "remove_from_cart",
    description: "Remove an item from the customer's cart. Only call this when explicitly instructed.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        productId: { type: Type.STRING, description: "id from cartLines in the UI context." },
        query: { type: Type.STRING, description: "Product name, if productId is unknown." },
        size: { type: Type.STRING, description: "Leave empty to remove all sizes of this product." },
      },
    },
  },
  {
    name: "place_order",
    description:
      "Place a Cash on Delivery order for everything currently in the customer's cart, using their saved default address. Only call this when the customer clearly asks to place/complete their order. Does not support card/UPI payment - the customer must use checkout directly for that. This never places the order immediately; the customer will be asked to confirm first.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "cancel_order",
    description:
      "Cancel one of the customer's own orders. Only call this when the specific order is clear (an id from recentOrders, or unambiguous from context) - if it's not clear which order, do not call this; ask which order instead. This never cancels immediately; the customer will be asked to confirm first.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        orderId: { type: Type.STRING, description: "id from recentOrders in the UI context." },
      },
      required: ["orderId"],
    },
  },
  {
    name: "track_order",
    description: "Show tracking/status details for one of the customer's own orders.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        orderId: { type: Type.STRING, description: "id from recentOrders in the UI context, if known." },
      },
    },
  },
];
