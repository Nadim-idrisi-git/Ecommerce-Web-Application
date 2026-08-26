// Lexical/keyword retrieval over ragdocuments.text via Atlas Search (BM25-
// style relevance, not vectorSearch). Responsible ONLY for this - no
// embedding, no fusion/reranking (see hybridSearchRag.js for that).
import ragDocumentModel from "../../models/ragDocumentModel.js";
import { normalizeRagQuery } from "./embedRagQuery.js";
import {
  RAG_LEXICAL_INDEX_NAME,
  RAG_LEXICAL_LIMIT_DEFAULT,
  RAG_LEXICAL_LIMIT_MAX,
} from "./hybridSearchConfig.js";

export class RagLexicalSearchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RagLexicalSearchError";
    this.code = code;
  }
}

export const clampLexicalLimit = (limit) => {
  const n = Number(limit);
  if (!Number.isFinite(n)) return RAG_LEXICAL_LIMIT_DEFAULT;
  return Math.min(RAG_LEXICAL_LIMIT_MAX, Math.max(1, Math.round(n)));
};

// Exported for direct assertion in tests, same pattern as
// searchRag.js's RAG_RESULT_PROJECTION - `embedding` must never appear here.
export const RAG_LEXICAL_RESULT_PROJECTION = {
  _id: 0,
  sourceId: 1,
  type: 1,
  text: 1,
  metadata: 1,
  lexicalScore: { $meta: "searchScore" },
};

// { query, limit } -> [{ sourceId, type, text, metadata, lexicalScore, lexicalRank }]
export const searchRagLexical = async ({ query, limit } = {}) => {
  let normalized;
  try {
    // Reused from embedRagQuery.js rather than re-implemented - same
    // trim/empty/max-length validation module 4 already established.
    normalized = normalizeRagQuery(query);
  } catch (error) {
    throw new RagLexicalSearchError("INVALID_QUERY", error.message);
  }

  const boundedLimit = clampLexicalLimit(limit);

  let results;
  try {
    results = await ragDocumentModel.aggregate([
      {
        $search: {
          index: RAG_LEXICAL_INDEX_NAME,
          text: {
            query: normalized,
            path: "text",
          },
        },
      },
      { $limit: boundedLimit },
      { $project: RAG_LEXICAL_RESULT_PROJECTION },
    ]);
  } catch (error) {
    if (/index not found|no such index/i.test(error.message || "")) {
      throw new RagLexicalSearchError("INDEX_MISSING", "The lexical search index is not available.");
    }
    throw new RagLexicalSearchError("SEARCH_FAILED", "Lexical search failed.");
  }

  // $search already returns results ordered best-first by relevance; rank
  // is simply that order, 1-based.
  return results.map((doc, index) => ({ ...doc, lexicalRank: index + 1 }));
};
