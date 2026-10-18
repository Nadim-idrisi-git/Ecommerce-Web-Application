import { GoogleGenAI } from "@google/genai";
import productModel from "../models/productModel.js";
import { getFirstName, sanitizeMessage } from "../utils/aiChatContext.js";
import { assistantToolSanitizers } from "../utils/assistantToolSanitizers.js";
import {
  LIVE_MODEL,
  buildLiveConnectConfig,
  buildLiveSystemInstruction,
} from "../utils/liveVoiceConfig.js";
import { buildRagFiltersForTool } from "./intentController.js";
import { buildShoppingQueryPlan } from "../utils/rag/shoppingQueryPlan.js";
import { searchHybridRag } from "../utils/rag/hybridSearchRag.js";
import { buildFiltersFromPlan, buildRerankOverridesFromPlan } from "../utils/rag/assistantRag.js";
import { normalizeRagQuery } from "../utils/rag/embedRagQuery.js";
import { sanitizeComparisonIds } from "../utils/rag/compareProducts.js";
import {
  distinctValues,
  findClosestAlternatives,
  hasStructuredConstraint,
  matchCatalog,
} from "../utils/rag/catalogMatch.js";
import { logOrchestrationEvent } from "../utils/orchestrationLogger.js";

// Ephemeral tokens are a v1alpha-only feature of the Gemini Developer API.
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { apiVersion: "v1alpha" },
});

// The token only has to survive until the browser opens its WebSocket, so
// new sessions are refused after 60s. An already-open session may run for
// up to SESSION_TOKEN_TTL_MS; past that the browser asks for a fresh token
// and resumes the same conversation with its resumption handle.
const NEW_SESSION_WINDOW_MS = 60 * 1000;
const SESSION_TOKEN_TTL_MS = 30 * 60 * 1000;
const MAX_RESUME_HANDLE_LENGTH = 2048;
const RESUME_HANDLE_PATTERN = /^[A-Za-z0-9_\-./+=:]+$/;

export const sanitizeResumeHandle = (value) => {
  if (typeof value !== "string") return "";
  const handle = value.trim();
  if (!handle || handle.length > MAX_RESUME_HANDLE_LENGTH) return "";
  return RESUME_HANDLE_PATTERN.test(handle) ? handle : "";
};

// POST /api/voice/live/session { resumeHandle? } -> { token, model, expiresAt }
//
// Every field of the session config (model, voice, persona, catalog, tools,
// VAD, transcription) is locked into the token server-side - the browser
// cannot swap the system prompt, add tools, or point the token at a
// different model. Leaving lockAdditionalFields unset is what locks all of
// them; an explicit field list made the API reject the setup's field mask.
export const createLiveSession = async (req, res) => {
  try {
    const resumeHandle = sanitizeResumeHandle(req.body?.resumeHandle);
    const [catalog, firstName] = await Promise.all([
      getLiveCatalog(),
      getFirstName(req.userId),
    ]);

    const now = Date.now();
    const expiresAt = new Date(now + SESSION_TOKEN_TTL_MS).toISOString();

    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: expiresAt,
        newSessionExpireTime: new Date(now + NEW_SESSION_WINDOW_MS).toISOString(),
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: buildLiveConnectConfig({
            systemInstruction: buildLiveSystemInstruction({ firstName, catalog }),
            resumeHandle,
          }),
        },
      },
    });

    if (!token?.name) throw new Error("Token response had no name");

    logOrchestrationEvent("live_session_token", { resumed: Boolean(resumeHandle) });

    return res.status(200).json({
      success: true,
      token: token.name,
      model: LIVE_MODEL,
      expiresAt,
    });
  } catch (error) {
    console.error("Live session token error:", error);
    return res.status(502).json({
      success: false,
      message: "Live voice is unavailable right now",
    });
  }
};

// The live session's own view of the catalog: every product with every
// attribute customers ask about, so search results, the system prompt and
// product details all come from the same real records. Cached like
// getCachedCatalog (60s) - an admin edit shows up within a minute.
const LIVE_CATALOG_TTL_MS = 60_000;
const LIVE_CATALOG_FIELDS =
  "name price gender category productType color sizes material fit pattern features occasions seasons style bestseller date";
let liveCatalogCache = { data: null, expiresAt: 0 };

export const getLiveCatalog = async () => {
  if (liveCatalogCache.data && liveCatalogCache.expiresAt > Date.now()) return liveCatalogCache.data;
  const products = await productModel
    .find()
    .select(LIVE_CATALOG_FIELDS)
    .sort({ bestseller: -1, date: -1 })
    .lean();
  liveCatalogCache = { data: products, expiresAt: Date.now() + LIVE_CATALOG_TTL_MS };
  return products;
};

