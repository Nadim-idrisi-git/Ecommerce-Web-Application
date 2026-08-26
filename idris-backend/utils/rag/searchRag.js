// The single retrieval entry point for semantic RAG search. Responsible
// ONLY for: validating input, getting a query vector (via embedRagQuery.js),
// running $vectorSearch against ragDocuments, and shaping the result. No
// Gemini generation, no agent routing, no prompt construction happens here
// (see module 4's task list) - that's deliberately left for a later module.
import ragDocumentModel from "../../models/ragDocumentModel.js";
import { embedRagQuery } from "./embedRagQuery.js";
import {
  RAG_VECTOR_INDEX_NAME,
  RAG_SEARCH_LIMIT_DEFAULT,
  RAG_SEARCH_LIMIT_MIN,
  RAG_SEARCH_LIMIT_MAX,
  RAG_SEARCH_NUM_CANDIDATES_MULTIPLIER,
  RAG_SEARCH_NUM_CANDIDATES_MAX,
  RAG_FILTERABLE_STRING_FIELDS,
} from "./vectorSearchConfig.js";

// Structured, application-level error - never leaks a raw Mongo/Gemini
// error message/stack to a caller that might surface it to a customer.
export class RagSearchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RagSearchError";
    this.code = code;
  }
}

// 1-20, default 8. A caller asking for 1000 documents (accidentally or
// otherwise) is clamped, not honored - this is the retrieval layer's own
// protection against a token/cost explosion downstream.
export const clampSearchLimit = (limit) => {
  const n = Number(limit);
  if (!Number.isFinite(n)) return RAG_SEARCH_LIMIT_DEFAULT;
  return Math.min(RAG_SEARCH_LIMIT_MAX, Math.max(RAG_SEARCH_LIMIT_MIN, Math.round(n)));
};

// Bounded rather than a fixed large constant, so behavior stays reasonable
// as the catalog grows, but is capped so it can never balloon unbounded.
export const computeNumCandidates = (limit) =>
  Math.min(RAG_SEARCH_NUM_CANDIDATES_MAX, Math.max(limit, limit * RAG_SEARCH_NUM_CANDIDATES_MULTIPLIER));

const titleCase = (value) =>
  value.trim().toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());

// Whitelist only - every field not in RAG_FILTERABLE_STRING_FIELDS (plus
// bestseller/minPrice/maxPrice) is silently dropped, never passed through.
// No raw operators, no arbitrary keys, ever reach the Mongo filter this
// builds - the caller supplies plain values, this function is the only
// thing that turns them into Mongo query syntax.
export const sanitizeRagFilters = (filters) => {
  const mongoFilter = {};

  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    return mongoFilter;
  }

  RAG_FILTERABLE_STRING_FIELDS.forEach((field) => {
    const raw = filters[field];
    if (typeof raw !== "string" || !raw.trim()) return;

    // metadata.color is stored lowercase; every other filterable string
    // field is stored Title Case (see utils/rag/embeddingConfig.js's
    // sibling files / the Product schema) - normalization must match
    // whatever's actually stored, not an arbitrary convention.
    mongoFilter[`metadata.${field}`] = field === "color" ? raw.trim().toLowerCase() : titleCase(raw);
  });

  if (typeof filters.bestseller === "boolean") {
    mongoFilter["metadata.bestseller"] = filters.bestseller;
  }

  const priceRange = {};
  if (filters.minPrice !== undefined && filters.minPrice !== null && Number.isFinite(Number(filters.minPrice))) {
    priceRange.$gte = Number(filters.minPrice);
  }
  if (filters.maxPrice !== undefined && filters.maxPrice !== null && Number.isFinite(Number(filters.maxPrice))) {
    priceRange.$lte = Number(filters.maxPrice);
  }
  if (Object.keys(priceRange).length > 0) {
    mongoFilter["metadata.price"] = priceRange;
  }

  return mongoFilter;
};

// Exported (not inlined in the pipeline below) so it can be asserted
// against directly in tests without running an actual aggregation -
// `embedding` must never appear here.
export const RAG_RESULT_PROJECTION = {
  _id: 0,
  sourceId: 1,
  type: 1,
  text: 1,
  metadata: 1,
  score: { $meta: "vectorSearchScore" },
};

// query: string (required)
// options.limit: 1-20, default 8
// options.filters: plain object, only whitelisted keys honored (see above)
// options.minScore: number|null, default null (no threshold - see module 4
//   task 10, thresholds are calibrated in a later module, not guessed here)
// options.useExactSearch: boolean, default false - ANN by production
//   default; ENN is opt-in only, for a benchmark/test script comparing
//   correctness on this small catalog, never the production default.
export const searchRag = async (query, options = {}) => {
  const limit = clampSearchLimit(options.limit);
  const numCandidates = computeNumCandidates(limit);
  const mongoFilter = sanitizeRagFilters(options.filters);
  const minScore = Number.isFinite(Number(options.minScore)) ? Number(options.minScore) : null;

  let queryVector;
  try {
    queryVector = await embedRagQuery(query);
  } catch (error) {
    if (/must not be empty|too long|must be a string/i.test(error.message)) {
      throw new RagSearchError("INVALID_QUERY", error.message);
    }
    throw new RagSearchError("EMBEDDING_FAILED", "Could not generate a query embedding.");
  }

  const vectorSearchStage = {
    index: RAG_VECTOR_INDEX_NAME,
    path: "embedding",
    queryVector,
    limit,
    exact: Boolean(options.useExactSearch),
  };

  // numCandidates only applies to ANN search - Atlas rejects it alongside
  // exact:true.
  if (!options.useExactSearch) {
    vectorSearchStage.numCandidates = numCandidates;
  }

  if (Object.keys(mongoFilter).length > 0) {
    vectorSearchStage.filter = mongoFilter;
  }

  let results;
  try {
    results = await ragDocumentModel.aggregate([
      { $vectorSearch: vectorSearchStage },
      { $project: RAG_RESULT_PROJECTION },
    ]);
  } catch (error) {
    if (/index not found|no such index|\bindex\b.*not found/i.test(error.message || "")) {
      throw new RagSearchError("INDEX_MISSING", "The vector search index is not available.");
    }
    throw new RagSearchError("SEARCH_FAILED", "Vector search failed.");
  }

  return minScore === null ? results : results.filter((doc) => doc.score >= minScore);
};
