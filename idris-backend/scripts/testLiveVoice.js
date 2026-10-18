import { Behavior, Modality } from "@google/genai";
import { assistantTools } from "../utils/assistantTools.js";
import {
  LIVE_MODEL,
  LIVE_TOOL_NAMES,
  buildLiveConnectConfig,
  buildLiveSystemInstruction,
} from "../utils/liveVoiceConfig.js";
import { sanitizeResumeHandle, toProductFacts } from "../controllers/liveVoiceController.js";
import { detectExclusions } from "../utils/rag/negativeIntent.js";
import { detectPriceIntent, detectSoftPriceIntent } from "../utils/rag/priceIntent.js";
import { matchCatalog, findClosestAlternatives } from "../utils/rag/catalogMatch.js";
import { buildShoppingQueryPlan } from "../utils/rag/shoppingQueryPlan.js";
import { buildCatalogOverview, LIVE_VOICE } from "../utils/liveVoiceConfig.js";
import { buildLiveSearchPlan } from "../controllers/liveVoiceController.js";

// Deterministic checks for the realtime (Gemini Live) voice path. The live
// conversation itself was verified against the real API with streamed
// Hinglish audio, not here.

let passed = 0;
const check = (name, condition) => {
  if (!condition) throw new Error(`FAILED: ${name}`);
  passed += 1;
};

const catalog = [
  { _id: "6a0b8d1250f304f37558c700", name: "Men Puffer Vest Jacket", price: 290, gender: "Men", category: "Winterwear", productType: "jacket", color: "black", sizes: ["M", "L"], bestseller: true },
];

const instruction = buildLiveSystemInstruction({ firstName: "Asha", catalog });
check("persona is Zara", instruction.includes("You are Zara"));
check("Hinglish for the whole conversation", /Stay in Hinglish for the WHOLE conversation/.test(instruction));
check("first name is personalised", instruction.includes("first name is Asha"));
check("catalog line carries id, name and price", instruction.includes("6a0b8d1250f304f37558c700 | Men Puffer Vest Jacket | Rs 290"));
check("anonymous customer is not asked for a name", buildLiveSystemInstruction({ firstName: "", catalog }).includes("not logged in"));

const config = buildLiveConnectConfig({ systemInstruction: instruction });
check("audio-only responses", config.responseModalities.length === 1 && config.responseModalities[0] === Modality.AUDIO);
check("both transcripts enabled", Boolean(config.inputAudioTranscription) && Boolean(config.outputAudioTranscription));
check("no thinking config (unsupported on gemini-3.8-live)", !("thinkingConfig" in config));
check("end-of-speech silence within Google's 500-800ms guidance", config.realtimeInputConfig.automaticActivityDetection.silenceDurationMs >= 500 && config.realtimeInputConfig.automaticActivityDetection.silenceDurationMs <= 800);
check("context compression lifts the 15-minute cap", Boolean(config.contextWindowCompression?.slidingWindow));
check("fresh session has no resume handle", !config.sessionResumption.handle);
check("resume handle is passed through", buildLiveConnectConfig({ systemInstruction: "", resumeHandle: "abc" }).sessionResumption.handle === "abc");

const declarations = config.tools[0].functionDeclarations;
check("every tool blocks until its result arrives", declarations.every((tool) => tool.behavior === Behavior.BLOCKING));
check("every text-assistant tool is available live", assistantTools.every((tool) => LIVE_TOOL_NAMES.has(tool.name)));
check("confirmation tool takes no arguments", Object.keys(declarations.find((tool) => tool.name === "answer_pending_confirmation").parameters.properties).length === 0);
check("default model is gemini-3.8-live", Boolean(process.env.GEMINI_LIVE_MODEL) || LIVE_MODEL === "gemini-3.8-live");

check("resume handle accepted", sanitizeResumeHandle("Cgx0ZXN0LWhhbmRsZQ==") === "Cgx0ZXN0LWhhbmRsZQ==");
check("resume handle with spaces/quotes rejected", sanitizeResumeHandle('abc"; drop') === "");
check("oversized resume handle rejected", sanitizeResumeHandle("a".repeat(5000)) === "");
check("non-string resume handle rejected", sanitizeResumeHandle({ $ne: "" }) === "");

const byId = new Map(catalog.map((product) => [product._id, product]));
const facts = toProductFacts({ sourceId: catalog[0]._id, metadata: { material: "polyester", features: ["hood"] } }, byId);
check("facts take name/price from the catalog", facts.name === "Men Puffer Vest Jacket" && facts.price === 290);
check("facts carry RAG metadata", facts.material === "polyester" && facts.features[0] === "hood");
check("facts never expose scores or embeddings", !("scores" in facts) && !("embedding" in facts));
check("product missing from catalog is dropped", toProductFacts({ sourceId: "000000000000000000000000", metadata: {} }, byId) === null);

// Hinglish "X wala/wali nahi" negations, which live transcripts produce often.
check("'cotton wali nahi' excludes cotton", detectExclusions("white t-shirt dikhao par cotton wali nahi").material.includes("cotton"));
check("'black wala nahi chahiye' excludes black", detectExclusions("black wala nahi chahiye").color.includes("black"));
check("'slim fit wale nahi' excludes slim", detectExclusions("slim fit wale nahi").fit.includes("slim"));
check("'cotton wali shirt dikhao' excludes nothing", detectExclusions("cotton wali shirt dikhao").material.length === 0);