// Only the product facts the model needs to talk accurately - never the
// embedding, retrieval scores, or internal fields. Everything comes from the
// real product record keyed by _id (RAG metadata only fills a gap), so a
// stale RAG document can never put a product or attribute in Zara's mouth
// that the store no longer has.
export const toProductFacts = (candidate, catalogById) => {
  const product = catalogById.get(String(candidate.sourceId));
  if (!product) return null;

  const metadata = candidate.metadata || {};
  const list = (value, fallback, max) =>
    (Array.isArray(value) && value.length ? value : Array.isArray(fallback) ? fallback : []).slice(0, max);

  return {
    id: String(product._id),
    name: product.name,
    price: product.price,
    for: product.gender || metadata.gender || "",
    category: product.category || metadata.category || "",
    type: product.productType || metadata.productType || "",
    colour: product.color || metadata.color || "",
    material: product.material || metadata.material || "",
    fit: product.fit || metadata.fit || "",
    pattern: product.pattern || metadata.pattern || "",
    sizes: list(product.sizes, metadata.sizes, 10),
    features: list(product.features, metadata.features, 6),
    occasions: list(product.occasions, metadata.occasions, 6),
    seasons: list(product.seasons, metadata.seasons, 4),
    bestseller: Boolean(product.bestseller),
  };
};

const factsFor = (product, catalogById) => toProductFacts({ sourceId: product._id }, catalogById);

// Enough for the model to describe any listing accurately; the customer's
// screen shows every match regardless.
const LIVE_LIST_LIMIT = 24;

// The schema fields search_products can carry. The live model sees the whole
// conversation, so its arguments are the authority for these: a value it
// dropped on purpose ("ab koi bhi colour") must stay dropped. The customer's
// own words still add what the schema can't express (material, fit, pattern,
// occasion...), plus exclusions ("cotton wali nahi") and exact budgets.
const MODEL_OWNED_FIELDS = ["gender", "category", "productType", "color"];

export const buildLiveSearchPlan = (utterance, sanitizedArgs) => {
  const plan = buildShoppingQueryPlan({
    originalQuery: utterance || sanitizedArgs.query || "",
    toolArguments: sanitizedArgs,
    // Deliberately no history: carrying an earlier turn's colour forward is
    // exactly what made "sabhi jackets dikhao" after "black jacket" keep
    // returning only black. Conversation context is the model's job here.
    history: [],
  });

  MODEL_OWNED_FIELDS.forEach((field) => {
    if (sanitizedArgs[field]) plan.include[field] = sanitizedArgs[field];
  });
  Object.keys(plan.exclude).forEach((field) => {
    if (plan.include[field]) {
      plan.exclude[field] = plan.exclude[field].filter((value) => value !== plan.include[field]);
    }
  });
  return plan;
};

const byPriceThenBestseller = (a, b) =>
  (Number(a.price) || 0) - (Number(b.price) || 0) || Number(Boolean(b.bestseller)) - Number(Boolean(a.bestseller));

const FIELD_LABELS = { color: "colour", pattern: "pattern", fit: "fit", material: "material", occasion: "occasion", season: "season", style: "style" };

// Exact listing over the whole catalog for any request with a concrete
// attribute (type, gender, colour, material...). Complete, deterministic,
// and no embedding call, so it is also the fastest path.
const runStructuredListing = ({ plan, catalog, catalogById }) => {
  let matches = matchCatalog(catalog, plan);
  let note = "";

  if (matches.length) {
    note = `${matches.length} product(s) in the catalog match exactly. This is the COMPLETE list (lowest price first), now on the customer's screen. Tell them how many there are and mention two or three.`;
  } else if (plan.price.minPrice != null || plan.price.maxPrice != null) {
    const overBudget = matchCatalog(catalog, plan, { ignorePrice: true });
    if (overBudget.length) {
      matches = overBudget;
      note = `Nothing matches within the customer's budget. These ${overBudget.length} match everything else but cost more (lowest price first) - say so honestly before suggesting them.`;
    }
  }

  if (!matches.length) {
    const { relaxedFields, matches: alternatives } = findClosestAlternatives(catalog, plan);
    if (alternatives.length) {
      matches = alternatives;
      const described = relaxedFields
        .map((field) => {
          const available = distinctValues(alternatives, field);
          return `${FIELD_LABELS[field] || field} "${plan.include[field]}"${available.length ? ` (these have: ${available.join(", ")})` : ""}`;
        })
        .join("; ");
      note = `No exact match: of the products that fit the rest of the request (same type/for), none has ${described}. Say clearly that this exact combination is not available - do not claim the store has nothing with that ${relaxedFields.map((field) => FIELD_LABELS[field] || field).join("/")} at all - then offer these ${alternatives.length} closest real alternatives.`;
    } else {
      note = "No product in the catalog matches this request and there is no close alternative of the same type. Say so honestly and suggest what the store does sell.";
    }
  }

  const ordered = [...matches].sort(byPriceThenBestseller);
  return {
    products: ordered.slice(0, LIVE_LIST_LIMIT).map((product) => factsFor(product, catalogById)).filter(Boolean),
    totalMatches: matches.length,
    note,
  };
};

