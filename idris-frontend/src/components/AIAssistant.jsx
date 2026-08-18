import { useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getApiConfig } from "../config/api";
import { ShopContext } from "../context/ShopContext";
import { searchProducts } from "../utils/productSearch";

// Maps a route to a short page label the assistant can reason about. Kept
// deliberately generic - it never carries per-page PII, just "what kind of
// page is this" for reference resolution and available-action awareness.
const PAGE_BY_PATH = [
  { test: (p) => p === "/", page: "home" },
  { test: (p) => p === "/collection", page: "collection" },
  { test: (p) => p.startsWith("/product/"), page: "product" },
  { test: (p) => p === "/cart", page: "cart" },
  { test: (p) => p === "/place-order", page: "checkout" },
  { test: (p) => p === "/orders", page: "orders" },
  { test: (p) => p.startsWith("/track/"), page: "track_order" },
  { test: (p) => p === "/addresses", page: "addresses" },
  { test: (p) => p === "/profile", page: "profile" },
  { test: (p) => p === "/login", page: "login" },
  { test: (p) => p === "/about", page: "about" },
  { test: (p) => p === "/contact", page: "contact" },
];

const getPageForPath = (pathname) =>
  PAGE_BY_PATH.find(({ test }) => test(pathname))?.page || "other";

// Only these fields ever leave the browser as "visible product" context -
// never description text (which could theoretically be edited by an admin
// to include something unexpected) and never anything from cart/order/user
// records beyond product identity.
const summarizeProductForContext = (product) => ({
  id: product._id,
  name: product.name,
  category: product.category,
  subCategory: product.subCategory,
  price: product.price,
  bestseller: Boolean(product.bestseller),
});

// Every action the assistant can take lives here. The backend (/api/ai/intent)
// declares the exact same tool names/schemas to Gemini's function calling, so
// the model can only ever pick from this allowlist - it cannot invent a tool.
const NAVIGATE_ROUTES = {
  home: "/",
  about: "/about",
  contact: "/contact",
  cart: "/cart",
  collection: "/collection",
  profile: "/profile",
  addresses: "/addresses",
  orders: "/orders",
  login: "/login",
};

const NAVIGATE_SPOKEN = {
  home: "Opening home.",
  about: "Opening the about page.",
  contact: "Opening the contact page.",
  cart: "Opening your cart.",
  collection: "Showing the collection.",
  profile: "Opening your profile.",
  addresses: "Opening your saved addresses.",
  orders: "Opening your orders.",
  login: "Taking you to login.",
};

// Only used when the backend tool-selection call itself fails (offline/network
// error) - a lightweight, same-allowlist substitute, not a parallel system.
const NAVIGATE_PHRASES = {
  home: ["open home", "go home", "home page", "go to home", "go to homepage", "homepage", "go to the homepage"],
  about: ["open about", "about page", "go to about", "about us", "open about page", "go to about page"],
  contact: ["open contact", "contact page", "go to contact", "contact us", "support page"],
  cart: ["open cart", "show cart", "go to cart"],
  collection: ["open collection", "show collection", "show all products", "browse products", "show products", "shop now"],
  profile: ["open profile", "my profile", "profile page", "go to profile", "open my profile"],
  addresses: ["show addresses", "my addresses", "address book", "manage addresses", "view addresses", "open addresses"],
  orders: ["my orders", "show my orders", "order history", "open orders"],
  login: ["login", "log in", "sign in", "signin", "sign in to my account", "log into my account"],
};

// These phrases are guarded locally, before any AI call, because no matching
// tool exists on the backend at all - the assistant must never imply it can
// modify data or add to the cart.
const DESTRUCTIVE_PHRASES = [
  "delete product",
  "remove product",
  "erase product",
  "wipe product",
  "update product",
  "edit product",
  "modify product",
  "change product",
  "delete database",
  "change database",
  "database schema",
  "drop collection",
  "db update",
];

const CART_ACTION_PHRASES = [
  "add to cart",
  "put in cart",
  "add item to cart",
  "put product in cart",
  "add this to cart",
  "add this product to cart",
];

