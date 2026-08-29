// MODULE 13 — the comparison orchestration boundary, mirroring
// assistantRag.js's role for search/recommend: wires together a read-only
// product lookup and generateComparisonAnswer.js exactly as they exist, no
// retrieval/generation logic duplicated here, reshaped into one error type.
import ragDocumentModel from "../../models/ragDocumentModel.js";
import { generateComparisonAnswer, RagComparisonError } from "./generateComparisonAnswer.js";
import { detectResponseLanguage } from "./languageIntent.js";
import { RAG_COMPARISON_MIN_PRODUCTS, RAG_COMPARISON_MAX_PRODUCTS } from "./ragComparisonConfig.js";

export class CompareProductsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CompareProductsError";
    this.code = code;
  }
}

// Same per-language, zero-Gemini-call deterministic answer as
// generateComparisonAnswer.js's own NEED_MORE_PRODUCTS_ANSWERS - duplicated
// here (not imported) only because it must fire BEFORE any candidates
// exist to check a query's language against; kept intentionally identical
// in wording.
const NEED_MORE_IDS_ANSWERS = {
  english:
    "I need at least two products to compare. Could you tell me which two you'd like me to compare?",
  hindi:
    "तुलना करने के लिए मुझे कम से कम दो प्रोडक्ट चाहिए। कृपया बताएं कि आप किन दो प्रोडक्ट की तुलना करना चाहते हैं?",
  hinglish:
    "Compare karne ke liye mujhe kam se kam do products chahiye. Batayein aap kaunse do products compare karna chahte hain?",
};

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

// Re-validates/dedupes/caps ObjectId-shaped ids - defense in depth even
// though assistantToolSanitizers.js's compare_products sanitizer already did
// this, the same "never trust it just because an earlier layer checked it"
// principle already applied throughout this backend.
export const sanitizeComparisonIds = (productIds) => {
  const raw = Array.isArray(productIds) ? productIds : [];
  const deduped = [...new Set(
    raw
      .filter((id) => typeof id === "string")
      .map((id) => id.trim())
      .filter((id) => OBJECT_ID_PATTERN.test(id)),
  )];
  return deduped.slice(0, RAG_COMPARISON_MAX_PRODUCTS);
};

// sourceIds: string[] (already sanitized ObjectId-shaped strings) -> RAG
// candidate-shaped objects (same {sourceId, type, text, metadata} shape
// searchHybridRag()/buildRagContext() already expect - reused, not
// reinvented). A plain $in lookup by already-validated id, never a
// caller-controlled filter/operator.
export const fetchComparisonCandidates = async (sourceIds, deps = {}) => {
  const model = deps.ragDocumentModel || ragDocumentModel;
  if (!sourceIds.length) return [];

  const docs = await model
    .find({ sourceId: { $in: sourceIds } }, "sourceId type text metadata")
    .lean();

  return docs.map((doc) => ({
    sourceId: doc.sourceId,
    type: doc.type,
    text: doc.text,
    metadata: doc.metadata,
  }));
};

// { productIds, originalQuery } -> { answer, grounded, sources, meta }
//
// `deps` is an internal testing seam only (same pattern as assistantRag.js) -
// defaults to the real fetch/generation functions and must never be
// supplied by an actual caller.
export const compareProducts = async ({ productIds, originalQuery } = {}, deps = {}) => {
  const runFetch = deps.fetchComparisonCandidates || fetchComparisonCandidates;
  const runGeneration = deps.generateComparisonAnswer || generateComparisonAnswer;

  const validIds = sanitizeComparisonIds(productIds);
  const query = String(originalQuery || "").trim() || "compare these products";

  if (validIds.length < RAG_COMPARISON_MIN_PRODUCTS) {
    // Not enough resolvable product references to even attempt a lookup -
    // deterministic clarification, zero DB/Gemini calls (Part A9/A10).
    const responseLanguage = detectResponseLanguage(query).language;
    return {
      answer: NEED_MORE_IDS_ANSWERS[responseLanguage] || NEED_MORE_IDS_ANSWERS.english,
      grounded: false,
      sources: [],
      meta: { candidateCount: 0, contextCount: 0, responseLanguage },
    };
  }

  let candidates;
  try {
    candidates = await runFetch(validIds, deps);
  } catch (error) {
    console.error("compareProducts: product lookup failed:", error.message);
    throw new CompareProductsError("LOOKUP_FAILED", "Product lookup for comparison failed.");
  }

  try {
    return await runGeneration({ query, candidates });
  } catch (error) {
    if (error instanceof RagComparisonError && error.code === "INVALID_QUERY") {
      throw new CompareProductsError("INVALID_QUERY", error.message);
    }
    console.error("compareProducts: generation failed:", error.message);
    throw new CompareProductsError("GENERATION_FAILED", "Could not generate a grounded comparison.");
  }
};