// Semantic retrieval for open-ended requests ("shaadi ke liye kuch",
// "something warm for travel") where there is no exact attribute to list
// by. Retrieval only - no answer-generation call: the Live model already
// turns grounded facts into a spoken reply itself, so a second LLM pass
// would only add ~2s.
const runSemanticSearch = async ({ tool, plan, sanitizedArgs, originalQuery, catalogById }) => {
  let retrievalQuery;
  try {
    retrievalQuery = normalizeRagQuery(plan.retrievalQuery || originalQuery);
  } catch {
    return { products: [], totalMatches: 0, note: "The request had nothing to search for." };
  }

  const { results, relaxed } = await searchHybridRag(retrievalQuery, {
    filters: buildFiltersFromPlan(plan, buildRagFiltersForTool(tool, sanitizedArgs)),
    rerankOverrides: buildRerankOverridesFromPlan(plan),
  });

  const products = results.map((candidate) => toProductFacts(candidate, catalogById)).filter(Boolean);

  return {
    products,
    totalMatches: products.length,
    note: relaxed?.field === "maxPrice"
      ? `Nothing matched within the customer's budget of ${relaxed.requestedValue} rupees. These are the closest matches above that budget - say so honestly.`
      : products.length
        ? "These are the most relevant products for this request (not necessarily every match), now on the customer's screen."
        : "No product in the catalog matches this request.",
  };
};

const runLiveSearch = async ({ tool, args, utterance, catalog, catalogById }) => {
  const sanitizedArgs = assistantToolSanitizers[tool](args || {});
  if (!sanitizedArgs) return { products: [], totalMatches: 0, note: "Invalid search arguments." };

  const originalQuery = utterance || sanitizedArgs.query || "";
  const plan = buildLiveSearchPlan(utterance, sanitizedArgs);

  if (hasStructuredConstraint(plan)) {
    return runStructuredListing({ plan, catalog, catalogById });
  }
  return runSemanticSearch({ tool, plan, sanitizedArgs, originalQuery, catalogById });
};

const runLiveCompare = async ({ args, catalogById }) => {
  const ids = sanitizeComparisonIds(args?.productIds).filter((id) => catalogById.has(id));
  if (ids.length < 2) {
    return { products: [], note: "Need at least two specific products to compare. Ask which ones." };
  }
  const products = ids.map((id) => factsFor(catalogById.get(id), catalogById)).filter(Boolean);
  return {
    products,
    note: "Compare only on these real attributes, then give a short recommendation for the customer's need.",
  };
};

const findCatalogProduct = (args, catalog, catalogById) => {
  const id = typeof args?.productId === "string" ? args.productId.trim() : "";
  if (id && catalogById.has(id)) return catalogById.get(id);

  const query = typeof args?.query === "string" ? args.query.trim().toLowerCase() : "";
  if (!query) return null;
  return (
    catalog.find((product) => product.name?.toLowerCase() === query) ||
    catalog.find((product) => product.name?.toLowerCase().includes(query)) ||
    catalog.find((product) => query.includes(product.name?.toLowerCase())) ||
    null
  );
};

const runLiveProductDetails = async ({ args, catalog, catalogById }) => {
  const product = findCatalogProduct(args, catalog, catalogById);
  if (!product) {
    return { products: [], note: "Could not identify that product. Ask the customer which one they mean." };
  }
  const facts = factsFor(product, catalogById);
  return { products: facts ? [facts] : [], note: "Answer only from these facts. If they do not answer the question, say you don't have that detail." };
};

const LIVE_SERVER_TOOLS = {
  search_products: runLiveSearch,
  recommend_products: runLiveSearch,
  compare_products: runLiveCompare,
  get_product_details: runLiveProductDetails,
};

// POST /api/voice/live/tool { tool, args, utterance }
//
// The browser forwards the Live session's read-only catalog tool calls here.
// Arguments are untrusted (they came from the model via the browser) and are
// re-sanitized with the same sanitizers the text assistant uses. Cart/order
// tools are never accepted here - those run in the frontend against the
// customer's own authenticated session, behind its confirmation gates.
export const runLiveTool = async (req, res) => {
  const tool = typeof req.body?.tool === "string" ? req.body.tool : "";
  const handler = LIVE_SERVER_TOOLS[tool];

  if (!handler) {
    return res.status(400).json({ success: false, message: "Unsupported tool" });
  }

  try {
    const catalog = await getLiveCatalog();
    const catalogById = new Map(catalog.map((product) => [String(product._id), product]));

    const result = await handler({
      tool,
      args: req.body?.args && typeof req.body.args === "object" ? req.body.args : {},
      utterance: sanitizeMessage(req.body?.utterance),
      catalog,
      catalogById,
    });

    logOrchestrationEvent("live_tool_executed", { tool, resultCount: result.products.length });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error(`Live tool ${tool} failed:`, error);
    return res.status(500).json({
      success: false,
      message: "Catalog lookup failed",
    });
  }
};