export default function AIAssistant() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    products,
    cartItems,
    voiceSearchFilters,
    setSearch,
    setShowSearch,
    setVoiceSort,
    setVoiceCategory,
    setVoiceSearchFilters,
    voiceProductIds,
    setVoiceProductIds,
    token,
    user,
  } = useContext(ShopContext);

  // `user` is already resolved server-side (JWT-verified /api/user/profile) -
  // only the first name is ever used here, never the full profile object.
  const firstName = user?.name?.trim().split(/\s+/)[0] || "";
  const greetingLine = firstName
    ? `Hi ${firstName}, how can I assist you?`
    : "How can I assist you?";
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(() => {
    const hasMediaDevices =
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function";

    const hasMediaRecorder = typeof window.MediaRecorder !== "undefined";

    return hasMediaDevices && hasMediaRecorder ? "idle" : "unsupported";
  });

  const [, setTranscript] = useState("");
  const [, setAiReply] = useState("");
  const [currentAction, setCurrentAction] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [, setConversationHistory] = useState([]);
  const [securityNotice, setSecurityNotice] = useState("");
  const [voiceError, setVoiceError] = useState("");

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recognitionRef = useRef(null);
  const pauseTimerRef = useRef(null);
  const listeningSessionRef = useRef(false);
  const hadSpeechRef = useRef(false);
  const voiceModeRef = useRef("recognition");

  const recordingMimeTypeRef = useRef("");
  const speechSynthesisRef = useRef(null);
  const availableVoicesRef = useRef([]);
  const memoryRef = useRef({
    lastCategory: "",
    lastColor: "",
    lastQuery: "",
    lastRecommendationQuery: "",
    lastProducts: [],
  });

  const isBraveBrowser = () =>
    Boolean(window.navigator.brave) ||
    /Brave/i.test(window.navigator.userAgent || "");

  useEffect(() => {
    return () => {
      listeningSessionRef.current = false;
      hadSpeechRef.current = false;

      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore cleanup races.
        }
      }

      const recorder = mediaRecorderRef.current;

      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }

      mediaRecorderRef.current = null;

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }

      if (speechSynthesisRef.current) {
        speechSynthesisRef.current.cancel();
      }
    };
  }, []);

  useEffect(() => {
    speechSynthesisRef.current = window.speechSynthesis || null;

    const syncVoices = () => {
      availableVoicesRef.current = window.speechSynthesis?.getVoices?.() || [];
    };

    syncVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", syncVoices);

    return () => {
      window.speechSynthesis?.removeEventListener?.(
        "voiceschanged",
        syncVoices,
      );
    };
  }, []);

  const getPreferredVoice = () => {
    const voices = availableVoicesRef.current || [];

    if (!voices.length) return null;

    const preferredNames = [
      "Google UK English Female",
      // "Google UK English Male",
      "Google US English",
      "Microsoft Aria Online (Natural) - English (United States)",
      "Microsoft Zira Online (Natural) - English (United States)",
      "Hindi (India) - Microsoft Heera Online (Natural)",
      "Samantha",
      "Victoria",
      // "Daniel",
      // "Karen",
    ];

    const voice = preferredNames
      .map((name) => voices.find((item) => item.name === name))
      .find(Boolean);

    if (voice) return voice;

    const englishVoice = voices.find((item) =>
      /en(-|_)?(IN|US|GB)?/i.test(item.lang || ""),
    );
    //Add hindi voice support
    const hindiVoice = voices.find((item) =>
      /hn(-|_)?(IN)?/i.test(item.lang || ""),
    );

    return englishVoice || hindiVoice || voices[0] || null;
  };

  const getAudioExtension = (mimeType) => {
    if (mimeType.includes("webm")) return "webm";

    if (mimeType.includes("mp4")) return "mp4";

    if (mimeType.includes("ogg")) return "ogg";

    return "webm";
  };

  const stopSpeaking = () => {
    if (speechSynthesisRef.current) {
      speechSynthesisRef.current.cancel();
    }

    setIsSpeaking(false);
  };

  const speakText = (text) => {
    if (
      !text ||
      !window.speechSynthesis ||
      typeof SpeechSynthesisUtterance === "undefined"
    ) {
      return;
    }

    stopSpeaking();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-IN";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.voice = getPreferredVoice();

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    speechSynthesisRef.current?.speak(utterance);
  };

  const clearPauseTimer = () => {
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
  };

  const schedulePauseResponse = () => {
    clearPauseTimer();
    pauseTimerRef.current = setTimeout(() => {
      if (!listeningSessionRef.current) return;
      if (!hadSpeechRef.current) return;
    }, 5000);
  };

  const resetVoiceState = () => {
    setVoiceError("");
    setSecurityNotice("");
  };

  const pushHistory = (role, content) => {
    setConversationHistory((prev) => [
      ...prev.slice(-11),
      { role, content, timestamp: Date.now() },
    ]);
  };

  const rememberSearchContext = (filters, results, query) => {
    memoryRef.current = {
      ...memoryRef.current,
      lastCategory: filters?.category || memoryRef.current.lastCategory || "",
      lastColor: filters?.color || memoryRef.current.lastColor || "",
      lastQuery: query || memoryRef.current.lastQuery || "",
      lastProducts: results || memoryRef.current.lastProducts || [],
    };
  };

  const rememberRecommendationContext = (query, picks) => {
    memoryRef.current = {
      ...memoryRef.current,
      lastRecommendationQuery:
        query || memoryRef.current.lastRecommendationQuery || "",
      lastProducts: picks || memoryRef.current.lastProducts || [],
    };
  };

  const extractSearchFilters = (text) => {
    const normalized = text.toLowerCase();
    const filters = {
      query: text.trim(),
      category: "",
      color: "",
      maxPrice: "",
    };

    const categoryMap = [
      { value: "jacket", terms: ["jacket", "jackets"] },
      { value: "hoodie", terms: ["hoodie", "hoodies"] },
      { value: "sweater", terms: ["sweater", "sweaters"] },
      { value: "shirt", terms: ["shirt", "shirts", "topwear"] },
      { value: "t-shirt", terms: ["t-shirt", "tee", "tees"] },
      {
        value: "pant",
        terms: ["pant", "pants", "trouser", "trousers", "bottomwear"],
      },
      { value: "dress", terms: ["dress", "dresses"] },
      { value: "saree", terms: ["saree", "sarees"] },
      { value: "kids", terms: ["kids", "kid"] },
    ];

    const colorMap = [
      "black",
      "white",
      "blue",
      "red",
      "green",
      "yellow",
      "pink",
      "brown",
      "grey",
      "gray",
      "beige",
      "navy",
      "maroon",
      "olive",
    ];

    const categoryHit = categoryMap.find(({ terms }) =>
      terms.some((term) => normalized.includes(term)),
    );

    if (categoryHit) {
      filters.category = categoryHit.value;
    }

    const colorHit = colorMap.find((color) => normalized.includes(color));
    if (colorHit) {
      filters.color = colorHit;
    }

    const priceMatch = normalized.match(
      /(?:under|below|less than|within)\s*(?:rs\.?|₹|rupees)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i,
    );
    if (priceMatch) {
      filters.maxPrice = Number(priceMatch[1].replace(/,/g, ""));
    }

    return filters;
  };

  const getRecommendationKeywords = (text) => {
    const normalized = text.toLowerCase();
    const keywords = [];

    const groups = [
      {
        keyword: "winter",
        terms: ["winter", "cold", "warm", "warm clothes", "winter clothes"],
      },
      {
        keyword: "office",
        terms: ["office", "work", "formal", "professional", "business"],
      },
      {
        keyword: "party",
        terms: ["party", "event", "occasion", "wedding", "festive"],
      },
      { keyword: "casual", terms: ["casual", "daily", "everyday", "regular"] },
      {
        keyword: "travel",
        terms: ["travel", "trip", "vacation", "holiday", "journey"],
      },
      {
        keyword: "sport",
        terms: ["sport", "gym", "fitness", "running", "training"],
      },
      { keyword: "comfort", terms: ["comfortable", "comfort", "soft", "easy"] },
    ];

    groups.forEach(({ keyword, terms }) => {
      if (terms.some((term) => normalized.includes(term))) {
        keywords.push(keyword);
      }
    });

    return keywords;
  };

  const scoreRecommendations = (keywords) => {
    if (!keywords.length) return [];

    const scored = products.map((product) => {
      const haystack = [
        product.name,
        product.category,
        product.subCategory,
        product.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      let score = 0;

      keywords.forEach((keyword) => {
        if (haystack.includes(keyword)) score += 3;
      });

      if (
        keywords.includes("winter") &&
        /jacket|hoodie|sweater|coat|shawl/.test(haystack)
      ) {
        score += 5;
      }

      if (
        keywords.includes("office") &&
        /shirt|trouser|pant|blazer|formal/.test(haystack)
      ) {
        score += 5;
      }

      if (
        keywords.includes("party") &&
        /dress|topwear|shirt|fashion|stylish/.test(haystack)
      ) {
        score += 4;
      }

      if (
        keywords.includes("travel") &&
        /jacket|hoodie|shirt|pant|casual/.test(haystack)
      ) {
        score += 3;
      }

      if (
        keywords.includes("sport") &&
        /t-shirt|tee|shirt|track|short|jogger/.test(haystack)
      ) {
        score += 4;
      }

      if (product.bestseller) {
        score += 2;
      }

      return { product, score };
    });

    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.product)
      .slice(0, 3);
  };

  const isRecommendationRequest = (text) => {
    const normalized = text.toLowerCase();
    return [
      "recommend",
      "suggest",
      "best for",
      "what should i wear",
      "what can you suggest",
      "need clothes for",
      "i need",
      "show me something",
      "outfit",
      "suggest me some clothes",
      "suggest me best products",
    ].some((phrase) => normalized.includes(phrase));
  };

  const detectSortIntent = (text) => {
    const normalized = text.toLowerCase().trim();

    if (
      [
        "low to high",
        "low-high",
        "sort by price",
        "cheapest",
        "price ascending",
        "sort by price low to high",
      ].some((phrase) => normalized.includes(phrase))
    ) {
      return { sortBy: "low-high" };
    }

    if (
      [
        "high to low",
        "high-low",
        "expensive",
        "price descending",
        "sort by price high to low",
        "sort products by price high to low",
        "sort products by descending price",
      ].some((phrase) => normalized.includes(phrase))
    ) {
      return { sortBy: "high-low" };
    }

    if (
      [
        "latest",
        "newest",
        "recent",
        "new arrivals",
        "sort by latest",
        "show me latest products",
        "latest products",
        "sort by newest",
      ].some((phrase) => normalized.includes(phrase))
    ) {
      return { sortBy: "newest" };
    }

    if (
      [
        "category wise",
        "sort by category",
        "category",
        "by category",
        "sort by category wise",
      ].some((phrase) => normalized.includes(phrase))
    ) {
      return { sortBy: "category" };
    }

    return null;
  };

  const findProductByQuery = (query) => {
    const normalized = (query || "").toLowerCase().trim();
    if (!normalized) return null;

    const exact = products.find(
      (product) => (product.name || "").toLowerCase() === normalized,
    );
    if (exact) return exact;

    const partial = products.find((product) =>
      (product.name || "").toLowerCase().includes(normalized),
    );
    if (partial) return partial;

    const words = normalized.split(/\s+/).filter(Boolean);
    const scored = products
      .map((product) => {
        const name = (product.name || "").toLowerCase();
        const score = words.filter((word) => name.includes(word)).length;
        return { product, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored[0]?.product || null;
  };

  // What's currently visible on the collection page, approximated the same
  // way Collection.jsx itself decides what to render: the assistant's own
  // last curated result set if one exists, else the current search filters,
  // else the general catalog. Known limitation: manual checkbox/sort
  // selections made by clicking (not by voice) aren't reflected here, since
  // that state lives locally inside the Collection component.
  const getVisibleCollectionProducts = () => {
    if (voiceProductIds?.length) {
      const byId = new Map(products.map((product) => [product._id, product]));
      return voiceProductIds.map((id) => byId.get(id)).filter(Boolean);
    }

    const filters = voiceSearchFilters || {};
    const hasFilter = Boolean(
      (filters.query || "").trim() ||
      filters.category ||
      filters.color ||
      (filters.maxPrice !== null && filters.maxPrice !== undefined && filters.maxPrice !== "")
    );

    return hasFilter ? searchProducts(products, filters) : products;
  };

  // A structured, PII-redacted snapshot of what the customer is looking at
  // right now - sent to the backend so it can resolve references like "this
  // one" or "the second one". Deliberately never includes address/phone/
  // email/payment data, even implicitly: pages that could show that (orders,
  // addresses, profile, checkout) only ever contribute their page name and
  // an open/closed flag, nothing else.
  const getUIContext = () => {
    const page = getPageForPath(location.pathname);
    const productId = page === "product" ? location.pathname.split("/product/")[1] : "";
    const selectedProduct = productId
      ? products.find((product) => product._id === productId) || null
      : null;

    let visibleProducts = [];

    if (selectedProduct) {
      visibleProducts = [selectedProduct];
    } else if (page === "collection") {
      visibleProducts = getVisibleCollectionProducts();
    } else if (page === "home") {
      const bestsellers = products.filter((product) => product.bestseller).slice(0, 5);
      const latest = products.slice().sort((a, b) => b.date - a.date).slice(0, 10);
      visibleProducts = [...bestsellers, ...latest];
    } else if (page === "cart") {
      const byId = new Map(products.map((product) => [product._id, product]));
      visibleProducts = Object.keys(cartItems || {})
        .map((id) => byId.get(id))
        .filter(Boolean);
    }

    return {
      page,
      visibleProducts: visibleProducts.slice(0, 12).map(summarizeProductForContext),
      selectedProduct: selectedProduct ? summarizeProductForContext(selectedProduct) : null,
      activeSearch: voiceSearchFilters?.query || "",
      uiOpen: {
        cart: page === "cart",
        checkout: page === "checkout",
        orders: page === "orders" || page === "track_order",
        productDetail: page === "product",
        addresses: page === "addresses",
        profile: page === "profile",
      },
    };
  };

  const isDestructiveRequest = (text) => {
    const normalized = text.toLowerCase();
    return DESTRUCTIVE_PHRASES.some((phrase) => normalized.includes(phrase));
  };

  const isCartActionRequest = (text) => {
    const normalized = text.toLowerCase();
    return CART_ACTION_PHRASES.some((phrase) => normalized.includes(phrase));
  };

  const handleRecommendationQuery = (text) => {
    const keywords = getRecommendationKeywords(text);
    const picks = scoreRecommendations(keywords);
    const responseText =
      picks.length > 0
        ? `${firstName ? `Sure, ${firstName}. ` : ""}I recommend ${picks.map((item) => item.name).join(", ")}.`
        : "I could not find a strong recommendation, so I opened the catalog.";

    setCurrentAction(
      picks.length > 0
        ? `Showing ${picks.length} recommended products`
        : "No strong recommendation match found",
    );
    setAiReply(responseText);
    speakText(responseText);
    rememberRecommendationContext(text.trim(), picks);
    setSearch("");
    setShowSearch(false);
    // So the collection page shows exactly what was announced (not the full
    // catalog), and so "the second one" resolves correctly next turn.
    setVoiceProductIds(picks.map((product) => product._id));
    navigate("/collection");
    return responseText;
  };

  // Single dispatcher for every allowlisted tool, whether it was chosen by
  // Gemini (via /api/ai/intent) or by the offline local fallback matcher.
  // `arguments` here are whatever the backend already sanitized/validated.
  const runTool = (tool, args = {}, rawText = "") => {
    setSecurityNotice("");

    switch (tool) {
      case "navigate": {
        const path = NAVIGATE_ROUTES[args.destination];
        if (!path) return "";

        setCurrentAction(`Opening ${args.destination}`);
        navigate(path);

        const spoken = NAVIGATE_SPOKEN[args.destination] || "Done.";
        setAiReply(spoken);
        speakText(spoken);
        return spoken;
      }

      case "search_products": {
        const filters = {
          query: args.query || rawText,
          category: args.category || "",
          color: args.color || "",
          maxPrice: args.maxPrice ?? "",
        };

        const matchingProducts = searchProducts(products, filters);

        setVoiceSearchFilters({
          query: filters.query,
          category: filters.category,
          color: filters.color,
          maxPrice: filters.maxPrice || null,
        });
        setVoiceProductIds(matchingProducts.map((product) => product._id));
        setSearch(filters.query);
        setShowSearch(true);
        navigate("/collection");

        const spoken =
          matchingProducts.length > 0
            ? `${firstName ? `Sure, ${firstName}. ` : ""}I found ${matchingProducts.length} matching products.`
            : "I could not find any matching products.";

        setCurrentAction(
          matchingProducts.length > 0
            ? `Showing ${matchingProducts.length} matching products`
            : "No matching products found",
        );

        setAiReply(spoken);
        rememberSearchContext(filters, matchingProducts, filters.query);
        speakText(spoken);
        return spoken;
      }

      case "recommend_products":
        return handleRecommendationQuery(args.query || rawText);

      case "sort_products": {
        const sortBy = args.sortBy || "relevant";

        if (sortBy === "category") {
          const categoryKeyword = [
            "men", "women", "kids", "jacket", "hoodie", "sweater", "shirt",
            "pants", "dress", "saree", "winterwear", "topwear", "bottomwear",
          ].find((word) => rawText.toLowerCase().includes(word));

          if (categoryKeyword) {
            setVoiceCategory(
              categoryKeyword.charAt(0).toUpperCase() + categoryKeyword.slice(1),
            );
          }

          setVoiceSort("relevant");
          navigate("/collection");

          const spoken = "Showing items by category.";
          setCurrentAction(spoken);
          setAiReply(spoken);
          speakText(spoken);
          return spoken;
        }

        setVoiceSort(sortBy);
        navigate("/collection");

        const spoken =
          sortBy === "low-high"
            ? "Sorting products from low to high price."
            : sortBy === "high-low"
              ? "Sorting products from high to low price."
              : "Showing the latest products.";

        setCurrentAction(spoken);
        setAiReply(spoken);
        speakText(spoken);
        return spoken;
      }

      case "open_product": {
        // Prefer a resolved id from the visible-products context (e.g. "the
        // second one") over a fuzzy name search, which only applies when
        // the customer named a product that isn't necessarily on screen.
        const match =
          (args.productId && products.find((product) => product._id === args.productId)) ||
          findProductByQuery(args.query || rawText);

        if (!match) {
          const spoken = `I could not find a product called "${args.query || rawText}".`;
          setCurrentAction("Product not found");
          setAiReply(spoken);
          speakText(spoken);
          return spoken;
        }

        setCurrentAction(`Opening ${match.name}`);
        navigate(`/product/${match._id}`);

        const spoken = `Opening ${match.name}.`;
        setAiReply(spoken);
        speakText(spoken);
        return spoken;
      }

      default:
        return "";
    }
  };

  // Backend/offline substitute for the AI tool call - same allowlist, no
  // network round trip. Only used when getAssistantTool() throws.
  const localFallbackTool = (text) => {
    const normalized = text.toLowerCase().trim();

    const sortIntent = detectSortIntent(normalized);
    if (sortIntent) {
      return { tool: "sort_products", arguments: sortIntent };
    }

    const navigateEntry = Object.entries(NAVIGATE_PHRASES).find(([, phrases]) =>
      phrases.some((phrase) => normalized.includes(phrase)),
    );
    if (navigateEntry) {
      return { tool: "navigate", arguments: { destination: navigateEntry[0] } };
    }

    if (isRecommendationRequest(normalized)) {
      return { tool: "recommend_products", arguments: { query: text } };
    }

    const searchTriggers = ["show me", "find", "search for", "i want", "i need", "looking for"];
    if (searchTriggers.some((phrase) => normalized.includes(phrase))) {
      return { tool: "search_products", arguments: extractSearchFilters(text) };
    }

    return null;
  };

  const startMediaRecorderSession = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    mediaStreamRef.current = stream;

    const mimeType = getSupportedMimeType();

    recordingMimeTypeRef.current = mimeType;

    const recorder = new MediaRecorder(
      stream,

      mimeType ? { mimeType } : undefined,
    );

    mediaRecorderRef.current = recorder;
    audioChunksRef.current = [];

    recorder.onstart = () => {
      setStatus("listening");
      speakText(greetingLine);
    };

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    recorder.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, {
        type: recordingMimeTypeRef.current || recorder.mimeType || "audio/webm",
      });

      audioChunksRef.current = [];

      if (!audioBlob.size) {
        setStatus("error");
        return;
      }

      try {
        setStatus("transcribing");
        let assistantResponse = "";

        const formData = new FormData();

        formData.append(
          "audio",
          audioBlob,
          `idris.${getAudioExtension(audioBlob.type)}`,
        );

        const { backendUrl, apiConfigError } = getApiConfig();

        if (!backendUrl) {
          throw new Error(apiConfigError || "Backend URL is not configured");
        }

        const response = await fetch(`${backendUrl}/api/voice/transcribe`, {
          method: "POST",
          body: formData,
        });

        const data = await response.json();

        if (!data.success) {
          throw new Error(data.message);
        }

        assistantResponse = await processVoiceText(data.transcript.trim());
        if (!assistantResponse) {
          assistantResponse = "";
        }
      } catch /*(error)*/ {
        setVoiceError(
          "I could not understand the audio or connect to voice services. You can try again.",
        );
        setStatus("error");
      }
    };

    recorder.start(250);
  };

  const processVoiceText = async (text) => {
    const normalizedText = text.trim();

    if (!normalizedText) return;

    setTranscript(normalizedText);
    pushHistory("user", normalizedText);

    // No tool exists for these on the backend at all - blocked before any
    // AI call so the assistant can never imply it performed the action.
    if (isDestructiveRequest(normalizedText)) {
      const blockedMessage =
        "I cannot perform that action. I can only help with browsing, search, recommendations, and navigation.";

      setSecurityNotice(
        "Blocked unsafe action: database/product modification is not available to the AI Assistant.",
      );
      setCurrentAction("Blocked unsafe action");
      setAiReply(blockedMessage);
      speakText(blockedMessage);
      pushHistory("assistant", blockedMessage);
      return blockedMessage;
    }

    if (isCartActionRequest(normalizedText)) {
      const message = "I cannot add items to the cart yet. Please use the Add to Cart button.";
      setCurrentAction("Cart action unsupported");
      setAiReply(message);
      speakText(message);
      pushHistory("assistant", message);
      return message;
    }

    let toolCall = null;

    try {
      toolCall = await getAssistantTool(normalizedText);
    } catch (error) {
      console.error("AI tool selection error:", error);
      // Offline/network fallback has no UI context to work with, so it
      // can't ask a clarifying question - it can only match a tool or not.
      const fallback = localFallbackTool(normalizedText);
      toolCall = fallback ? { ...fallback, reply: null } : null;
    }

    let assistantResponse = "";

    if (toolCall?.tool) {
      assistantResponse = runTool(toolCall.tool, toolCall.arguments || {}, normalizedText);
    } else if (toolCall?.reply) {
      // The model had live UI context but couldn't confidently resolve an
      // ambiguous reference (e.g. "open this") - ask the clarifying
      // question it produced instead of guessing or handing off to the
      // context-blind general chatbot.
      assistantResponse = toolCall.reply;
      setCurrentAction("Clarification requested");
      setAiReply(assistantResponse);
      speakText(assistantResponse);
    } else {
      // No tool matched and no clarification needed - general conversation,
      // hand off to the catalog-aware chatbot.
      assistantResponse = await sendTranscriptToAI(normalizedText);
    }

    pushHistory(
      "assistant",
      assistantResponse || currentAction || "Processed command",
    );

    return assistantResponse;
  };

  const ensureRecognition = () => {
    if (isBraveBrowser()) return null;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) return null;

    if (recognitionRef.current) return recognitionRef.current;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    recognition.onstart = () => {
      setStatus("listening");
    };

    recognition.onspeechstart = () => {
      if (isSpeaking) stopSpeaking();
    };

    recognition.onresult = (event) => {
      clearPauseTimer();

      let finalText = "";
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const chunk = result[0]?.transcript || "";

        if (chunk.trim()) hadSpeechRef.current = true;

        if (result.isFinal) {
          finalText += chunk;
        } else {
          interimText += chunk;
        }
      }

      const currentText = `${finalText}${interimText}`.trim();

      if (currentText) {
        if (isSpeaking) stopSpeaking();
        setTranscript(currentText);
        schedulePauseResponse();
      }

      if (finalText.trim()) {
        processVoiceText(finalText.trim());
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed") {
        setStatus("permission-denied");
        return;
      }

      if (event.error === "no-speech") {
        schedulePauseResponse();
        return;
      }

      if (voiceModeRef.current === "recognition") {
        recognition.stop();
        recognitionRef.current = null;
        voiceModeRef.current = "media";
        startMediaRecorderSession().catch(() => {
          setVoiceError(
            "Voice recognition is temporarily unavailable. Please try again.",
          );
          setStatus("error");
        });
        return;
      }

      setVoiceError(
        "Voice recognition is temporarily unavailable. Please try again.",
      );
      setStatus("error");
    };

    recognition.onend = () => {
      if (listeningSessionRef.current) {
        try {
          recognition.start();
        } catch {
          // Ignore restart races.
        }
      }
    };

    recognitionRef.current = recognition;
    return recognition;
  };

  const sendTranscriptToAI = async (text) => {
    try {
      setStatus("thinking");

      const { backendUrl, apiConfigError } = getApiConfig();

      if (!backendUrl) {
        throw new Error(apiConfigError || "Backend URL is not configured");
      }

      const response = await fetch(`${backendUrl}/api/chat`, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          ...(token ? { token } : {}),
        },

        body: JSON.stringify({
          message: text,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "AI failed");
      }

      setAiReply(data.reply);
      speakText(data.reply);

      setStatus("idle");
      return data.reply;
    } catch /*(error)*/ {
      setAiReply("Sorry, I am unable to answer right now.");
      speakText("Sorry, I am unable to answer right now.");

      setStatus("error");
      return "Sorry, I am unable to answer right now.";
    }
  };

  // Calls the backend's allowlisted tool-selection endpoint, including a
  // redacted snapshot of what's currently on screen so it can resolve
  // references like "this one". Returns { tool: null, reply } when the
  // model needs to ask a clarifying question, or { tool: null, reply: null }
  // for general conversation the chat endpoint should handle instead.
  // Throws on network/config failure so the caller can fall back to
  // localFallbackTool.
  const getAssistantTool = async (text) => {
    const { backendUrl, apiConfigError } = getApiConfig();

    if (!backendUrl) {
      throw new Error(apiConfigError || "Backend URL is not configured");
    }

    const response = await fetch(`${backendUrl}/api/ai/intent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: text,
        uiContext: getUIContext(),
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || "AI tool selection failed");
    }

    return {
      tool: data.tool || null,
      arguments: data.arguments || {},
      reply: data.reply || null,
    };
  };

  const getSupportedMimeType = () => {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return "";
  };

  const startRecording = async () => {
    try {
      resetVoiceState();
      clearPauseTimer();
      hadSpeechRef.current = false;
      voiceModeRef.current = isBraveBrowser() ? "media" : "recognition";
      setTranscript("");
      setAiReply("");

      setStatus("requesting-mic");

      const recognition =
        voiceModeRef.current === "recognition" ? ensureRecognition() : null;

      if (recognition) {
        listeningSessionRef.current = true;
        setStatus("listening");
        speakText(greetingLine);
        try {
          recognition.start();
        } catch {
          voiceModeRef.current = "media";
          await startMediaRecorderSession();
        }
        return;
      }

      await startMediaRecorderSession();
    } catch /*(error)*/ {
      setVoiceError(
        "Microphone access could not start. Please check permissions and try again.",
      );
      setStatus("permission-denied");
    }
  };

  const stopRecording = () => {
    listeningSessionRef.current = false;
    hadSpeechRef.current = false;
    clearPauseTimer();

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Ignore stop races.
      }
    }

    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    mediaRecorderRef.current = null;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());

      mediaStreamRef.current = null;
    }
  };

  const handleAssistantClick = () => {
    if (!open) {
      setOpen(true);

      setTimeout(() => {
        startRecording();
      }, 400);

      return;
    }

    stopRecording();
    stopSpeaking();

    setStatus("idle");
  };

  const closeAssistant = () => {
    stopRecording();
    stopSpeaking();

    setOpen(false);
  };

  const retryVoiceSession = () => {
    stopRecording();
    stopSpeaking();
    setStatus("idle");
    setVoiceError("");
    setTimeout(() => {
      startRecording();
    }, 250);
  };

  const getStatusText = () => {
    switch (status) {
      case "requesting-mic":
        return "Requesting microphone";

      case "listening":
        return "Listening";

      case "transcribing":
        return "Converting voice";

      case "thinking":
        return "Thinking";

      case "permission-denied":
        return "Microphone denied";

      case "error":
        return "Something went wrong";

      case "blocked":
        return "Action blocked";

      case "unsupported":
        return "Voice not supported";

      case "speaking":
        return "Speaking";

      default:
        return "Ready to talk";
    }
  };

  return (
    <>
      <style>{`

@keyframes pulse{

0%{
transform:scale(1);
opacity:.5;
}

100%{
transform:scale(1.8);
opacity:0;
}

}



@keyframes orb{

50%{
transform:scale(1.08);
}

}



.idris-ai-container{

position:fixed;

right:12px;

bottom:85px;

z-index:9999;


transition:.5s ease;

}



.idris-ai-container.open{

left:50%;

right:auto;

bottom:70px;

transform:translateX(-50%);

}




.idris-ai-button{


width:56px;

height:56px;

border-radius:50%;

border:none;

background:#1a1a1a;

display:flex;

align-items:center;

justify-content:center;

cursor:pointer;

box-shadow:
0 8px 30px rgba(0,0,0,.3);


position:relative;
z-index:10001;


}



.idris-ai-container.open
.idris-ai-button{


width:74px;

height:74px;


}



.idris-ai-container.listening
.idris-ai-button{


animation:orb 1s infinite;

}




.idris-ai-button::before{


content:"";

position:absolute;

inset:0;

border-radius:50%;

background:#b89f8a;

z-index:-1;

animation:pulse 1.5s infinite;


}




.idris-ai-orb{


width:35px;

height:35px;

border-radius:50%;


background:
radial-gradient(
circle at 30% 30%,
white,
#b89f8a,
#1a1a1a
);



}



.idris-ai-box{

  position:absolute;

  bottom:80px;

  left:50%;

  transform:translateX(-50%);

  width:min(350px,85vw);

  display:flex;

  flex-direction:column;

  gap:8px;
  pointer-events:none;
  }






.idris-ai-message{


background:white;

border:1px solid #e8e0d8;

padding:12px 15px;

border-radius:12px;

font-family:Outfit;

font-size:13px;

text-align:center;


box-shadow:
0 10px 30px rgba(0,0,0,.12);


}



.idris-ai-status{


background:#1a1a1a;

color:white;

padding:7px 14px;

border-radius:20px;

font-size:12px;

margin:auto;

font-family:Outfit;


}



@media(max-width:480px){


.idris-ai-container.open{

bottom:20px;

}



}

`}</style>

      <div className={`idris-ai-container ${open ? "open" : ""}`}>
        {open && (
          <div className="idris-ai-box">
            <div className="idris-ai-status">{getStatusText()}</div>

            {isSpeaking && (
              <div className="idris-ai-message">
                <strong>Voice:</strong>
                <br />
                Speaking out loud
              </div>
            )}

            {securityNotice && (
              <div
                className="idris-ai-message"
                style={{ borderColor: "#d39c9c", background: "#fff5f5" }}
              >
                <strong>Security:</strong>
                <br />
                {securityNotice}
              </div>
            )}

            {voiceError && (
              <div
                className="idris-ai-message"
                style={{ borderColor: "#d9c28f", background: "#fff9ef" }}
              >
                <strong>Voice:</strong>
                <br />
                {voiceError}
              </div>
            )}

            {status === "unsupported" && (
              <div
                className="idris-ai-message"
                style={{ borderColor: "#d9c28f", background: "#fff9ef" }}
              >
                <strong>Compatibility:</strong>
                <br />
                This browser does not support the full voice assistant flow.
                Please use Chrome, Edge, or Brave.
              </div>
            )}

            {(status === "error" || status === "permission-denied") && (
              <button
                type="button"
                onClick={retryVoiceSession}
                style={{
                  pointerEvents: "auto",
                  border: "none",
                  borderRadius: 999,
                  background: "#1a1a1a",
                  color: "#fff",
                  padding: "10px 14px",
                  fontSize: 12,
                  cursor: "pointer",
                  width: "fit-content",
                  margin: "0 auto",
                }}
              >
                Retry Voice
              </button>
            )}
          </div>
        )}

        <button
          className="idris-ai-button"
          onClick={open ? closeAssistant : handleAssistantClick}
        >
          {open ? (
            <span
              onClick={(e) => {
                e.stopPropagation();
                closeAssistant();
              }}
              style={{
                color: "white",
                fontSize: "28px",
                cursor: "pointer",
                zIndex: 10002,
                position: "relative",
              }}
            >
              ×
            </span>
          ) : (
            <span className="idris-ai-orb" />
          )}
        </button>
      </div>
    </>
  );
}
