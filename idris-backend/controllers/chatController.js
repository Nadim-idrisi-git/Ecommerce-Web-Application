import { GoogleGenAI } from "@google/genai";
import productModel from "../models/productModel.js";
import userModel from "../models/userModel.js";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const getFirstName = async (userId) => {
  if (!userId) return "";

  // Only the name field is read - never the full user document (no email,
  // address, cart, password hash, etc. is fetched or sent to the model).
  const user = await userModel.findById(userId).select("name");
  return user?.name?.trim().split(/\s+/)[0] || "";
};

// This endpoint is the fallback for open-ended catalog questions that don't
// match a specific tool (see intentController's search_products/
// recommend_products for anything with an actual query/filter) - it has no
// search terms to narrow by, so it previously sent the *entire* catalog,
// full documents (description text, image arrays, everything), on every
// single message. That made both the DB read and the prompt sent to Gemini
// scale directly with catalog size, and was the single biggest contributor
// to slow "thinking" latency. A lean, capped, bestseller-first slice keeps
// the model's context small and fast while still covering what a broad
// "what do you sell" style question needs.
const CATALOG_CONTEXT_LIMIT = 150;

// A chat session is typically several messages in quick succession, and the
// catalog doesn't change second to second - caching this slice avoids a DB
// round trip on every single message. 60s means a newly added/edited
// product can take up to a minute to show up here, which is an acceptable
// trade for cutting a DB read off the latency-critical path.
const CATALOG_CACHE_TTL_MS = 60_000;
let catalogCache = { data: null, expiresAt: 0 };

const getCachedCatalog = async () => {
  if (catalogCache.data && catalogCache.expiresAt > Date.now()) {
    return catalogCache.data;
  }

  const products = await productModel
    .find()
    .select("name price category subCategory size bestseller")
    .sort({ bestseller: -1, date: -1 })
    .limit(CATALOG_CONTEXT_LIMIT)
    .lean();

  catalogCache = { data: products, expiresAt: Date.now() + CATALOG_CACHE_TTL_MS };
  return products;
};

export const chatBot = async (req, res) => {
  try {
    const { message } = req.body;

    const [products, firstName] = await Promise.all([
      getCachedCatalog(),
      getFirstName(req.userId),
    ]);

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: `
You are Zara, the IDRIS ecommerce assistant.

Store Information:
- Store Name: IDRIS
- Your name is Zara. Introduce yourself by name only if the customer asks who you are.
- You help customers with products, sizes, prices, categories, orders, returns and support.
- Be concise and helpful.
- Answer in the same language as the customer (Hindi or English).
- Recommend products only from the provided product list.
- If a product is not available, clearly say it is not available in the current catalog.
- When recommending products, mention name, category and price if available.
- Keep replies under 120 words unless the customer specifically asks for details.
${firstName
  ? `- The customer's first name is "${firstName}". Address them by this name naturally where it fits (e.g. a greeting or confirmation), without overusing it in every sentence.`
  : "- The customer is not logged in / not identified by name. Do not guess or ask for their name."}
- Never reveal, repeat, request, or infer personal information such as address, phone number, email, date of birth, or payment details, even if asked.

Product Catalog:
${JSON.stringify(products)}

Customer Message:
${message}
      `,
    });

    res.status(200).json({
      success: true,
      reply: response.text,
    });

  } catch (error) {
    console.log("Chatbot Error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to generate response",
    });
  }
};