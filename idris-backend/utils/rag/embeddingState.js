// Pure decision logic for whether a RAG document's stored embedding is
// current - no DB/API access, so this is the thing scripts/testRagEmbeddings
// exercises directly without calling Gemini. Kept separate from the sync
// script so the cost-control rule (task 6) has one place it's defined and
// one place it's tested.
import {
  RAG_EMBEDDING_MODEL,
  RAG_EMBEDDING_VERSION,
  RAG_EMBEDDING_OUTPUT_DIMENSIONALITY,
} from "./embeddingConfig.js";

export const isEmbeddingCurrent = (ragDoc) => {
  if (!ragDoc) return false;
  if (!Array.isArray(ragDoc.embedding) || ragDoc.embedding.length === 0) return false;
  if (ragDoc.embeddingStatus !== "ready") return false;
  if (ragDoc.embeddingModel !== RAG_EMBEDDING_MODEL) return false;
  if (ragDoc.embeddingVersion !== RAG_EMBEDDING_VERSION) return false;
  if (ragDoc.embeddedContentHash !== ragDoc.contentHash) return false;
  // Belt-and-braces alongside the version bump: a stored vector whose
  // dimension doesn't match the configured one is never trusted as
  // current, even if the version/model strings happen to match.
  if (ragDoc.embedding.length !== RAG_EMBEDDING_OUTPUT_DIMENSIONALITY) return false;
  return true;
};

// One bucket per document, used for both the dry-run report and to decide
// what an --apply run actually attempts.
//   ready    - current, skip (no API call)
//   missing  - never embedded
//   stale    - has an embedding, but model/version/hash no longer match
//   failed   - a previous attempt was marked failed - retried on next sync
//   invalid  - no text to embed at all (can't attempt)
export const classifyEmbeddingState = (ragDoc) => {
  if (!ragDoc.text || !String(ragDoc.text).trim()) return "invalid";
  if (isEmbeddingCurrent(ragDoc)) return "ready";
  if (ragDoc.embeddingStatus === "failed") return "failed";
  if (!Array.isArray(ragDoc.embedding) || ragDoc.embedding.length === 0) return "missing";
  return "stale";
};

export const needsEmbedding = (ragDoc) => {
  const state = classifyEmbeddingState(ragDoc);
  return state === "missing" || state === "stale" || state === "failed";
};
