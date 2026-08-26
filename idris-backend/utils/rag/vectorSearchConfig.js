// Server-controlled constants for the vector search layer. The index name
// is never accepted from a caller - it's always this constant, so nothing
// external can point retrieval at an arbitrary/unintended index.
export const RAG_VECTOR_INDEX_NAME = "rag_embedding_index";
export const RAG_VECTOR_SIMILARITY = "cosine";

export const RAG_SEARCH_LIMIT_DEFAULT = 8;
export const RAG_SEARCH_LIMIT_MIN = 1;
export const RAG_SEARCH_LIMIT_MAX = 20;

// numCandidates must exceed limit for ANN quality; bounded on both ends so
// the catalog growing later can't silently balloon this into an expensive
// scan, and a tiny limit still gets a reasonable candidate pool.
export const RAG_SEARCH_NUM_CANDIDATES_MULTIPLIER = 20;
export const RAG_SEARCH_NUM_CANDIDATES_MAX = 200;

export const RAG_QUERY_MAX_LENGTH = 500;

// Only these product-facing metadata fields are filterable from a caller.
// Anything not in this list is silently ignored, never passed through as a
// raw Mongo filter - see utils/rag/searchRag.js's sanitizeRagFilters.
export const RAG_FILTERABLE_STRING_FIELDS = [
  "gender",
  "category",
  "productType",
  "color",
  "material",
  "fit",
  "pattern",
];
