import { Type } from "@google/genai";

// Single source of truth for what the AI assistant is allowed to do.
// Gemini can only ever request one of these declared functions - it has no
// way to invent a tool name or call anything not listed here. The backend
// still re-validates every argument before acting on it (see sanitizers.js).

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
];
