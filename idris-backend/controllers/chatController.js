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

export const chatBot = async (req, res) => {
  try {
    const { message } = req.body;

    // Sare products fetch karo
    const products = await productModel.find().lean();
    const firstName = await getFirstName(req.userId);

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: `
You are IDRIS ecommerce assistant.

Store Information:
- Store Name: IDRIS
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