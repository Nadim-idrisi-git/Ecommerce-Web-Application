// Converts a customer search/query string into an embedding. This file is
// responsible ONLY for that - no retrieval, no MongoDB access (see
// searchRag.js for the actual vector search).
import { GoogleGenAI } from "@google/genai";
import {
  RAG_EMBEDDING_MODEL,
  RAG_EMBEDDING_QUERY_TASK_TYPE,
  RAG_EMBEDDING_OUTPUT_DIMENSIONALITY,
} from "./embeddingConfig.js";
import { RAG_QUERY_MAX_LENGTH } from "./vectorSearchConfig.js";
import { validateEmbeddingVector } from "./validateEmbeddingVector.js";

// Same per-file GoogleGenAI instantiation pattern already used across this
// backend (chatController.js, intentController.js, voiceController.js,
// embedRagDocument.js) - no shared client module exists here, so a new
// instance here follows the existing convention.
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Deterministic, non-destructive normalization only - never rewrites or
// translates the customer's words. Collapses whitespace and trims; nothing
// about casing or language is touched, since the embedding model itself is
// what's responsible for understanding multilingual/Hinglish meaning.
export const normalizeRagQuery = (query) => {
  if (typeof query !== "string") {
    throw new Error("Query must be a string.");
  }

  const normalized = query.trim().replace(/\s+/g, " ");

  if (!normalized) {
    throw new Error("Query must not be empty.");
  }

  if (normalized.length > RAG_QUERY_MAX_LENGTH) {
    throw new Error(`Query is too long (${normalized.length} characters, max ${RAG_QUERY_MAX_LENGTH}).`);
  }

  return normalized;
};

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
          taskType: RAG_EMBEDDING_QUERY_TASK_TYPE,
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

// string -> number[]. Trims, rejects empty/oversized queries, embeds with
// RETRIEVAL_QUERY (never RETRIEVAL_DOCUMENT - queries and documents are
// embedded asymmetrically), validates the vector, and returns only the
// vector - no raw Gemini response data, no API key material.
export const embedRagQuery = async (query) => {
  const normalized = normalizeRagQuery(query);

  const response = await callEmbedContent(normalized);
  const vector = response?.embeddings?.[0]?.values;

  const { valid, issues } = validateEmbeddingVector(vector, RAG_EMBEDDING_OUTPUT_DIMENSIONALITY);
  if (!valid) {
    throw new Error(`embedRagQuery: invalid vector returned - ${issues.join(" ")}`);
  }

  return vector;
};
