import { GoogleGenAI } from "@google/genai";
import {
  RAG_EMBEDDING_MODEL,
  RAG_EMBEDDING_TASK_TYPE,
  RAG_EMBEDDING_OUTPUT_DIMENSIONALITY,
} from "./embeddingConfig.js";
import { validateEmbeddingVector } from "./validateEmbeddingVector.js";

// Same per-file GoogleGenAI instantiation pattern already used in
// chatController.js/intentController.js/voiceController.js - this project
// has no shared client module, so a new one here follows the existing
// convention rather than introducing one.
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Heuristic for "worth retrying": rate limits and transient server/network
// errors. NOT validation errors (bad input) or auth errors (retrying won't
// help either).
const isTransientError = (error) => {
  const status = Number(error?.status ?? error?.code ?? error?.response?.status);
  if ([429, 500, 502, 503, 504].includes(status)) return true;

  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("fetch failed") ||
    message.includes("rate limit") ||
    message.includes("unavailable") ||
    message.includes("deadline exceeded")
  );
};

const callEmbedContent = async (text) => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await ai.models.embedContent({
        model: RAG_EMBEDDING_MODEL,
        contents: [text],
        config: {
          taskType: RAG_EMBEDDING_TASK_TYPE,
          outputDimensionality: RAG_EMBEDDING_OUTPUT_DIMENSIONALITY,
        },
      });
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS || !isTransientError(error)) throw error;
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }

  throw lastError;
};

// text -> number[]. Does not touch MongoDB - the caller (syncRagEmbeddings.js)
// owns persistence. Throws (never silently returns something invalid) if
// the API call fails after retries, or if the returned vector doesn't pass
// validateEmbeddingVector.
export const generateEmbedding = async (text) => {
  if (!text || !String(text).trim()) {
    throw new Error("generateEmbedding: text is empty.");
  }

  const response = await callEmbedContent(text);
  const vector = response?.embeddings?.[0]?.values;

  // Dimension is explicitly requested via outputDimensionality above, so an
  // API response that doesn't honor it is treated the same as any other
  // invalid vector - never silently stored.
  const { valid, issues } = validateEmbeddingVector(vector, RAG_EMBEDDING_OUTPUT_DIMENSIONALITY);
  if (!valid) {
    throw new Error(`generateEmbedding: invalid vector returned - ${issues.join(" ")}`);
  }

  return vector;
};
