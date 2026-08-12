import { GoogleGenAI } from "@google/genai";
import productModel from "../models/productModel.js";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export const chatBot = async (req, res) => {
  try {
    const { message } = req.body;

    // Sare products fetch karo
    const products = await productModel.find().lean();

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