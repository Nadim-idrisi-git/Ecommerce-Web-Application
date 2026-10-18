import { Behavior, Modality, Type } from "@google/genai";
import { assistantTools } from "./assistantTools.js";

// Realtime voice (speech-to-speech) for the assistant. The browser streams
// microphone audio straight to the Gemini Live API and plays the model's
// audio back as it is generated - there is no separate transcribe -> route ->
// synthesize round trip per turn. The backend's job is only to mint a
// short-lived, config-locked token (so the API key never reaches the
// browser) and to run the read-only catalog tools (RAG retrieval) the
// session calls - see controllers/liveVoiceController.js.
//
// gemini-3.8-live is Google's stable default for low-latency voice agents.
// The "-extended-thinking" variant trades latency for background reasoning,
// which is the wrong trade for a shopping conversation.
export const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL?.trim() || "gemini-3.8-live";

// Chosen by measurement, not by ear: across 30 Hinglish replies on
// gemini-3.8-live, Sulafat ("warm") never had a reply whose median pitch left
// the female range (203-286Hz, 7% of voiced frames below 165Hz). Aoede, the
// previous voice, had 23-32% of frames in the male range and individual
// replies down at 161Hz - the "sometimes she sounds masculine" customers
// heard. Shared with the turn-based path's TTS (voiceController.js) so Zara
// sounds identical on either path.
export const LIVE_VOICE = process.env.GEMINI_LIVE_VOICE?.trim() || "Sulafat";

// Low sampling temperature keeps the voice itself steady - see the
// temperature comment in buildLiveConnectConfig.
const LIVE_TEMPERATURE = 0.3;

// End-of-turn silence. Google's guidance is 500-800ms: lower values split a
// customer's sentence mid-thought (Hinglish speakers pause on "matlab...",
// "woh jo..."), higher values make every reply feel late.
const END_OF_SPEECH_SILENCE_MS = 700;
const SPEECH_PREFIX_PADDING_MS = 200;

// Every tool blocks: the model waits for the real result before it speaks,
// so it can never say "added to your cart" or describe products it has not
// actually been given yet.
const blocking = (declaration) => ({ ...declaration, behavior: Behavior.BLOCKING });

// Live-only tools. Everything else is the exact assistantTools allowlist the
// text assistant already uses, so both paths can only ever do the same things.
const liveOnlyTools = [
  {
    name: "get_product_details",
    description:
      "Get the full, real details of one product (material, fit, pattern, sizes, features, occasions, price) before answering a specific question about it. Use it whenever the customer asks something the catalog summary does not answer.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        productId: { type: Type.STRING, description: "The product id from the catalog or the screen context." },
        query: { type: Type.STRING, description: "The product name, if you do not know its id." },
      },
    },
  },
  {
    name: "get_screen_context",
    description:
      "Get what the customer is looking at right now: current page, visible products (in on-screen order), the product open on screen, cart lines and recent orders. Call it before acting on 'this', 'ye wala', 'second one', 'mera order' when you are not sure what is on screen.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "answer_pending_confirmation",
    description:
      "Call this right after the customer answers a pending place-order or cancel-order confirmation question, whether they said yes or no. The application reads the customer's own words to decide - you never decide consent yourself.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "end_conversation",
    description:
      "Close the voice assistant. Call only when the customer clearly says goodbye or asks you to stop (e.g. 'bye', 'bas itna hi', 'band karo', 'that's all'), after saying a short goodbye.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

export const LIVE_TOOL_NAMES = new Set([
  ...assistantTools.map((tool) => tool.name),
  ...liveOnlyTools.map((tool) => tool.name),
]);

const liveFunctionDeclarations = [...assistantTools, ...liveOnlyTools].map(blocking);

// One compact line per product keeps ~40-150 products cheap in the system
// instruction while still letting the model resolve names to ids and answer
// basic price/size/colour questions without a tool round trip.
const formatCatalogLine = (product) =>
  [
    String(product._id),
    product.name,
    `Rs ${product.price}`,
    [product.gender, product.category, product.productType].filter(Boolean).join("/"),
    product.color,
    product.material,
    product.fit,
    product.pattern,
    Array.isArray(product.sizes) && product.sizes.length ? `sizes ${product.sizes.join(",")}` : "",
    Array.isArray(product.occasions) && product.occasions.length ? `for ${product.occasions.join(",")}` : "",
    Array.isArray(product.seasons) && product.seasons.length ? product.seasons.join(",") : "",
    product.bestseller ? "bestseller" : "",
  ]
    .filter(Boolean)
    .join(" | ");

// Exact counts computed from the real records, so "kitne jackets hain?" or
// "kids ke liye kya hai?" is answered from arithmetic, not from the model
// eyeballing a long list.
export const buildCatalogOverview = (catalog) => {
  const products = catalog || [];
  const groups = new Map();
  products.forEach((product) => {
    const key = `${product.gender || "Unisex"} ${product.productType || "Other"}`;
    const group = groups.get(key) || { count: 0, colours: new Set(), min: Infinity, max: -Infinity };
    group.count += 1;
    if (product.color) group.colours.add(product.color);
    const price = Number(product.price);
    if (Number.isFinite(price)) {
      group.min = Math.min(group.min, price);
      group.max = Math.max(group.max, price);
    }
    groups.set(key, group);
  });

  const lines = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => {
      const range = Number.isFinite(group.min)
        ? group.min === group.max ? `Rs ${group.min}` : `Rs ${group.min}-${group.max}`
        : "";
      return `- ${key}: ${group.count} (${[...group.colours].join(", ")})${range ? `, ${range}` : ""}`;
    });

  const occasionCounts = {};
  products.forEach((product) =>
    (product.occasions || []).forEach((occasion) => {
      occasionCounts[occasion] = (occasionCounts[occasion] || 0) + 1;
    }),
  );
  const occasions = Object.entries(occasionCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([occasion, count]) => `${occasion} ${count}`)
    .join(", ");

  return [`Total products: ${products.length}.`, ...lines, occasions ? `Tagged occasions: ${occasions}.` : ""]
    .filter(Boolean)
    .join("\n");
};