// Complete, attribute-exact listings (the "sabhi jackets" bug).
const shop = [
  { _id: "a", name: "Men Black Puffer Jacket", price: 290, gender: "Men", category: "Winterwear", productType: "Jacket", color: "black", material: "Polyester" },
  { _id: "b", name: "Women Light Blue Denim Jacket", price: 220, gender: "Women", category: "Winterwear", productType: "Jacket", color: "light blue", material: "Denim" },
  { _id: "c", name: "Women Teal Blue Track Jacket", price: 240, gender: "Women", category: "Winterwear", productType: "Jacket", color: "teal blue", material: "Polyester" },
  { _id: "d", name: "Men Navy Blue Biker Jacket", price: 320, gender: "Men", category: "Winterwear", productType: "Jacket", color: "navy blue", material: "Polyester" },
  { _id: "e", name: "Men White Tee", price: 150, gender: "Men", category: "Topwear", productType: "T-Shirt", color: "white", material: "Cotton" },
  { _id: "f", name: "Men Off White Shirt", price: 260, gender: "Men", category: "Topwear", productType: "Shirt", color: "off white", material: "Pure Cotton" },
];
const plan = (include, extra = {}) => ({ include, exclude: {}, price: {}, ...extra });
check("every jacket is listed, not a top-N", matchCatalog(shop, plan({ productType: "jacket" })).length === 4);
check("'blue' matches light/teal/navy blue", matchCatalog(shop, plan({ productType: "jacket", color: "blue" })).length === 3);
check("'blue' for women matches both women's blue jackets", matchCatalog(shop, plan({ productType: "jacket", color: "blue", gender: "women" })).length === 2);
check("'men' never matches 'women'", matchCatalog(shop, plan({ gender: "men", productType: "jacket" })).every((p) => p.gender === "Men"));
check("'shirt' never matches 't-shirt'", matchCatalog(shop, plan({ productType: "shirt" })).map((p) => p._id).join() === "f");
check("'cotton' matches 'pure cotton'", matchCatalog(shop, plan({ material: "cotton" })).length === 2);
check("exclusion removes the excluded material", matchCatalog(shop, plan({ gender: "men" }, { exclude: { material: ["cotton"] } })).every((p) => !/cotton/i.test(p.material)));
check("budget is a hard cap", matchCatalog(shop, plan({ productType: "jacket" }, { price: { maxPrice: 230 } })).map((p) => p._id).join() === "b");
const red = findClosestAlternatives(shop, plan({ productType: "jacket", color: "red", gender: "men" }));
check("no red men's jacket -> alternatives keep type and gender, drop colour", red.relaxedFields.join() === "color" && red.matches.length === 2 && red.matches.every((p) => p.gender === "Men"));
check("overview counts per type", buildCatalogOverview(shop).includes("Women Jacket: 2"));

// The live plan takes schema fields from the model and never inherits them.
const live = buildLiveSearchPlan("mujhe sabhi available jacket dikhao", { productType: "jacket" });
check("live plan has no inherited colour", !live.include.color && live.include.productType === "jacket");
check("live plan keeps the customer's own exclusions", buildLiveSearchPlan("white t-shirt par cotton wali nahi", { productType: "t-shirt", color: "white" }).exclude.material.includes("cotton"));

// Text path: widening language drops constraints inherited from earlier turns.
const history = (...turns) => turns.map((content) => ({ role: "user", content }));
check("'sabhi jackets' after 'black jacket' drops black", !buildShoppingQueryPlan({ originalQuery: "mujhe sabhi available jacket dikhao", history: history("black jacket dikhao") }).include.color);
check("'koi bhi colour' drops only colour", (() => { const p = buildShoppingQueryPlan({ originalQuery: "colour koi bhi chalega", history: history("black cotton shirt dikhao") }); return !p.include.color && p.include.material === "cotton" && p.include.productType === "shirt"; })());
check("'aur blue mein?' still carries men + jacket", (() => { const p = buildShoppingQueryPlan({ originalQuery: "aur blue mein?", history: history("men ke liye jacket") }); return p.include.gender === "men" && p.include.productType === "jacket" && p.include.color === "blue"; })());
check("'sabhi black jackets' keeps the colour said now", buildShoppingQueryPlan({ originalQuery: "sabhi black jackets dikhao", history: history("white shirt") }).include.color === "black");

// Spoken rupee budgets (prices are in the thousands).
const max = (text) => detectPriceIntent(text)?.maxPrice ?? null;
check("'teen hazaar tak' -> max 3000", max("jacket teen hazaar tak") === 3000);
check("'do hazaar paanch sau tak' -> max 2500", max("do hazaar paanch sau tak") === 2500);
check("'dedh hazaar' / 'saadhe teen hazaar'", max("dedh hazaar tak") === 1500 && max("saadhe teen hazaar tak") === 3500);
check("'1500 se kam' and 'budget 2.5k'", max("1500 se kam") === 1500 && max("budget 2.5k hai") === 2500);
check("Devanagari 'ढाई हज़ार तक' and '३००० से कम'", max("ढाई हज़ार तक") === 2500 && max("३००० से कम") === 3000);
check("'2000 se upar' is a minimum", detectPriceIntent("2000 se upar")?.minPrice === 2000);
check("'1000 se 2000 tak' is a range", JSON.stringify(detectPriceIntent("1000 se 2000 tak")) === JSON.stringify({ minPrice: 1000, maxPrice: 2000 }));
check("'dikha do' / 'size L do' are not amounts", detectPriceIntent("ek jacket dikha do") === null && detectPriceIntent("size L do") === null);
check("'lagbhag do hazaar' is a soft target", detectSoftPriceIntent("lagbhag do hazaar")?.targetPrice === 2000);

check("default voice is the measured, consistently feminine Sulafat", Boolean(process.env.GEMINI_LIVE_VOICE) || LIVE_VOICE === "Sulafat");

console.log(`${passed} live voice test(s) passed.`);
