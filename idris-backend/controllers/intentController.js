import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const allowedIntents = [
  "OPEN_HOME",
  "OPEN_ABOUT",
  "OPEN_CONTACT",
  "OPEN_CART",
  "OPEN_COLLECTION",
  "OPEN_PROFILE",
  "OPEN_ADDRESSES",
  "OPEN_ORDERS",
  "TRACK_ORDER",
  "SHOW_OFFERS",
  "LOGIN",
  "SEARCH_PRODUCT",
  "RECOMMEND_PRODUCT",
  "SORT_PRODUCTS",
  "UNKNOWN",
];

const normalizeIntent = (intent) => {
  if (!allowedIntents.includes(intent)) {
    return "UNKNOWN";
  }

  return intent;
};

export const detectAIIntent = async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: `
You are the intent detection engine for the IDRIS ecommerce website.

Your job is ONLY to understand the customer's request and return structured JSON.

You MUST NOT perform any action.

Allowed intents:

OPEN_HOME
OPEN_ABOUT
OPEN_CONTACT
OPEN_CART
OPEN_COLLECTION
OPEN_PROFILE
OPEN_ADDRESSES
OPEN_ORDERS
TRACK_ORDER
SHOW_OFFERS
LOGIN
SEARCH_PRODUCT
RECOMMEND_PRODUCT
SORT_PRODUCTS
UNKNOWN

Rules:

1. Return ONLY valid JSON.
2. Never return markdown.
3. Never invent an intent.
4. Never create an intent for deleting, updating, adding, or modifying database data.
5. Product searching should use SEARCH_PRODUCT.
6. Product recommendations should use RECOMMEND_PRODUCT.
7. Price sorting should use SORT_PRODUCTS.
8. "track my order", "where is my order", "order status" should use TRACK_ORDER.
9. "show my orders", "my orders", "order history" should use OPEN_ORDERS.
10. "show my addresses", "saved addresses", "my address" should use OPEN_ADDRESSES.
11. If the request is unrelated or unclear, use UNKNOWN.
12. Extract search parameters when possible.

For SEARCH_PRODUCT or RECOMMEND_PRODUCT:

category can be:
jacket, hoodie, sweater, shirt, t-shirt, pant, dress, saree, kids, winterwear, topwear, bottomwear

color can be:
black, white, blue, red, green, yellow, pink, brown, grey, gray, beige, navy, maroon, olive

maxPrice must be a number or null.

For SORT_PRODUCTS, sortBy can be:
low-high
high-low
newest
category
relevant

Return exactly this structure:

{
  "intent": "SEARCH_PRODUCT",
  "parameters": {
    "query": "",
    "category": "",
    "color": "",
    "maxPrice": null,
    "sortBy": ""
  }
}

Customer message:
${message}
      `,
    });

    let parsed;

    try {
      const rawText = response.text?.trim() || "";

      const cleanedText = rawText
        .replace(/^```json/i, "")
        .replace(/^```/i, "")
        .replace(/```$/i, "")
        .trim();

      parsed = JSON.parse(cleanedText);
    } catch (error) {
      console.error("AI intent JSON parsing failed:", error);

      return res.status(422).json({
        success: false,
        message: "AI returned an invalid intent",
      });
    }

    const intent = normalizeIntent(parsed.intent);

    const parameters = {
      query: typeof parsed.parameters?.query === "string"
        ? parsed.parameters.query.trim()
        : "",

      category: typeof parsed.parameters?.category === "string"
        ? parsed.parameters.category.trim().toLowerCase()
        : "",

      color: typeof parsed.parameters?.color === "string"
        ? parsed.parameters.color.trim().toLowerCase()
        : "",

      maxPrice:
        typeof parsed.parameters?.maxPrice === "number"
          ? parsed.parameters.maxPrice
          : null,

      sortBy: typeof parsed.parameters?.sortBy === "string"
        ? parsed.parameters.sortBy.trim().toLowerCase()
        : "",
    };

    return res.json({
      success: true,
      intent,
      parameters,
    });
  } catch (error) {
    console.error("AI intent detection error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to detect AI intent",
    });
  }
};