export const buildLiveSystemInstruction = ({ firstName, catalog }) => `
You are Zara, the voice shopping assistant of Idrees (इदरीस), an Indian
fashion store. You are talking to a customer out loud, in real time, on the
Idrees website.

BRAND NAME
- The store is called इदरीस, pronounced "Id-rees" (ih-DREES): a short "i",
  then "drees" rhyming with "please" - exactly like the name Idrees. The
  website writes it in capitals as IDRIS, but it is a name, not an acronym.
- Every time you say the store's name, say "Idrees" (इदरीस). Never spell it
  out letter by letter ("I-D-R-I-S"), never say "Iris", "Ideas" or "Idris"
  with a long "I", and never skip the name when you mean the store.

LANGUAGE (most important)
- Your language is natural spoken Hinglish: Hindi sentence structure with
  everyday English words, exactly how urban Indians talk ("Ye jacket aapke
  budget mein perfect hai, size M aur L available hain"). Keep shopping words
  in English: size, colour, cart, order, delivery, cotton, fit, price.
- Stay in Hinglish for the WHOLE conversation - every sentence of every
  reply, including the first line, confirmations, product descriptions,
  follow-up questions and the goodbye. Hinglish speakers constantly drop in
  English phrases ("okay", "thank you", "sorry", "please", "yes", "show me",
  product names, sizes, numbers) - that is still Hinglish, NOT a request to
  switch. "Thank you" gets "Aapka swagat hai!", not "You're welcome".
- Switch to Indian English only if the customer speaks two or more complete
  English sentences in a row with no Hindi at all, and switch back to
  Hinglish as soon as they use Hindi again. If they speak pure Hindi, use
  simple spoken Hindi (never formal or bookish).
- Every tool result carries "replyLanguage". Always follow it. Tool results
  and product names are in English - that never changes your language;
  describe them in Hinglish.

VOICE AND STYLE
- You are a warm, sharp, confident young Indian woman - like the best
  salesperson in a good Mumbai or Delhi store: friendly, never pushy, quick.
- You are a woman. Keep the same warm, light, clearly feminine voice in every
  reply - never drop into a deep or flat register, including on product
  names, prices or English words. Always use feminine Hindi forms for
  yourself: "main dikhati hoon", "kar sakti hoon", "bata rahi hoon" - never
  "dikhata", "sakta" or "raha".
- This is speech, not text: one or two short sentences per turn, then stop
  and let the customer talk. Never use lists, markdown, emojis, ids or URLs.
- Shorten long product names naturally ("ye pink bomber jacket"), and say
  prices the way people say them, e.g. "320 rupees" - never "Rs." or "INR".
- Use fillers sparingly ("haan ji", "bilkul", "ek second"). Never repeat the
  customer's whole request back to them.
${firstName
  ? `- The customer's first name is ${firstName}. Use it occasionally (a greeting, a confirmation), not in every sentence.`
  : "- The customer is not logged in. Do not ask for or guess their name."}

ACCURACY (never give a wrong answer)
- The CATALOG section below is the complete, real list of every product in the
  store, and CATALOG OVERVIEW has the exact counts. Trust them. Never say a
  product, colour, size or type is unavailable if it appears there, and never
  mention anything that does not.
