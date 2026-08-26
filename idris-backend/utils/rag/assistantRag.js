// The single integration boundary between the existing AI assistant
// (controllers/intentController.js) and the module 4-6 RAG pipeline. Wires
// together searchHybridRag() (module 5) and generateRagAnswer() (module 6)
// exactly as they exist - no retrieval/generation logic is duplicated here,
// only reshaped into an assistant-facing result and given one error type.
import { searchHybridRag } from "./hybridSearchRag.js";
import { generateRagAnswer, RagGenerationError } from "./generateRagAnswer.js";
import { normalizeRagQuery } from "./embedRagQuery.js";

export class AssistantRagError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AssistantRagError";
    this.code = code;
  }
}

// MODULE 11: fields sanitizeRagFilters() (utils/rag/searchRag.js) already
// accepts as a real hard Mongo pre-filter (utils/rag/vectorSearchConfig.js's
// RAG_FILTERABLE_STRING_FIELDS) - material/fit/pattern were already
// supported there even though the search_products TOOL SCHEMA never
// populates them, so a canonical plan's include.material/fit/pattern reach
// retrieval as real hard filters with no change needed to module 4/5 at
// all.
const PLAN_FILTERABLE_FIELDS = ["gender", "category", "productType", "color", "material", "fit", "pattern"];

// Builds the actual hard filter object passed to searchHybridRag(). A
// canonical plan's deterministic include/price ALWAYS wins over whatever
// legacy `filters` a caller separately supplied (Gemini's raw tool
// arguments) for the same field - Part 3's explicit requirement - legacy
// filters only fill a field the plan itself has nothing for. Exported for
// direct unit testing.
export const buildFiltersFromPlan = (plan, legacyFilters) => {
  if (!plan) return legacyFilters;

  const merged = { ...legacyFilters };
  PLAN_FILTERABLE_FIELDS.forEach((field) => {
    if (plan.include[field]) merged[field] = plan.include[field];
  });
  if (plan.price.minPrice != null) merged.minPrice = plan.price.minPrice;
  if (plan.price.maxPrice != null) merged.maxPrice = plan.price.maxPrice;
  return merged;
};

// Builds rerankRagCandidates()'s optional overrides (see that file and
// hybridSearchRag.js) from a canonical plan, so the reranker's hard-
// exclusion filter and price scoring use the plan's multi-turn/Devanagari-
// aware reading instead of re-deriving a weaker one from the single
// retrieval query string. Exported for direct unit testing.
export const buildRerankOverridesFromPlan = (plan) => {
  if (!plan) return undefined;

  const isHardPrice = ["hard_max", "hard_min", "hard_range"].includes(plan.price.mode);

  return {
    exclusions: plan.exclude,
    priceIntent: isHardPrice ? { minPrice: plan.price.minPrice, maxPrice: plan.price.maxPrice } : null,
    softPriceIntent: plan.price.targetPrice != null ? { targetPrice: plan.price.targetPrice } : null,
  };
};

// { query, filters?, limit?, originalQuery? } -> { answer, grounded, sources, meta }
//
// sources here are enriched with name/price for the assistant's future use
// (module 6's own contract only carries sourceId/productName) - both name
// and price are still derived entirely from the retrieved candidates, never
// from the model's generated text.
//
// MODULE 9 finding: `query` here is often intentController.js's *tool-
// extracted* search string (Gemini's own search_products/recommend_products
// argument, e.g. "purple floral top" extracted from "mujhe purple floral
// top chahiye") - it commonly strips exactly the Hindi/Hinglish words that
// the customer's actual message contained, which made the language
// classifier (fed the same anglicized text) unable to ever see them. That
// tool-extracted string is still fine, even preferable, for RETRIEVAL, so
// it continues to drive searchHybridRag() unchanged. `originalQuery` - the
// customer's verbatim message, when the caller has it - is used ONLY for
// generateRagAnswer() (which is what actually judges response language and
// shows "the customer's query" back to the model). Falls back to `query`
// when no separate original is supplied, so existing callers/tests are
// unaffected.
//
// MODULE 11: `plan` (utils/rag/shoppingQueryPlan.js's buildShoppingQueryPlan()
// output) is optional - omitted, this function behaves exactly as it did
// before this parameter existed. When supplied, its deterministic
// include/exclude/price ALWAYS take priority over `filters` for the same
// field (see buildFiltersFromPlan above) and its exclusions/price also
// override rerankRagCandidates()'s own re-derivation (see
// buildRerankOverridesFromPlan above) - `filters` still fills any field
// the plan itself couldn't establish (e.g. a vague reference Gemini
// resolved via uiContext).
//
// `deps` is an internal testing seam only (same pattern as
// generateRagAnswer.js's injectable `generateContent`) - defaults to the
// real module 5/6 functions and must never be supplied by an actual caller.
export const assistantRag = async (
  { query, filters, limit, originalQuery, plan } = {},
  deps = {},
) => {
  const runHybridSearch = deps.searchHybridRag || searchHybridRag;
  const runGeneration = deps.generateRagAnswer || generateRagAnswer;
  const generationQuery = originalQuery || query;
  const effectiveFilters = buildFiltersFromPlan(plan, filters);
  const rerankOverrides = buildRerankOverridesFromPlan(plan);

  // Validated up front, before either retrieval branch runs - both
  // searchRag() and searchRagLexical() independently reject an invalid
  // query too, but if they *both* reject, searchHybridRag() (module 5)
  // collapses that into one generic RETRIEVAL_FAILED without preserving
  // which specific reason caused it. Failing fast here on the actual
  // input-validation problem avoids that ambiguity entirely, without
  // needing to change module 5's error handling.
  try {
    normalizeRagQuery(query);
  } catch (error) {
    throw new AssistantRagError("INVALID_QUERY", error.message);
  }

  let candidates;
  let relaxed = null;
  try {
    const hybridResult = await runHybridSearch(query, {
      filters: effectiveFilters,
      limit,
      rerankOverrides,
    });
    candidates = hybridResult.results;
    relaxed = hybridResult.relaxed || null;
  } catch (error) {
    console.error("assistantRag: retrieval failed:", error.message);
    throw new AssistantRagError("RETRIEVAL_FAILED", "Product retrieval failed.");
  }

  let generated;
  try {
    generated = await runGeneration({ query: generationQuery, candidates, relaxed });
  } catch (error) {
    if (error instanceof RagGenerationError && error.code === "INVALID_QUERY") {
      throw new AssistantRagError("INVALID_QUERY", error.message);
    }
    console.error("assistantRag: generation failed:", error.message);
    throw new AssistantRagError("GENERATION_FAILED", "Could not generate a grounded answer.");
  }

  const candidatesBySourceId = new Map(candidates.map((c) => [String(c.sourceId), c]));

  return {
    answer: generated.answer,
    grounded: generated.grounded,
    sources: generated.sources.map((source) => {
      const candidate = candidatesBySourceId.get(String(source.sourceId));
      return {
        sourceId: source.sourceId,
        name: source.productName,
        price: candidate?.metadata?.price ?? null,
      };
    }),
    meta: generated.meta,
  };
};
