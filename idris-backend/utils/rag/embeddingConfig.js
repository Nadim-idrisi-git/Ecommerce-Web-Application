// Single source of truth for the embedding model/dimension/version this
// pipeline targets - every file that needs any of these imports them from
// here instead of hardcoding the value, so a future change is a one-line
// edit (and the sync script's staleness check picks it up automatically).

// Chosen over text-embedding-004 (legacy, only appears in the SDK's own
// JSDoc example) and gemini-embedding-001 (still solid, but this project
// already runs its chat model on the newer gemini-3.6-flash generation, and
// gemini-embedding-2 is the newest embedding model the installed
// @google/genai SDK has dedicated handling for).
export const RAG_EMBEDDING_MODEL = "gemini-embedding-2";

// Explicit, not left to the API's default (which for this model is 3072 -
// unnecessarily large/slow/expensive for a ~44-to-low-thousands product
// catalog). 768 is a well-supported Matryoshka truncation of this model
// that keeps per-vector storage and future similarity-search latency low
// while still being large enough for accurate product-attribute matching.
export const RAG_EMBEDDING_OUTPUT_DIMENSIONALITY = 768;

// Bump this (not a timestamp) whenever the embedding model, output
// dimension, preprocessing, or embedding strategy changes enough that
// existing vectors should be considered stale and regenerated. v1 ->
// v2 specifically marks the move from the API's default 3072-dim output to
// an explicit 768-dim output - the two are not compatible/comparable
// vectors, so this bump is what makes every existing v1/3072-dim embedding
// get picked up as stale by utils/rag/embeddingState.js.
export const RAG_EMBEDDING_VERSION = "v2";

// Standard Gemini embedding task type for the indexing/document side of
// retrieval - used when embedding a product's RAG text (see embedRagDocument.js).
export const RAG_EMBEDDING_TASK_TYPE = "RETRIEVAL_DOCUMENT";

// Used when embedding a customer's search query (see embedRagQuery.js) -
// asymmetric from RAG_EMBEDDING_TASK_TYPE on purpose. Gemini embedding
// models optimize document-side and query-side vectors differently even
// though both come out at the same dimension/model, so a query must never
// be embedded with RETRIEVAL_DOCUMENT (or vice versa).
export const RAG_EMBEDDING_QUERY_TASK_TYPE = "RETRIEVAL_QUERY";