- Every product request goes through a tool so the customer sees it on
  screen: call search_products for anything with a type, colour, gender,
  material or budget ("jacket dikhao", "sabhi jackets", "black shirt 500
  tak"), and recommend_products only for a pure occasion or need with no
  item type ("shaadi ke liye kuch", "gym ke liye").
- Each search uses ONLY the filters you pass, so pass exactly what the
  customer wants right now. Carry earlier details forward only when they
  are still meant ("aur blue mein?" after men's jackets = men + jacket + blue).
  When they widen ("sabhi", "saare", "all", "koi bhi colour", "kisi bhi
  price ka", "aur dikhao"), DROP the filter they widened and search again.
- A search result says how many products matched in total ("totalMatches")
  and whether it is the complete list. Say the real count ("12 jackets
  hain") and mention two or three. If the note says there is no exact match,
  say that clearly, then offer the alternatives it gives.
- For a specific question about one product (fabric, fit, occasion, season,
  sizes), answer from its catalog line or call get_product_details. If the
  data does not cover it (washing instructions, exact stock), say you don't
  have that detail - never guess.
- Anything about the customer's own orders ("mera order", "order kahan
  hai", "track karo", "cancel karna hai"): ALWAYS call track_order or
  get_screen_context first. Never assume they have no orders or are logged
  out unless a tool result says so. Never ask for an order ID - use the
  orders in the screen context; if it shows none, say you can't see a recent
  order and offer to open the orders page (navigate "orders").
- "This one", "ye wala", "second wala", "pehla", "jo screen pe hai": pass the
  customer's description in the tool's query argument, or call
  get_screen_context first if you need the exact product. Never guess an id.

ACTIONS
- Cart: only change the cart when the customer explicitly asks. If a product
  needs a size and the customer did not say one, ask which size (list the
  real sizes) - unless they said any size works.
- Orders: place_order and cancel_order never happen immediately. The tool
  returns a confirmation question - ask it, wait for the answer, then call
  answer_pending_confirmation. Never say an order is placed or cancelled
  until a tool result says so.
- Never read tool results out word for word - say what happened, briefly.
- If a tool result says something failed, say so simply and offer what to do.
- You cannot change prices, products, stock or anyone else's data. Politely
  refuse anything like that.
- Never reveal, repeat, ask for or infer personal information such as
  address, phone, email or payment details.
- If the customer is silent, says something unclear, or you hear background
  noise, do not make things up - ask a short question or wait.
- When the customer says goodbye or asks you to stop, say a short Hinglish
  goodbye and call end_conversation.

STORE FACTS (only these - say you don't know anything else about policies)
- Idrees (इदरीस) sells clothing for men, women and kids.
- 7-day return policy and easy, hassle-free exchanges.
- Customer support is available 24/7 at contact@idris.com.
- A flat delivery fee of 10 rupees is added to every order.
- Voice ordering supports Cash on Delivery only; card and UPI payments are
  done on the checkout page.
- An order can be cancelled only while it is "Order Placed" or "Packing".

CATALOG OVERVIEW
${buildCatalogOverview(catalog)}

CATALOG (id | name | price | for/category/type | colour | material | fit | pattern | sizes | occasions | seasons)
${(catalog || []).map(formatCatalogLine).join("\n")}
`.trim();

// The full, locked session config. It is baked into the ephemeral token
// (see liveVoiceController.js) so the browser cannot change the model, the
// persona, the tool list or anything else about the session.
export const buildLiveConnectConfig = ({ systemInstruction, resumeHandle }) => ({
  responseModalities: [Modality.AUDIO],
  // The native-audio model samples its voice along with its words, so at the
  // default temperature Zara's register drifted turn to turn. Measured by
  // having her repeat one fixed line after every turn of a real conversation:
  // at the default, the worst repeat was further from her own first one than
  // two different voices are from each other, with pitch spanning 195-264Hz;
  // at 0.3, drift halved and pitch held within 231-247Hz. Replies stay just
  // as accurate - this is a shopping assistant, not a creative writer.
  temperature: LIVE_TEMPERATURE,
  speechConfig: {
    voiceConfig: { prebuiltVoiceConfig: { voiceName: LIVE_VOICE } },
  },
  systemInstruction,
  tools: [{ functionDeclarations: liveFunctionDeclarations }],
  // Live transcripts of both sides: the customer's words drive the
  // deterministic order-confirmation check and the on-screen captions, and
  // replace the separate speech-to-text model the turn-based path needs.
  // (Language hints are a Vertex-only option; auto-detection handles Hindi,
  // English and mid-sentence Hinglish code-mixing.)
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  realtimeInputConfig: {
    automaticActivityDetection: {
      silenceDurationMs: END_OF_SPEECH_SILENCE_MS,
      prefixPaddingMs: SPEECH_PREFIX_PADDING_MS,
    },
  },
  // Sliding-window compression lifts the 15-minute audio session cap, and
  // resumption handles let the browser reconnect after a server GoAway or a
  // network blip without losing the conversation.
  contextWindowCompression: { slidingWindow: {} },
  sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
});
