import { useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getApiConfig } from "../config/api";
import { ShopContext } from "../context/ShopContext";
import { searchProducts } from "../utils/productSearch";

// A hung request (rather than a fast failure) would otherwise leave the
// assistant stuck in "thinking"/"transcribing" indefinitely.
const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

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
  checkout: "/place-order",
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
  checkout: "Opening checkout.",
};

// Cart line items are keyed by size, so "small"/"medium"/etc. need to map to
// the actual size codes the catalog uses.
const SIZE_ALIASES = {
  small: "S",
  medium: "M",
  large: "L",
  "extra large": "XL",
  "extra extra large": "XXL",
  "double extra large": "XXL",
};

// Only used when the backend tool-selection call itself fails (offline/network
// error) - a lightweight, same-allowlist substitute, not a parallel system.
const NAVIGATE_PHRASES = {
  home: [
    "open home",
    "go home",
    "home page",
    "go to home",
    "go to homepage",
    "homepage",
    "go to the homepage",
  ],
  about: [
    "open about",
    "about page",
    "go to about",
    "about us",
    "open about page",
    "go to about page",
  ],
  contact: [
    "open contact",
    "contact page",
    "go to contact",
    "contact us",
    "support page",
  ],
  cart: ["open cart", "show cart", "go to cart"],
  collection: [
    "open collection",
    "show collection",
    "show all products",
    "browse products",
    "show products",
    "shop now",
  ],
  profile: [
    "open profile",
    "my profile",
    "profile page",
    "go to profile",
    "open my profile",
  ],
  addresses: [
    "show addresses",
    "my addresses",
    "address book",
    "manage addresses",
    "view addresses",
    "open addresses",
  ],
  orders: ["my orders", "show my orders", "order history", "open orders"],
  login: [
    "login",
    "log in",
    "sign in",
    "signin",
    "sign in to my account",
    "log into my account",
  ],
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

export default function AIAssistant() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    products,
    cartItems,
    setCartItemQuantity,
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
    orders,
    addresses,
    placeOrder,
    cancelOrder,
    currency,
    delivery_fee,
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
  // Teardown for the MediaRecorder-path voice activity monitor (see
  // startVoiceActivityMonitor) - that path has no native "user started
  // talking" event the way SpeechRecognition does, so barge-in there needs
  // its own lightweight mic-level watcher.
  const vadCleanupRef = useRef(null);
  const recognitionRef = useRef(null);
  const pauseTimerRef = useRef(null);
  const listeningSessionRef = useRef(false);
  const hadSpeechRef = useRef(false);
  const voiceModeRef = useRef("recognition");

  const recordingMimeTypeRef = useRef("");
  const speechSynthesisRef = useRef(null);
  const availableVoicesRef = useRef([]);
  // Streamed neural-voice playback state (backend /api/voice/speak, PCM over
  // Web Audio API). liveNextStartTimeRef is the scheduling cursor so
  // sequential chunks play back-to-back with no gap and no overlap.
  const liveAudioContextRef = useRef(null);
  const liveNextStartTimeRef = useRef(0);
  const livePendingSourcesRef = useRef([]);
  const liveAbortControllerRef = useRef(null);
  // Bumped on every stopSpeaking()/speakText() call so a stream that's still
  // arriving after being superseded (stopped, or replaced by a newer
  // utterance) knows to stop scheduling further audio.
  const liveGenerationRef = useRef(0);
  const memoryRef = useRef({
    lastCategory: "",
    lastColor: "",
    lastQuery: "",
    lastRecommendationQuery: "",
    lastProducts: [],
    // Rolling log of what the customer has searched for/done this session
    // (most recent last), sent to /api/ai/intent on every turn so the model
    // can resolve follow-ups like "cheaper ones than that" or "add the one
    // I looked at earlier" - things the current on-screen UI context alone
    // wouldn't capture. Session-only: reset on reload/tab close, not stored
    // anywhere, not tied to the account.
    activityLog: [],
  });

  // Multi-turn slot-filling / confirm-before-acting state. Two shapes:
  // { type: "add_to_cart_size", productId, quantity } while waiting for a
  // size answer, or { type: "confirm", question, declineMessage, onConfirm }
  // while waiting for yes/no before an irreversible action (place/cancel
  // order) actually runs. Checked at the top of every new utterance.
  const pendingActionRef = useRef(null);
  // Idempotency guard: a confirmed place/cancel order is cleared from
  // pendingActionRef synchronously before the async call starts, so a
  // duplicate "yes" arriving while it's still in flight can't double-submit.
  const isProcessingActionRef = useRef(false);

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

      vadCleanupRef.current?.();
      vadCleanupRef.current = null;

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }

      if (speechSynthesisRef.current) {
        speechSynthesisRef.current.cancel();
      }

      liveAbortControllerRef.current?.abort();
      livePendingSourcesRef.current.forEach((source) => {
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
      });
      liveAudioContextRef.current?.close().catch(() => {});
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

  // Devanagari block - reliably distinguishes actual Hindi script from
  // English/Hinglish (Hindi typed in Latin letters, which no separate voice
  // can pronounce any better than English can, so it's treated as English).
  const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;

  const detectSpeechLang = (text) =>
    DEVANAGARI_PATTERN.test(text || "") ? "hi-IN" : "en-IN";

  const getPreferredVoice = (targetLang = "en-IN") => {
    const voices = availableVoicesRef.current || [];

    if (!voices.length) return null;

    const wantsHindi = targetLang === "hi-IN";

    // Exact voice names vary wildly by browser/OS, so an exact-name allowlist
    // (the old approach) very often matches nothing and silently falls back
    // to whatever voice is first - frequently male, robotic, or (worse for
    // Hindi replies) the wrong language entirely, which is what made Hindi
    // sound so unnatural: an English voice reading Devanagari text. This
    // instead scores every voice the device actually offers and picks the
    // best match: the right language first, then a name that reads as
    // female, then (when the browser exposes it) a higher-quality
    // "natural"/"neural"/"online" voice.
    const FEMALE_NAME_HINTS =
      /female|zira|aria|samantha|victoria|karen|susan|moira|tessa|fiona|kate|serena|allison|ava|salli|joanna|kimberly|kendra|ivy|heera|lekha|veena|amelie|anna|paulina|kyoko|zoe|emma|sara|nicky/i;
    const MALE_NAME_HINTS =
      /male|daniel|david|mark|alex(?!a)|fred|tom|george|james|ryan|matthew|guy|arthur|eric|brian|ravi|hemant/i;
    const NATURAL_QUALITY_HINTS = /natural|neural|online|premium/i;

    const scoreVoice = (voice) => {
      const name = voice.name || "";
      const lang = voice.lang || "";
      let score = 0;

      const isHindiVoice = /^hi(-|_)?(IN)?/i.test(lang);
      const isEnglishVoice = /^en(-|_)?(IN|US|GB|AU)?/i.test(lang);

      if (wantsHindi ? isHindiVoice : isEnglishVoice) score += 6;
      else if (isHindiVoice || isEnglishVoice) score += 1;

      if (NATURAL_QUALITY_HINTS.test(name)) score += 2;
      if (voice.localService === false) score += 1;

      if (FEMALE_NAME_HINTS.test(name)) score += 5;
      else if (MALE_NAME_HINTS.test(name)) score -= 5;

      return score;
    };

    return [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0] || null;
  };

  const getAudioExtension = (mimeType) => {
    if (mimeType.includes("webm")) return "webm";

    if (mimeType.includes("mp4")) return "mp4";

    if (mimeType.includes("ogg")) return "ogg";

    return "webm";
  };

  // MediaRecorder (the Brave/fallback voice path) has no equivalent of
  // SpeechRecognition's onspeechstart event, so barge-in there needs its own
  // watcher: a lightweight, separate analyser tap on the same mic stream
  // that just watches volume and cuts the assistant off the instant the
  // visitor starts talking, independent of the actual recording/transcript
  // pipeline. Returns a cleanup function.
  const startVoiceActivityMonitor = (stream) => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (typeof AudioContextClass === "undefined") return () => {};

    let audioContext;
    try {
      audioContext = new AudioContextClass();
    } catch {
      return () => {};
    }

    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    const VOLUME_THRESHOLD = 0.035;
    let rafId = null;
    let stopped = false;

    const tick = () => {
      if (stopped) return;

      analyser.getByteTimeDomainData(buffer);

      let sumSquares = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const normalized = (buffer[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }

      if (Math.sqrt(sumSquares / buffer.length) > VOLUME_THRESHOLD) {
        stopSpeaking();
      }

      rafId = requestAnimationFrame(tick);
    };

    tick();

    return () => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      try {
        source.disconnect();
      } catch {
        // Already disconnected.
      }
      audioContext.close().catch(() => {});
    };
  };

  const SPEECH_SAMPLE_RATE = 24000;

  const stopSpeaking = () => {
    // Invalidate any in-flight/streaming speech so late-arriving chunks or
    // events from a superseded request can't start/continue audio.
    liveGenerationRef.current += 1;

    if (speechSynthesisRef.current) {
      speechSynthesisRef.current.cancel();
    }

    liveAbortControllerRef.current?.abort();
    liveAbortControllerRef.current = null;

    livePendingSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Already stopped/ended.
      }
    });
    livePendingSourcesRef.current = [];

    if (liveAudioContextRef.current) {
      liveAudioContextRef.current.close().catch(() => {});
      liveAudioContextRef.current = null;
    }

    liveNextStartTimeRef.current = 0;

    setIsSpeaking(false);
  };

  // Fallback path only: used when the streamed neural voice can't be reached
  // (offline, backend error, browser lacks Web Audio API) - so the assistant
  // degrades to the device's own voice instead of going silent.
  const speakWithBrowserVoice = (text, speechLang) => {
    if (
      !window.speechSynthesis ||
      typeof SpeechSynthesisUtterance === "undefined"
    ) {
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLang;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.voice = getPreferredVoice(speechLang);

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    speechSynthesisRef.current?.speak(utterance);
  };

  // Schedules one raw PCM chunk to play immediately after whatever was
  // scheduled before it (liveNextStartTimeRef is the running cursor), so
  // chunks arriving over time from the stream play back gaplessly as one
  // continuous voice instead of stuttering per-chunk.
  const playPcmChunk = (audioContext, bytes, generation) => {
    if (generation !== liveGenerationRef.current) return;

    const sampleCount = Math.floor(bytes.length / 2);
    if (sampleCount <= 0) return;

    const audioBuffer = audioContext.createBuffer(
      1,
      sampleCount,
      SPEECH_SAMPLE_RATE,
    );
    const channelData = audioBuffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    for (let i = 0; i < sampleCount; i += 1) {
      channelData[i] = view.getInt16(i * 2, true) / 32768;
    }

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);

    const startAt = Math.max(
      liveNextStartTimeRef.current,
      audioContext.currentTime,
    );
    source.start(startAt);
    liveNextStartTimeRef.current = startAt + audioBuffer.duration;

    livePendingSourcesRef.current.push(source);
    source.onended = () => {
      livePendingSourcesRef.current = livePendingSourcesRef.current.filter(
        (item) => item !== source,
      );
      if (
        generation === liveGenerationRef.current &&
        livePendingSourcesRef.current.length === 0
      ) {
        setIsSpeaking(false);
      }
    };
  };

  // Primary voice path: a realistic neural female voice, streamed from the
  // backend (Gemini Live) as raw PCM and played incrementally via the Web
  // Audio API as chunks arrive - measured at ~1.2-1.6s to first audio versus
  // 4-6s for a non-streaming request, and (being one multilingual model
  // rather than a locale-picked browser voice) pronounces Hindi and Hinglish
  // naturally instead of reading them through an English voice.
  const speakText = async (text) => {
    if (!text) return;

    stopSpeaking();
    const generation = liveGenerationRef.current;

    const speechLang = detectSpeechLang(text);
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const { backendUrl } = getApiConfig();

    if (!backendUrl || typeof AudioContextClass === "undefined") {
      speakWithBrowserVoice(text, speechLang);
      return;
    }

    const controller = new AbortController();
    liveAbortControllerRef.current = controller;
    const safetyTimeout = setTimeout(() => controller.abort(), 25000);

    try {
      const response = await fetch(`${backendUrl}/api/voice/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (generation !== liveGenerationRef.current) return;
      if (!response.ok || !response.body) {
        throw new Error("Speech stream request failed");
      }

      const audioContext = new AudioContextClass({
        sampleRate: SPEECH_SAMPLE_RATE,
      });
      liveAudioContextRef.current = audioContext;
      liveNextStartTimeRef.current = 0;
      if (audioContext.resume) {
        await audioContext.resume().catch(() => {});
      }

      const reader = response.body.getReader();
      let pendingByte = null;
      let receivedAny = false;

      for (;;) {
        const { done, value } = await reader.read();

        if (generation !== liveGenerationRef.current) {
          reader.cancel().catch(() => {});
          return;
        }

        if (done) break;
        if (!value || value.length === 0) continue;

        let bytes = value;

        if (pendingByte !== null) {
          const merged = new Uint8Array(bytes.length + 1);
          merged[0] = pendingByte;
          merged.set(bytes, 1);
          bytes = merged;
          pendingByte = null;
        }

        if (bytes.length % 2 !== 0) {
          pendingByte = bytes[bytes.length - 1];
          bytes = bytes.slice(0, -1);
        }

        if (bytes.length === 0) continue;

        if (!receivedAny) {
          receivedAny = true;
          setIsSpeaking(true);
        }

        playPcmChunk(audioContext, bytes, generation);
      }

      if (!receivedAny && generation === liveGenerationRef.current) {
        throw new Error("No audio received");
      }
    } catch (error) {
      if (generation !== liveGenerationRef.current) return;
      console.error(
        "Streamed voice failed, falling back to browser voice:",
        error,
      );
      speakWithBrowserVoice(text, speechLang);
    } finally {
      clearTimeout(safetyTimeout);
      if (liveAbortControllerRef.current === controller) {
        liveAbortControllerRef.current = null;
      }
    }
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

  const MAX_ACTIVITY_LOG = 8;

  const recordActivity = (summary) => {
    if (!summary) return;

    memoryRef.current = {
      ...memoryRef.current,
      activityLog: [...memoryRef.current.activityLog, summary].slice(
        -MAX_ACTIVITY_LOG,
      ),
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
      (filters.maxPrice !== null &&
        filters.maxPrice !== undefined &&
        filters.maxPrice !== ""),
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
    const productId =
      page === "product" ? location.pathname.split("/product/")[1] : "";
    const selectedProduct = productId
      ? products.find((product) => product._id === productId) || null
      : null;

    let visibleProducts = [];

    if (selectedProduct) {
      visibleProducts = [selectedProduct];
    } else if (page === "collection") {
      visibleProducts = getVisibleCollectionProducts();
    } else if (page === "home") {
      const bestsellers = products
        .filter((product) => product.bestseller)
        .slice(0, 5);
      const latest = products
        .slice()
        .sort((a, b) => b.date - a.date)
        .slice(0, 10);
      visibleProducts = [...bestsellers, ...latest];
    } else if (page === "cart") {
      const byId = new Map(products.map((product) => [product._id, product]));
      visibleProducts = Object.keys(cartItems || {})
        .map((id) => byId.get(id))
        .filter(Boolean);
    }

    // Cart/order state is the customer's own data, not page-specific - kept
    // available regardless of what page they're on so "remove the jacket
    // from my cart" works while browsing, not just on the cart page itself.
    const byId = new Map(products.map((product) => [product._id, product]));
    const cartLines = [];
    Object.entries(cartItems || {}).forEach(([productId, sizes]) => {
      const product = byId.get(productId);
      if (!product) return;

      Object.entries(sizes || {}).forEach(([size, quantity]) => {
        if (quantity > 0) {
          cartLines.push({
            productId,
            name: product.name,
            size,
            quantity,
            price: product.price,
          });
        }
      });
    });

    const recentOrders = (orders || []).slice(0, 5).map((order) => ({
      id: order._id,
      status: order.status,
      itemNames: (order.items || []).map((item) => item.name),
      date: order.date,
    }));

    return {
      page,
      visibleProducts: visibleProducts
        .slice(0, 12)
        .map(summarizeProductForContext),
      selectedProduct: selectedProduct
        ? summarizeProductForContext(selectedProduct)
        : null,
      activeSearch: voiceSearchFilters?.query || "",
      cartLines: cartLines.slice(0, 20),
      recentOrders,
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

  // Deterministic yes/no parsing for confirm-before-acting flows (place
  // order, cancel order) - never trusts the AI's own judgment about whether
  // consent was given, only a literal reading of the next utterance.
  const parseYesNo = (text) => {
    const normalized = text.toLowerCase().trim();
    if (
      /^(yes|yeah|yep|yup|sure|confirm|confirmed|go ahead|do it|okay|ok|please do|correct)\b/.test(
        normalized,
      )
    ) {
      return "yes";
    }
    if (/^(no|nope|nah|cancel|never\s?mind|stop|don'?t)\b/.test(normalized)) {
      return "no";
    }
    return null;
  };

  const parseSizeAnswer = (text, availableSizes) => {
    const normalized = text.toLowerCase().trim();

    if (/\b(cancel|never\s?mind|forget it|stop|no)\b/.test(normalized)) {
      return { cancel: true };
    }

    if (
      /\b(any size|any|you (choose|pick|decide)|whatever|doesn'?t matter|surprise me)\b/.test(
        normalized,
      )
    ) {
      return { autoSelect: true };
    }

    const directHit = availableSizes.find(
      (size) =>
        normalized === size.toLowerCase() ||
        normalized.includes(size.toLowerCase()),
    );
    if (directHit) return { size: directHit };

    const aliasEntry = Object.entries(SIZE_ALIASES).find(([phrase]) =>
      normalized.includes(phrase),
    );
    if (aliasEntry) {
      const mapped = availableSizes.find(
        (size) => size.toLowerCase() === aliasEntry[1].toLowerCase(),
      );
      if (mapped) return { size: mapped };
    }

    return null;
  };

  // Finds the product a cart/order-adjacent tool call is referring to,
  // preferring a resolved id from context over a fuzzy name search.
  const resolveProductFromArgs = (args, rawText) =>
    (args.productId &&
      products.find((product) => product._id === args.productId)) ||
    findProductByQuery(args.query || rawText);

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

  // Finishes an add-to-cart once a size is known (either given directly,
  // auto-selected with permission, or answered in the size slot-filling
  // follow-up). Always tells the customer which size was used.
  const completeAddToCart = (productId, size, quantity, autoSelected) => {
    const product = products.find((item) => item._id === productId);

    if (!product) {
      const spoken = "I could not find that product anymore.";
      setAiReply(spoken);
      speakText(spoken);
      return spoken;
    }

    const availableSizes = product.sizes || product.size || [];
    const resolvedSize =
      size || (availableSizes.length ? availableSizes[0] : "");
    const currentQuantity = cartItems?.[productId]?.[resolvedSize] || 0;

    setCartItemQuantity(
      productId,
      resolvedSize,
      currentQuantity + (quantity || 1),
    );

    const spoken = autoSelected
      ? `I added ${product.name} in size ${resolvedSize} to your cart, since any size works for you.`
      : `I added ${product.name}${resolvedSize ? ` (size ${resolvedSize})` : ""} to your cart.`;

    setCurrentAction(`Added ${product.name} to cart`);
    setAiReply(spoken);
    speakText(spoken);
    return spoken;
  };

  // Never places an order immediately - computes a confirmation summary
  // (using only the address label, never full address/phone/email) and
  // waits for an explicit yes on the next turn. The address itself is read
  // from context here, in plain JS, and never passed through the AI model.
  const beginPlaceOrder = () => {
    const cartEntries = Object.entries(cartItems || {});

    if (!cartEntries.length) {
      const spoken = "Your cart is empty, so there is nothing to order.";
      setAiReply(spoken);
      speakText(spoken);
      return spoken;
    }

    const orderItems = [];
    cartEntries.forEach(([productId, sizes]) => {
      const product = products.find((item) => item._id === productId);
      if (!product) return;

      Object.entries(sizes || {}).forEach(([size, quantity]) => {
        if (quantity > 0) {
          orderItems.push({
            productId,
            name: product.name,
            price: product.price,
            image: product.image?.[0],
            size,
            quantity,
          });
        }
      });
    });

    if (!orderItems.length) {
      const spoken = "Your cart is empty, so there is nothing to order.";
      setAiReply(spoken);
      speakText(spoken);
      return spoken;
    }

    const defaultAddress =
      addresses.find((item) => item.isDefault) || addresses[0];

    if (!defaultAddress) {
      const spoken =
        "You do not have a saved address yet. Let's go to checkout so you can add one.";
      setAiReply(spoken);
      speakText(spoken);
      navigate("/place-order");
      return spoken;
    }

    const subtotal = orderItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    const amount = subtotal + delivery_fee;
    const itemCount = orderItems.reduce((sum, item) => sum + item.quantity, 0);

    const question = `I'll place a Cash on Delivery order for ${itemCount} item${itemCount > 1 ? "s" : ""}, total ${currency}${amount}, delivered to your ${defaultAddress.label || "default"} address. Should I go ahead? Voice ordering only supports Cash on Delivery - for card or UPI payment, please use checkout directly.`;

    pendingActionRef.current = {
      type: "confirm",
      question,
      declineMessage: "Okay, I won't place the order.",
      onConfirm: async () => {
        try {
          const response = await placeOrder({
            items: orderItems,
            amount,
            address: { ...defaultAddress, addressId: defaultAddress._id },
            paymentMethod: "COD",
            source: "assistant",
          });

          if (response.success) {
            navigate("/orders");
            const spoken = `Your order has been placed. Total ${currency}${amount}.`;
            setCurrentAction("Order placed");
            setAiReply(spoken);
            speakText(spoken);
            return spoken;
          }

          const spoken =
            response.message ||
            "I could not place your order. Please try again from checkout.";
          setCurrentAction("Order placement failed");
          setAiReply(spoken);
          speakText(spoken);
          return spoken;
        } catch (error) {
          console.error("Voice place order error:", error);
          const spoken =
            "Something went wrong placing your order. Please try again from checkout.";
          setAiReply(spoken);
          speakText(spoken);
          return spoken;
        }
      },
    };

    setCurrentAction("Awaiting order confirmation");
    setAiReply(question);
    speakText(question);
    return question;
  };

  // Same confirm-then-execute pattern as beginPlaceOrder. cancelOrder()
  // is the exact same context function the manual "Cancel Order" button
  // uses, so the backend's own ownership/eligibility checks apply
  // unchanged regardless of what this client-side pre-check found.
  const beginCancelOrder = (orderId) => {
    const cancellableStatuses = ["Order Placed", "Packing"];
    const order =
      orders.find((item) => item._id === orderId) ||
      (orders.length === 1 ? orders[0] : null);

    if (!order) {
      const spoken =
        "I could not find that order. Please check your orders page.";
      setAiReply(spoken);
      speakText(spoken);
      return spoken;
    }

    if (!cancellableStatuses.includes(order.status)) {
      const spoken = `Your order from ${new Date(order.date).toDateString()} is already ${order.status.toLowerCase()} and can no longer be cancelled online. Please contact support.`;
      setAiReply(spoken);
      speakText(spoken);
      return spoken;
    }

    const itemSummary = (order.items || []).map((item) => item.name).join(", ");
    const question = `This will cancel your order (${itemSummary}) placed on ${new Date(order.date).toDateString()}. Should I go ahead?`;

    pendingActionRef.current = {
      type: "confirm",
      question,
      declineMessage: "Okay, I won't cancel that order.",
      onConfirm: async () => {
        try {
          const response = await cancelOrder(
            order._id,
            "Cancelled by customer",
            "assistant",
          );

          const spoken = response.success
            ? response.message || "Your order has been cancelled."
            : response.message ||
              "I could not cancel that order. Please try again from your orders page.";

          setCurrentAction(
            response.success ? "Order cancelled" : "Cancel failed",
          );
          setAiReply(spoken);
          speakText(spoken);
          return spoken;
        } catch (error) {
          console.error("Voice cancel order error:", error);
          const spoken =
            "Something went wrong cancelling your order. Please try again from your orders page.";
          setAiReply(spoken);
          speakText(spoken);
          return spoken;
        }
      },
    };

    setCurrentAction("Awaiting cancellation confirmation");
    setAiReply(question);
    speakText(question);
    return question;
  };

  // Single dispatcher for every allowlisted tool, whether it was chosen by
  // Gemini (via /api/ai/intent) or by the offline local fallback matcher.
  // `arguments` here are whatever the backend already sanitized/validated.
  // Every tool call's spoken confirmation already doubles as a good,
  // human-readable summary of what happened - this is the single choke
  // point all tool executions pass through, so it's also where the session
  // activity log is built for recentActivity (see getAssistantTool).
  const runTool = (tool, args = {}, rawText = "") => {
    const spoken = runToolInner(tool, args, rawText);
    recordActivity(spoken);
    return spoken;
  };

  const runToolInner = (tool, args = {}, rawText = "") => {
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
            "men",
            "women",
            "kids",
            "jacket",
            "hoodie",
            "sweater",
            "shirt",
            "pants",
            "dress",
            "saree",
            "winterwear",
            "topwear",
            "bottomwear",
          ].find((word) => rawText.toLowerCase().includes(word));

          if (categoryKeyword) {
            setVoiceCategory(
              categoryKeyword.charAt(0).toUpperCase() +
                categoryKeyword.slice(1),
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
        const match = resolveProductFromArgs(args, rawText);

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

      case "add_to_cart": {
        const product = resolveProductFromArgs(args, rawText);

        if (!product) {
          const spoken = "I could not find that product to add to your cart.";
          setAiReply(spoken);
          speakText(spoken);
          return spoken;
        }

        const availableSizes = product.sizes || product.size || [];
        const requestedSize = (args.size || "").trim();

        if (requestedSize) {
          const matchedSize = availableSizes.find(
            (size) => size.toLowerCase() === requestedSize.toLowerCase(),
          );

          if (!matchedSize) {
            const spoken = `Size ${requestedSize} is not available for ${product.name}. Available sizes: ${availableSizes.join(", ") || "none"}.`;
            setCurrentAction("Requested size unavailable");
            setAiReply(spoken);
            speakText(spoken);
            return spoken;
          }

          return completeAddToCart(
            product._id,
            matchedSize,
            args.quantity || 1,
            false,
          );
        }

        if (args.autoSelectSize || availableSizes.length === 0) {
          return completeAddToCart(
            product._id,
            null,
            args.quantity || 1,
            Boolean(args.autoSelectSize),
          );
        }

        // Size required but neither given nor auto-select authorized - ask,
        // and wait for the answer instead of guessing.
        const question = `What size would you like for ${product.name}? Available sizes: ${availableSizes.join(", ")}. Or say "any size".`;
        pendingActionRef.current = {
          type: "add_to_cart_size",
          productId: product._id,
          quantity: args.quantity || 1,
        };
        setCurrentAction("Awaiting size selection");
        setAiReply(question);
        speakText(question);
        return question;
      }

      case "update_cart_quantity": {
        const product = resolveProductFromArgs(args, rawText);

        if (!product) {
          const spoken = "I could not find that item in your cart.";
          setAiReply(spoken);
          speakText(spoken);
          return spoken;
        }

        const cartForProduct = cartItems?.[product._id] || {};
        const size = args.size || Object.keys(cartForProduct)[0] || "";

        if (!size || !(size in cartForProduct)) {
          const spoken = `I could not find ${product.name}${args.size ? ` in size ${args.size}` : ""} in your cart.`;
          setAiReply(spoken);
          speakText(spoken);
          return spoken;
        }

        const targetQuantity = Math.max(
          0,
          Math.round(Number(args.quantity) || 0),
        );
        setCartItemQuantity(product._id, size, targetQuantity);

        const spoken =
          targetQuantity > 0
            ? `Updated ${product.name} (size ${size}) to ${targetQuantity}.`
            : `Removed ${product.name} (size ${size}) from your cart.`;

        setCurrentAction(spoken);
        setAiReply(spoken);
        speakText(spoken);
        return spoken;
      }

      case "remove_from_cart": {
        const product = resolveProductFromArgs(args, rawText);

        if (!product) {
          const spoken = "I could not find that item in your cart.";
          setAiReply(spoken);
          speakText(spoken);
          return spoken;
        }

        const cartForProduct = cartItems?.[product._id] || {};
        const sizesInCart = Object.keys(cartForProduct);

        if (sizesInCart.length === 0) {
          const spoken = `${product.name} is not in your cart.`;
          setAiReply(spoken);
          speakText(spoken);
          return spoken;
        }

        const targetSizes = args.size
          ? sizesInCart.filter(
              (size) => size.toLowerCase() === args.size.toLowerCase(),
            )
          : sizesInCart;

        if (targetSizes.length === 0) {
          const spoken = `${product.name} in size ${args.size} is not in your cart.`;
          setAiReply(spoken);
          speakText(spoken);
          return spoken;
        }

        targetSizes.forEach((size) =>
          setCartItemQuantity(product._id, size, 0),
        );

        const spoken = `Removed ${product.name}${args.size ? ` (size ${args.size})` : ""} from your cart.`;
        setCurrentAction(spoken);
        setAiReply(spoken);
        speakText(spoken);
        return spoken;
      }

      case "place_order":
        return beginPlaceOrder();

      case "cancel_order":
        return beginCancelOrder(args.orderId);

      case "track_order": {
        const order = args.orderId
          ? orders.find((item) => item._id === args.orderId)
          : orders.length === 1
            ? orders[0]
            : null;

        if (!order) {
          if (!orders.length) {
            const spoken = "You do not have any orders yet.";
            setAiReply(spoken);
            speakText(spoken);
            return spoken;
          }

          const spoken =
            "You have multiple orders. Please open your orders page to pick one, or tell me the product it was for.";
          setAiReply(spoken);
          speakText(spoken);
          navigate("/orders");
          return spoken;
        }

        navigate(`/track/${order._id}`);

        const itemNames = (order.items || [])
          .map((item) => item.name)
          .join(", ");
        const spoken = `Your order (${itemNames}) is currently ${order.status}${order.estimatedDelivery ? `, expected by ${order.estimatedDelivery}` : ""}.`;
        setCurrentAction("Showing order tracking");
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

    const searchTriggers = [
      "show me",
      "find",
      "search for",
      "i want",
      "i need",
      "looking for",
    ];
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
    vadCleanupRef.current?.();
    vadCleanupRef.current = startVoiceActivityMonitor(stream);

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

        const response = await fetchWithTimeout(
          `${backendUrl}/api/voice/transcribe`,
          {
            method: "POST",
            body: formData,
          },
          30000,
        );

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

    // If the previous turn was the assistant asking a clarifying question
    // (ambiguous reference - "add the second one" with several products on
    // screen), carry that exchange into this call so the model resolves the
    // follow-up answer in context instead of treating it as a brand new,
    // unrelated utterance. Populated below, consumed by getAssistantTool().
    let clarificationHistory = null;

    // A previous turn is waiting on this exact utterance (a size choice, or
    // a yes/no before an irreversible action runs) - handle it first,
    // deterministically, without going through the AI again.
    if (pendingActionRef.current) {
      const pending = pendingActionRef.current;

      if (pending.type === "clarification") {
        pendingActionRef.current = null;
        clarificationHistory = pending.history;
        // Falls through to the normal tool-call flow below, now carrying
        // history - still passes through the destructive-phrase guard and
        // local fallback like any other utterance.
      } else if (pending.type === "add_to_cart_size") {
        const product = products.find((item) => item._id === pending.productId);
        const availableSizes = product?.sizes || product?.size || [];
        const parsed = parseSizeAnswer(normalizedText, availableSizes);

        pendingActionRef.current = null;

        if (parsed?.cancel) {
          const spoken = "Okay, I won't add that to your cart.";
          setAiReply(spoken);
          speakText(spoken);
          pushHistory("assistant", spoken);
          return spoken;
        }

        if (parsed?.size || parsed?.autoSelect) {
          const spoken = completeAddToCart(
            pending.productId,
            parsed.size || null,
            pending.quantity,
            Boolean(parsed.autoSelect),
          );
          pushHistory("assistant", spoken);
          return spoken;
        }

        // Didn't parse as a size answer - drop the pending state and fall
        // through to treat this as a new, unrelated utterance.
      } else if (pending.type === "confirm" && !isProcessingActionRef.current) {
        const answer = parseYesNo(normalizedText);

        if (answer === "yes") {
          pendingActionRef.current = null;
          isProcessingActionRef.current = true;

          try {
            const spoken = await pending.onConfirm();
            pushHistory("assistant", spoken);
            return spoken;
          } finally {
            isProcessingActionRef.current = false;
          }
        }

        if (answer === "no") {
          pendingActionRef.current = null;
          const spoken = pending.declineMessage || "Okay, I won't do that.";
          setAiReply(spoken);
          speakText(spoken);
          pushHistory("assistant", spoken);
          return spoken;
        }

        // Unclear answer - ask again rather than silently dropping a
        // pending order/cancellation, but keep waiting only for this.
        speakText(pending.question);
        setAiReply(pending.question);
        pushHistory("assistant", pending.question);
        return pending.question;
      }
    }

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

    let toolCall = null;

    try {
      toolCall = await getAssistantTool(
        normalizedText,
        clarificationHistory || [],
      );
    } catch (error) {
      console.error("AI tool selection error:", error);
      // Offline/network fallback has no UI context to work with, so it
      // can't ask a clarifying question - it can only match a tool or not.
      const fallback = localFallbackTool(normalizedText);
      toolCall = fallback ? { ...fallback, reply: null } : null;
    }

    let assistantResponse = "";

    if (toolCall?.tool) {
      assistantResponse = runTool(
        toolCall.tool,
        toolCall.arguments || {},
        normalizedText,
      );
    } else if (toolCall?.reply) {
      // The model had live UI context but couldn't confidently resolve an
      // ambiguous reference (e.g. "open this") - ask the clarifying
      // question it produced instead of guessing or handing off to the
      // context-blind general chatbot. Remember the exchange so the next
      // utterance is understood as the answer to this exact question.
      assistantResponse = toolCall.reply;
      setCurrentAction("Clarification requested");
      setAiReply(assistantResponse);
      speakText(assistantResponse);
      pendingActionRef.current = {
        type: "clarification",
        history: [
          ...(clarificationHistory || []),
          { role: "user", content: normalizedText },
          { role: "assistant", content: assistantResponse },
        ].slice(-6),
      };
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

    // Barge-in: cut the assistant off the instant the user starts talking,
    // even mid-sentence. This is unconditional (not gated on an `isSpeaking`
    // check) deliberately - `ensureRecognition()` only ever runs once and
    // caches the recognition object, so a closure here over the `isSpeaking`
    // state variable would freeze at whatever it was when recognition was
    // first created (effectively always false) and never fire again.
    // stopSpeaking() is a safe no-op when nothing is currently playing.
    recognition.onspeechstart = () => {
      stopSpeaking();
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
        stopSpeaking();
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

      const response = await fetchWithTimeout(
        `${backendUrl}/api/chat`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            ...(token ? { token } : {}),
          },

          body: JSON.stringify({
            message: text,
          }),
        },
        20000,
      );

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
  // `history` carries the prior ambiguous request + clarifying question when
  // this call is answering one (see pendingActionRef "clarification" in
  // processVoiceText) so the model can resolve the follow-up in context
  // instead of seeing it as a brand new, unrelated utterance. recentActivity
  // is the session's rolling log of past searches/commands (memoryRef),
  // always sent, so the model can resolve follow-ups that reference
  // something earlier in the conversation even when it's no longer what's
  // on screen (e.g. "cheaper ones than what I searched before").
  // Throws on network/config failure so the caller can fall back to
  // localFallbackTool.
  const getAssistantTool = async (text, history = []) => {
    const { backendUrl, apiConfigError } = getApiConfig();

    if (!backendUrl) {
      throw new Error(apiConfigError || "Backend URL is not configured");
    }

    const response = await fetchWithTimeout(
      `${backendUrl}/api/ai/intent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: text,
          uiContext: getUIContext(),
          history,
          recentActivity: memoryRef.current.activityLog,
        }),
      },
      15000,
    );

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

    vadCleanupRef.current?.();
    vadCleanupRef.current = null;

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
@keyframes pulse {
  0% {
    transform: scale(1);
    opacity: .5;
  }
  100% {
    transform: scale(1.8);
    opacity: 0;
  }
}

@keyframes orb {
  50% {
    transform: scale(1.08);
  }
}

.idris-ai-container {
  position: fixed;
  right: 12px;
  bottom: 85px;
  z-index: 9999;
  transition: .5s ease;
}

.idris-ai-container.open {
  left: 50%;
  right: auto;
  bottom: 70px;
  transform: translateX(-50%);
}

.idris-ai-button {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: #1a1a1a;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 8px 30px rgba(0,0,0,.3);
  position: relative;
  z-index: 10001;
}

.idris-ai-container.open .idris-ai-button {
  width: 74px;
  height: 74px;
}

.idris-ai-container.listening .idris-ai-button {
  animation: orb 1s infinite;
}

.idris-ai-button::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: #b89f8a;
  z-index: -1;
  animation: pulse 1.5s infinite;
}

.idris-ai-orb {
  width: 35px;
  height: 35px;
  border-radius: 50%;
  background: radial-gradient( circle at 30% 30%, white, #b89f8a, #1a1a1a );
}

.idris-ai-box {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  width: min(350px,85vw);
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.idris-ai-message {
  background: white;
  border: 1px solid #e8e0d8;
  padding: 12px 15px;
  border-radius: 12px;
  font-family: Outfit;
  font-size: 13px;
  text-align: center;
  box-shadow: 0 10px 30px rgba(0,0,0,.12);
}

.idris-ai-status {
  background: #1a1a1a;
  color: white;
  padding: 7px 14px;
  border-radius: 20px;
  font-size: 12px;
  margin: auto;
  font-family: Outfit;
}

@media(max-width:480px) {
  .idris-ai-container.open {
    bottom: 20px;
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
