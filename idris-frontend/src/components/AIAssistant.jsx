import { useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getApiConfig } from "../config/api";
import { ShopContext } from "../context/ShopContext";
import { searchProducts } from "../utils/productSearch";
import { COLORS } from "../utils/productAttributes";

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
  gender: product.gender,
  category: product.category,
  price: product.price,
  bestseller: Boolean(product.bestseller),
});

// Word-boundary matched so e.g. "men" never also matches inside "women"
// (wo-MEN) - a plain .includes("men") check would.
//
// Gender/section and garment type are two independent facets a request can
// name together ("winter jackets for men") or across turns ("men" then,
// separately, "winter") - kept as separate detectors (not one
// first-match-wins list) so both can be resolved from the same utterance,
// and so the gender half specifically can be remembered/reapplied on a
// later turn that only supplies the other one.
const GENDER_TERM_PATTERNS = [
  { value: "women", pattern: /\bwomen'?s?\b/i },
  { value: "men", pattern: /\bmen'?s?\b/i },
  { value: "kids", pattern: /\bkids?\b/i },
];

const GARMENT_TERM_PATTERNS = [
  { value: "jacket", pattern: /\bjackets?\b/i },
  { value: "hoodie", pattern: /\bhoodies?\b/i },
  { value: "sweater", pattern: /\bsweaters?\b/i },
  { value: "t-shirt", pattern: /\bt-?shirts?\b|\btees?\b/i },
  { value: "shirt", pattern: /\bshirts?\b|\btopwear\b/i },
  { value: "trousers", pattern: /\bpants?\b|\btrousers?\b|\bbottomwear\b/i },
  { value: "dress", pattern: /\bdresses?\b/i },
  { value: "saree", pattern: /\bsarees?\b/i },
];

const detectGenderSection = (text) => {
  const hit = GENDER_TERM_PATTERNS.find(({ pattern }) => pattern.test(text));
  return hit ? hit.value : "";
};

const detectGarmentCategory = (text) => {
  const hit = GARMENT_TERM_PATTERNS.find(({ pattern }) => pattern.test(text));
  return hit ? hit.value : "";
};

// "Add the most expensive one to my cart" names a product by superlative,
// not by name - findProductByQuery (name matching only) can't resolve that,
// and used to leave the assistant with nothing to act on, so it fell back
// to dumping the whole raw sentence into the plain-text catalog search box.
// Resolved locally against the full catalog (already loaded client-side),
// no extra round trip needed.
const SUPERLATIVE_PATTERNS = [
  {
    pattern:
      /\b(most|highest|maximum)\s+(expensive|priced?|costly)\b|\bcostliest\b|\bpriciest\b/i,
    pick: (list) => [...list].sort((a, b) => b.price - a.price)[0],
  },
  {
    pattern: /\b(least|lowest|minimum)\s+(expensive|priced?)\b|\bcheapest\b/i,
    pick: (list) => [...list].sort((a, b) => a.price - b.price)[0],
  },
  {
    pattern: /\bnewest\b|\blatest\b|\bmost recent\b|\bnew arrival\b/i,
    pick: (list) => [...list].sort((a, b) => b.date - a.date)[0],
  },
  {
    pattern: /\bbestseller\b|\bbest seller\b|\bmost popular\b|\btop selling\b/i,
    pick: (list) => list.find((product) => product.bestseller),
  },
];

const resolveSuperlativeProduct = (text, productList) => {
  const hit = SUPERLATIVE_PATTERNS.find(({ pattern }) =>
    pattern.test(text || ""),
  );
  return (hit && hit.pick(productList)) || null;
};

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

const ORBIT_DOTS = Array.from({ length: 12 }, (_, i) => i);

const SparkleIcon = () => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none">
    <path
      d="M12 2 L14.2 9.3 L21.5 12 L14.2 14.7 L12 22 L9.8 14.7 L2.5 12 L9.8 9.3 Z"
      fill="currentColor"
    />
  </svg>
);

const MicIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="100%"
    height="100%"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0" />
    <line x1="12" y1="17" x2="12" y2="21" />
    <line x1="8" y1="21" x2="16" y2="21" />
  </svg>
);

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
  // Hindi is the assistant's default/first language (matches the DEVANAGARI_PATTERN
  // check in speakText, which picks the Hindi voice automatically for Devanagari
  // text) - it only switches to English/another language once the customer's own
  // message shows that's what they're using (see buildPersonaPrompt).
  const greetingLine = firstName
    ? `नमस्ते ${firstName}, मैं आपकी कैसे मदद कर सकती हूं?`
    : "नमस्ते! मैं आपकी कैसे मदद कर सकती हूं?";
  const [open, setOpen] = useState(false);
  // Bumped on every open so a fresh <span key={rippleSeq}> mounts and its
  // one-shot CSS animation restarts (a re-render with the same key would
  // never replay a completed "forwards"-filled animation).
  const [rippleSeq, setRippleSeq] = useState(0);
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
  const [conversationHistory, setConversationHistory] = useState([]);
  const [securityNotice, setSecurityNotice] = useState("");
  const [voiceError, setVoiceError] = useState("");

  // Mirrors isSpeaking for use inside SpeechRecognition's callbacks, which
  // are fixed closures created once by ensureRecognition() (see its
  // onspeechstart comment) - a direct read of the isSpeaking state variable
  // there would forever see whatever it was when recognition was first
  // created, not its current value. Also used by the MediaRecorder/VAD
  // path's echo guard (see ECHO_GUARD_MS), where a plain ref is just the
  // simplest way to read this synchronously inside the rAF tick loop.
  // Kept in sync by the effect below.
  const isSpeakingRef = useRef(false);
  // Timestamp of the last time speaking actually stopped (naturally or via
  // barge-in) - see ECHO_GUARD_MS's declaration for why.
  const lastSpeakEndTimeRef = useRef(0);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  // Utterances captured - as { type: "audio", blob } from the MediaRecorder
  // path, or { type: "text", text } already transcribed by the browser's
  // own SpeechRecognition - while a previous one is still being
  // transcribed/answered. Both voice paths keep listening the whole time
  // (see startRecorderCycle and ensureRecognition's continuous mode), so
  // without this a second thing said while the assistant was still
  // "thinking" about the first would either be dropped or, worse, processed
  // concurrently with it and race for the same shared conversation state.
  // Drained strictly in order by runVoiceQueue so replies never arrive out
  // of sequence.
  const voiceQueueRef = useRef([]);
  const isProcessingVoiceQueueRef = useRef(false);
  // Caps how much can pile up if someone keeps talking through several
  // replies in a row - drops the oldest so the assistant catches up on
  // what was said most recently rather than working through an ever-longer
  // backlog of stale commands. Kept small - each queued item is a full
  // transcribe+answer round trip, so a deep backlog directly adds
  // multiple seconds of extra wait before the assistant catches up to
  // whatever was said most recently.
  const MAX_QUEUED_UTTERANCES = 2;
  // Accumulates SpeechRecognition's own final-result fragments for the
  // *current* utterance (see recognition.onresult) - Chrome's recognizer
  // frequently splits one sentence into several final segments at natural
  // pauses ("I want" / "a red shirt"), and reacting to each in isolation is
  // what made the assistant seem to only catch fragments of what was said.
  // Cleared once schedulePauseResponse decides the utterance is actually
  // over and hands the accumulated text off to the voice queue.
  const recognizedTextBufferRef = useRef("");
  // SpeechRecognition's transcription locale is fixed at "en-IN" for the
  // whole session - a "hi-IN" default was tried to better recognize actual
  // Hindi speech, but Safari's SpeechRecognition depends on the OS's own
  // installed dictation language rather than a cloud model like Chrome's,
  // and silently produces zero results (no error, "listening" still shows)
  // when the language isn't available on the device - indistinguishable
  // from the assistant simply going deaf, with no reliable way to detect
  // that failure mode from here. en-IN is the confirmed-working baseline
  // across Chrome/Safari/Brave. This doesn't affect reply language or
  // Hindi/Hinglish *understanding* - Gemini still judges and replies in
  // Hindi/Hinglish correctly regardless of what script the browser's own
  // transcript comes back in (see buildPersonaPrompt) - it only means
  // Hindi speech is transcribed through an English-tuned recognizer, which
  // is less accurate than a native Hindi one would be.
  // Teardown for the MediaRecorder-path voice activity monitor (see
  // startVoiceActivityMonitor) - that path has no native "user started
  // talking" event the way SpeechRecognition does, so barge-in there needs
  // its own lightweight mic-level watcher.
  const vadCleanupRef = useRef(null);
  // Whether the mic level has crossed VOLUME_THRESHOLD at all during the
  // *current* MediaRecorder recording cycle (reset per cycle) - gates the
  // end-of-utterance timer below so silence before the customer has said
  // anything can't stop the recording early.
  const utteranceSpeechDetectedRef = useRef(false);
  // Debounces "the customer just stopped talking" for the MediaRecorder
  // path, mirroring what SpeechRecognition's own end-of-speech detection
  // gives the native path for free. See startVoiceActivityMonitor.
  const utteranceEndTimerRef = useRef(null);
  const recognitionRef = useRef(null);
  // ensureRecognition() builds the SpeechRecognition object once and caches
  // it in recognitionRef for the rest of the session - its callbacks are
  // therefore permanently bound to whatever render happened to be active
  // the first time it ran, so a direct call to processVoiceText from inside
  // them would forever see that render's cartItems/products/location/etc,
  // not the current ones (e.g. items added to the cart, or a navigation to
  // checkout, after that first session would be invisible to it). Routing
  // through this ref - kept pointed at the latest render's processVoiceText
  // by the effect below - keeps every voice command working off current
  // state no matter how long the recognition session has been running.
  const processVoiceTextRef = useRef(null);
  const pauseTimerRef = useRef(null);
  // Nudges the customer if the mic has been open with no speech from them at
  // all for a while - separate from pauseTimerRef, which is about detecting
  // the end of a single utterance, not a whole idle stretch of the session.
  const silenceTimerRef = useRef(null);
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
    // Separate from lastCategory (which is whatever single value the last
    // search/recommendation used, gender or garment type or section) -
    // this specifically tracks men/women/kids so a later request that only
    // gives an occasion or garment type ("winter", "a jacket") stays scoped
    // to the audience the customer already told the assistant, instead of
    // searching across all three sections again.
    lastGenderCategory: "",
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
  // Speak the greeting once per open conversation, not once per listening
  // session. startRecording()/startMediaRecorderSession() can restart the
  // mic mid-conversation (a SpeechRecognition error falling back to the
  // MediaRecorder path, or retryVoiceSession after a transient error) -
  // without this guard every one of those restarts replayed the greeting,
  // which is what made the assistant appear to "start over" mid-chat.
  const hasGreetedRef = useRef(false);

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
    isSpeakingRef.current = isSpeaking;
    if (!isSpeaking) {
      lastSpeakEndTimeRef.current = Date.now();
    }
  }, [isSpeaking]);

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

  // Trailing silence after speech that means the customer is done talking,
  // for the same purpose SpeechRecognition's own end-of-speech detection
  // serves the native path. Long enough to survive a normal mid-sentence
  // pause, short enough that replies don't lag noticeably behind the native
  // path's.
  const SPEECH_END_SILENCE_MS = 1100;
  // Volume must stay above VOLUME_THRESHOLD for this long, continuously,
  // before it counts as the start of a real utterance - filters out a
  // single loud frame (a click, a cough, a stray noise spike) from being
  // treated as "the customer said something," which otherwise queued up a
  // full transcribe+answer round trip for pure noise. Each one of those
  // adds several real seconds of latency before the *actual* command even
  // starts being answered (see MAX_QUEUED_UTTERANCES), which is what made
  // replies feel like they were taking up to a minute.
  const MIN_SPEECH_DURATION_MS = 250;

  // MediaRecorder (the Brave/fallback voice path) has no equivalent of
  // SpeechRecognition's onspeechstart/onspeechend events, so this watcher
  // covers both jobs with one lightweight, separate analyser tap on the mic
  // stream, independent of the actual recording/transcript pipeline:
  // barge-in (cut the assistant off the instant the visitor starts talking)
  // always, and - only when `onUtteranceEnd` is passed - ending the current
  // recording once the customer has spoken and then gone quiet for
  // SPEECH_END_SILENCE_MS, so a Brave session doesn't have to be manually
  // stopped after every single utterance. Returns a cleanup function.
  const startVoiceActivityMonitor = (stream, onUtteranceEnd) => {
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
    // When the volume most recently crossed VOLUME_THRESHOLD - null while
    // below it. Used to require MIN_SPEECH_DURATION_MS of continuous sound
    // before treating it as real speech (see MIN_SPEECH_DURATION_MS).
    let aboveThresholdSince = null;

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
        clearSilenceTimer();

        if (onUtteranceEnd) {
          // Ignore volume for utterance-detection purposes while the
          // assistant is speaking, or shortly after (see ECHO_GUARD_MS) -
          // its own voice coming back through the mic would otherwise get
          // treated as the customer talking, recorded, and sent off to be
          // "answered," which speaks another reply that gets picked up
          // again - a self-triggering loop. getUserMedia's
          // echoCancellation isn't a guaranteed fix here since the
          // assistant's replies play through the raw Web Audio API rather
          // than a standard <audio> element, which browser echo
          // cancellation isn't guaranteed to track as a reference signal.
          // stopSpeaking() above still runs unconditionally, so a genuine
          // interruption still cuts the assistant off immediately even
          // though it won't be captured as the next command until this
          // window passes.
          const inEchoWindow =
            isSpeakingRef.current ||
            Date.now() - lastSpeakEndTimeRef.current < ECHO_GUARD_MS;

          if (inEchoWindow) {
            aboveThresholdSince = null;
          } else {
            if (aboveThresholdSince === null) aboveThresholdSince = Date.now();

            if (
              !utteranceSpeechDetectedRef.current &&
              Date.now() - aboveThresholdSince >= MIN_SPEECH_DURATION_MS
            ) {
              utteranceSpeechDetectedRef.current = true;
            }
          }

          if (utteranceEndTimerRef.current) {
            clearTimeout(utteranceEndTimerRef.current);
            utteranceEndTimerRef.current = null;
          }
        }
      } else {
        aboveThresholdSince = null;

        if (
          onUtteranceEnd &&
          utteranceSpeechDetectedRef.current &&
          !utteranceEndTimerRef.current
        ) {
          utteranceEndTimerRef.current = setTimeout(() => {
            utteranceEndTimerRef.current = null;
            onUtteranceEnd();
          }, SPEECH_END_SILENCE_MS);
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    tick();

    return () => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (utteranceEndTimerRef.current) {
        clearTimeout(utteranceEndTimerRef.current);
        utteranceEndTimerRef.current = null;
      }
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
      // speakText() already optimistically flipped isSpeaking true - if
      // there's no voice backend to actually pick it up, undo that so the
      // UI doesn't get stuck showing "Speaking" forever.
      setIsSpeaking(false);
      scheduleSilenceNudge();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLang;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.voice = getPreferredVoice(speechLang);

    utterance.onstart = () => setIsSpeaking(true);
    // Back to genuinely idle-and-waiting - restart the "are you still
    // there" countdown from here (see scheduleSilenceNudge's declaration).
    utterance.onend = () => {
      setIsSpeaking(false);
      scheduleSilenceNudge();
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      scheduleSilenceNudge();
    };

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
        // Back to genuinely idle-and-waiting - restart the "are you still
        // there" countdown from here (see scheduleSilenceNudge's
        // declaration). Only for the still-current generation - a
        // superseded/interrupted stream (barge-in) already gets its
        // reschedule from the path that interrupted it, not from here.
        scheduleSilenceNudge();
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
    // Flip immediately rather than waiting for the first streamed audio
    // chunk (~1.2-1.6s away) - otherwise the UI sits in the idle state for
    // that entire window even though the assistant has already committed
    // to speaking.
    setIsSpeaking(true);

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

  // How long to wait after SpeechRecognition's last final-result fragment
  // before treating the utterance as actually finished. Chrome's recognizer
  // fires a separate final result at natural mid-sentence pauses even in
  // continuous mode, so reacting to the first one immediately would treat
  // "I want" and "a red shirt" as two unrelated commands instead of one
  // sentence - this debounce lets them accumulate in
  // recognizedTextBufferRef first. Short enough that replies still feel
  // responsive once the customer is genuinely done talking.
  const RECOGNITION_PAUSE_MS = 900;

  // Shared by both voice paths (recognition.onresult below, and the
  // MediaRecorder/VAD path's utterance detection in
  // startVoiceActivityMonitor) - without this, the assistant's own voice
  // coming out of the speakers can get picked back up by the mic,
  // recognized as if the customer said it, and answered, which speaks
  // another reply that gets picked up again, and so on: a self-sustaining
  // loop that looks exactly like "thinking again, speaking again" with no
  // one talking. Neither path's echo cancellation is a guaranteed fix -
  // SpeechRecognition's depends on the OS/browser's own implementation
  // (Safari's isn't reliable here), and MediaRecorder's getUserMedia
  // echoCancellation isn't guaranteed to track the assistant's replies as a
  // reference signal since they play through the raw Web Audio API rather
  // than a standard <audio> element. Speech detected while the assistant is
  // speaking, or within this window right after it stops (covering the
  // echo tail, and the brief lag before a barge-in's stopSpeaking() call
  // has actually silenced the audio), is treated as suspected echo and
  // ignored rather than treated as the next command.
  const ECHO_GUARD_MS = 500;

  const schedulePauseResponse = () => {
    clearPauseTimer();
    pauseTimerRef.current = setTimeout(() => {
      pauseTimerRef.current = null;
      if (!listeningSessionRef.current) return;

      const text = recognizedTextBufferRef.current.trim();
      recognizedTextBufferRef.current = "";
      if (!text) return;

      enqueueVoiceItem({ type: "text", text });
    }, RECOGNITION_PAUSE_MS);
  };

  const SILENCE_NUDGE_MS = 45000;
  // Caps how many times in a row the assistant will nudge a customer who
  // never responds at all, so a tab left open overnight doesn't keep
  // speaking (and billing voice synthesis) forever. Reset to 0 the moment
  // the customer actually says anything.
  const MAX_CONSECUTIVE_SILENCE_NUDGES = 3;
  const silenceNudgeCountRef = useRef(0);

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  // Mirrors the assistant's own Hindi-first-then-match-customer language rule
  // (see aiChatContext.js's persona prompt), using the same script check
  // speakText already uses to pick a voice, so the nudge doesn't switch
  // languages on its own mid-conversation. Falls back to Hindi (the default)
  // when nothing has been said yet.
  const pickSilenceNudgeText = () => {
    const lastTurn = [...conversationHistory]
      .reverse()
      .find((entry) => entry.content?.trim());
    const isEnglish = Boolean(lastTurn) && detectSpeechLang(lastTurn.content) === "en-IN";

    return isEnglish
      ? "I'm still here to help you — just let me know what you'd like."
      : "मैं आपकी सहायता के लिए यहीं हूं, बताइए आपको क्या चाहिए।";
  };

  // Restarts the 45s "are you still there" countdown for the current
  // listening session. Called whenever the assistant genuinely returns to
  // idle-and-waiting (mic session starts, or a spoken reply finishes) -
  // and cleared the instant the customer makes any sound (see
  // clearSilenceTimer's call sites), so it only ever fires after a truly
  // continuous stretch of silence, never mid-turn.
  const scheduleSilenceNudge = () => {
    clearSilenceTimer();

    if (silenceNudgeCountRef.current >= MAX_CONSECUTIVE_SILENCE_NUDGES) return;

    silenceTimerRef.current = setTimeout(() => {
      if (!listeningSessionRef.current) return;

      silenceNudgeCountRef.current += 1;
      const nudge = pickSilenceNudgeText();
      setAiReply(nudge);
      speakText(nudge);
      pushHistory("assistant", nudge);
      // Still silent after the nudge - keep checking (up to the cap above)
      // rather than nagging once and then never following up again.
      scheduleSilenceNudge();
    }, SILENCE_NUDGE_MS);
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
      gender: "",
      category: "",
      productType: "",
      color: "",
      maxPrice: "",
    };

    filters.gender = detectGenderSection(normalized);
    filters.productType = detectGarmentCategory(normalized);

    const colorHit = COLORS.find((color) => normalized.includes(color));
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

  const scoreRecommendations = (keywords, productList = products) => {
    if (!keywords.length) return [];

    const scored = productList.map((product) => {
      const haystack = [
        product.name,
        product.gender,
        product.category,
        product.productType,
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

      // Bestseller only breaks ties among products already relevant to the
      // occasion - gated on score > 0 so a bestseller with no topical match
      // at all (e.g. a bestselling saree recommended for "office wear")
      // can't reach the score > 0 cutoff below on the bonus alone. This was
      // previously unconditional, which is how unrelated bestsellers ended
      // up mixed into every occasion-based recommendation.
      if (product.bestseller && score > 0) {
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
    if (voiceProductIds !== null) {
      const byId = new Map(products.map((product) => [product._id, product]));
      return voiceProductIds.map((id) => byId.get(id)).filter(Boolean);
    }

    const filters = voiceSearchFilters || {};
    const hasFilter = Boolean(
      (filters.query || "").trim() ||
      filters.gender ||
      filters.category ||
      filters.productType ||
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
  // Confirmation for place_order/cancel_order (and the size question below)
  // is resolved locally against the customer's raw words, deterministically
  // and without going back through the AI (see the pendingActionRef
  // "confirm" handling in processVoiceText) - so unlike everything routed
  // through Gemini, which already understands Hindi via buildPersonaPrompt,
  // this regex is the *only* thing standing between a Hindi-speaking
  // customer (Hindi is the assistant's default/first language) and being
  // able to confirm or cancel an order at all. English-only here would mean
  // saying "haan"/"हां" to confirm an order placed in Hindi just never
  // matches anything.
  const parseYesNo = (text) => {
    const normalized = text.toLowerCase().trim();
    if (
      /^(yes|yeah|yep|yup|sure|confirm|confirmed|go ahead|do it|okay|ok|please do|correct|haan|han|ha|haa|ji haan|ji|bilkul|thik hai|theek hai|kar do|karo|हां|हाँ|जी|जी हां|बिल्कुल|ठीक है|कर दो|करो)\b/.test(
        normalized,
      )
    ) {
      return "yes";
    }
    if (
      /^(no|nope|nah|cancel|never\s?mind|stop|don'?t|nahi|nahin|na|mat karo|rehne do|rahne do|नहीं|ना|मत करो|रहने दो)\b/.test(
        normalized,
      )
    ) {
      return "no";
    }
    return null;
  };

  const parseSizeAnswer = (text, availableSizes) => {
    const normalized = text.toLowerCase().trim();

    // Same Hindi-support reasoning as parseYesNo above - resolved locally,
    // not through Gemini, so it needs its own Hindi/Hinglish coverage.
    if (
      /\b(cancel|never\s?mind|forget it|stop|no|nahi|nahin|na|rehne do|rahne do|नहीं|ना|रहने दो)\b/.test(
        normalized,
      )
    ) {
      return { cancel: true };
    }

    if (
      /\b(any size|any|you (choose|pick|decide)|whatever|doesn'?t matter|surprise me|koi bhi|jo bhi|aap choose|aap chun lo)\b/.test(
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

  // Finds the product a cart/order-adjacent tool call is referring to:
  // a resolved id from context first, then a superlative reference
  // ("the most expensive one"), then a fuzzy name match.
  const resolveProductFromArgs = (args, rawText) => {
    if (args.productId) {
      const byId = products.find((product) => product._id === args.productId);
      if (byId) return byId;
    }

    const text = args.query || rawText;
    return (
      resolveSuperlativeProduct(text, products) || findProductByQuery(text)
    );
  };

  // Central place a recommendation/browse result gets spoken and pushed to
  // the collection page - shared by the audience/garment browse branch and
  // the (rare, now-audience-scoped) zero-signal path so both stay in sync
  // with how search_products reports itself.
  const respondWithProducts = (matchingProducts, filters, descriptor) => {
    setVoiceSearchFilters({
      query: filters.query || "",
      gender: filters.gender || "",
      category: filters.category || "",
      productType: filters.productType || "",
      color: filters.color || "",
      maxPrice: filters.maxPrice || null,
    });
    setVoiceProductIds(matchingProducts.map((product) => product._id));
    setSearch("");
    setShowSearch(false);
    navigate("/collection");

    const spoken =
      matchingProducts.length > 0
        ? `${firstName ? `Sure, ${firstName}. ` : ""}Here are ${matchingProducts.length} products${descriptor ? ` for ${descriptor}` : ""}.`
        : `I could not find any products${descriptor ? ` for ${descriptor}` : ""}.`;

    setCurrentAction(
      matchingProducts.length > 0
        ? `Showing ${matchingProducts.length} products${descriptor ? ` for ${descriptor}` : ""}`
        : "No matching products found",
    );
    setAiReply(spoken);
    rememberSearchContext(
      filters,
      matchingProducts,
      descriptor || filters.query,
    );
    speakText(spoken);
    return spoken;
  };

  const handleRecommendationQuery = (text) => {
    const explicitGender = detectGenderSection(text);
    const garmentCategory = detectGarmentCategory(text);
    const occasionKeywords = getRecommendationKeywords(text);

    // A gender word in THIS utterance always wins and is remembered for
    // later turns; otherwise fall back to whichever audience the customer
    // already told the assistant this session, so "winter" on its own
    // after "men" stays scoped to men instead of searching all sections.
    const resolvedGender =
      explicitGender || memoryRef.current.lastGenderCategory || "";
    if (explicitGender) {
      memoryRef.current = {
        ...memoryRef.current,
        lastGenderCategory: explicitGender,
      };
    }

    // No known audience - a recommendation is inherently personal, so even
    // "suggest a warm jacket" (garment + occasion, but no one named) should
    // ask who it's for rather than mixing men's/women's/kids' results
    // together. (search_products, a direct "show me jackets" lookup, is
    // intentionally not gated this way - see that case's own comment.)
    // Ask, and remember the original request so it can be combined with
    // the audience once we have one.
    if (!resolvedGender) {
      const question = "Sure - who are these for: men, women, or kids?";
      setCurrentAction("Awaiting recommendation audience");
      setAiReply(question);
      speakText(question);
      pendingActionRef.current = {
        type: "recommendation_clarify",
        originalText: text,
      };
      return question;
    }

    const genderScopedProducts = resolvedGender
      ? products.filter(
          (product) =>
            (product.gender || "").toLowerCase() === resolvedGender,
        )
      : products;

    const audienceLabel = resolvedGender
      ? resolvedGender.charAt(0).toUpperCase() + resolvedGender.slice(1)
      : "";
    const describeFor = (secondary) =>
      audienceLabel
        ? `${audienceLabel}'s${secondary ? ` ${secondary}` : ""}`
        : secondary || "";

    // A garment type ("a jacket") or a bare audience ("men", nothing else)
    // is a browse - show every match, the same as search_products, rather
    // than a curated handful.
    if (garmentCategory || !occasionKeywords.length) {
      const filters = {
        query: "",
        gender: resolvedGender,
        category: "",
        productType: garmentCategory,
        color: "",
        maxPrice: "",
      };
      const matchingProducts = searchProducts(genderScopedProducts, filters);
      const descriptor = describeFor(garmentCategory);
      return respondWithProducts(matchingProducts, filters, descriptor);
    }

    // An occasion ("winter", "office", "party"...) - curated top picks,
    // scoped to the resolved audience.
    const picks = scoreRecommendations(occasionKeywords, genderScopedProducts);
    const descriptor = describeFor(occasionKeywords[0]);

    const responseText =
      picks.length > 0
        ? `${firstName ? `Sure, ${firstName}. ` : ""}I recommend ${picks.map((item) => item.name).join(", ")}${descriptor ? ` for ${descriptor}` : ""}.`
        : `I could not find a strong recommendation${descriptor ? ` for ${descriptor}` : ""}.`;

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

    const availableSizes = product.sizes || [];
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
        // Same audience memory as recommend_products (see
        // handleRecommendationQuery) - a follow-up like "now show jackets"
        // with no gender word of its own should stay scoped to whichever
        // audience the customer already named this session, not search
        // across men/women/kids again. Unlike recommend_products, this
        // doesn't ask when no audience is known at all - "search for
        // jackets" is a direct catalog lookup (like typing in the search
        // box), not a personal recommendation, so it's fine to search
        // every section by default.
        const explicitGender = (args.gender || "").toLowerCase() || detectGenderSection(rawText);
        const resolvedGender =
          explicitGender || memoryRef.current.lastGenderCategory || "";

        if (explicitGender) {
          memoryRef.current = {
            ...memoryRef.current,
            lastGenderCategory: explicitGender,
          };
        }

        const genderScopedProducts = resolvedGender
          ? products.filter(
              (product) =>
                (product.gender || "").toLowerCase() === resolvedGender,
            )
          : products;

        const filters = {
          query: args.query || rawText,
          gender: resolvedGender,
          category: args.category || "",
          productType: args.productType || "",
          color: args.color || "",
          maxPrice: args.maxPrice ?? "",
        };

        const matchingProducts = searchProducts(genderScopedProducts, filters);

        setVoiceSearchFilters({
          query: filters.query,
          gender: filters.gender,
          category: filters.category,
          productType: filters.productType,
          color: filters.color,
          maxPrice: filters.maxPrice || null,
        });
        setVoiceProductIds(matchingProducts.map((product) => product._id));
        // The results are already filtered via voiceProductIds above -
        // don't also surface the raw spoken sentence in the visible search
        // input (e.g. "show me black jacket" verbatim). Matches how
        // handleRecommendationQuery/respondWithProducts already behave.
        setSearch("");
        setShowSearch(false);
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
        // rawText (the customer's literal words), not args.query - Gemini's
        // query is paraphrased toward "occasion/use-case" per its schema
        // description and can drop words like "men" entirely, which the
        // gender/garment detectors inside handleRecommendationQuery need
        // to see verbatim.
        return handleRecommendationQuery(rawText);

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

        const availableSizes = product.sizes || [];
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

  // Adds one item to the voice queue (see voiceQueueRef) and kicks off
  // draining it. Shared by both voice paths - SpeechRecognition (Chrome/
  // Safari) enqueues already-transcribed text once schedulePauseResponse
  // decides an utterance is finished, MediaRecorder (Brave) enqueues a raw
  // audio blob to be transcribed first. Caps how much can pile up if
  // someone keeps talking through several replies in a row, dropping the
  // oldest so the assistant catches up on what was said most recently
  // rather than working through an ever-longer backlog of stale commands.
  const enqueueVoiceItem = (item) => {
    if (voiceQueueRef.current.length >= MAX_QUEUED_UTTERANCES) {
      voiceQueueRef.current.shift();
    }
    voiceQueueRef.current.push(item);
    runVoiceQueue();
  };

  // Drains voiceQueueRef strictly in arrival order, one utterance at a
  // time, so replies to a burst of things said in quick succession (or
  // while a previous reply was still being generated) come back in the
  // same order they were spoken instead of racing each other. Safe to call
  // any time something is added to the queue - it's a no-op if a drain is
  // already running, since that loop will pick up the new item itself.
  const runVoiceQueue = async () => {
    if (isProcessingVoiceQueueRef.current) return;
    isProcessingVoiceQueueRef.current = true;

    try {
      while (voiceQueueRef.current.length > 0) {
        if (!listeningSessionRef.current) {
          voiceQueueRef.current = [];
          break;
        }

        const item = voiceQueueRef.current.shift();

        try {
          let text = item.text;

          if (item.type === "audio") {
            setStatus("transcribing");

            const formData = new FormData();
            formData.append(
              "audio",
              item.blob,
              `idris.${getAudioExtension(item.blob.type)}`,
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
              12000,
            );

            const data = await response.json();

            if (!data.success) {
              throw new Error(data.message);
            }

            text = data.transcript.trim();
          } else {
            setStatus("thinking");
          }

          await processVoiceTextRef.current(text);

          // The MediaRecorder path gets this for free every cycle (a fresh
          // recorder's onstart fires and resets status to "listening"), but
          // SpeechRecognition in continuous mode doesn't necessarily
          // restart between utterances - recognition.onstart may simply
          // never fire again for the rest of the session. Without this,
          // status stayed on "thinking" forever after a successful reply,
          // showing that label indefinitely even once genuinely back to
          // listening (speakText's reply is fired without awaiting, so
          // isSpeaking - checked first by getStatusText - still correctly
          // shows "Speaking" for as long as the reply is actually playing).
          if (listeningSessionRef.current) {
            setStatus("listening");
          }
        } catch /*(error)*/ {
          setVoiceError(
            "I could not understand the audio or connect to voice services. You can try again.",
          );
          setStatus("error");
          // Keep draining rather than aborting the whole queue - one bad
          // item (e.g. a transcribe timeout) shouldn't also swallow replies
          // to whatever was said after it, and the mic is still listening
          // in the background regardless.
        }
      }
    } finally {
      isProcessingVoiceQueueRef.current = false;
    }
  };

  const startMediaRecorderSession = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    // The assistant may have been closed while getUserMedia was still
    // resolving (stopRecording runs before the mic stream exists, so it has
    // nothing to stop). Without this check the stream below would go live
    // with no one left to stop it, leaving the mic indicator stuck on.
    if (!listeningSessionRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    mediaStreamRef.current = stream;

    const mimeType = getSupportedMimeType();
    recordingMimeTypeRef.current = mimeType;

    // Cycles a fresh MediaRecorder over this same mic stream for every
    // utterance (started here for the first one, then again from onstop
    // below once each reply is done) instead of tearing the stream down and
    // calling getUserMedia again per turn - that would re-prompt/flicker the
    // browser's mic indicator between every exchange in a multi-turn
    // conversation.
    const startRecorderCycle = () => {
      if (!listeningSessionRef.current || voiceModeRef.current !== "media") {
        return;
      }

      utteranceSpeechDetectedRef.current = false;

      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );

      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.onstart = () => {
        setStatus("listening");
        scheduleSilenceNudge();
        if (!hasGreetedRef.current) {
          hasGreetedRef.current = true;
          speakText(greetingLine);
        }
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: recordingMimeTypeRef.current || recorder.mimeType || "audio/webm",
        });

        audioChunksRef.current = [];

        // The session was closed while this last cycle's audio was still
        // being flushed (stopRecording stops the recorder but its onstop
        // still fires) - nothing left to reply to, so skip everything below
        // instead of hitting the backend after the widget is already gone.
        if (!listeningSessionRef.current) return;

        // Start the next cycle right away, in parallel with transcribing/
        // answering this one below - not after it finishes. Waiting used to
        // leave the mic completely off for the whole "thinking" round trip,
        // so anything said in that window was silently lost; when the
        // assistant's reply finally started, the mic reopening mid-sentence
        // triggered barge-in and cut it off immediately, then treated
        // whatever fragment it caught as the next command. Restarting
        // immediately keeps the mic live the entire time, so nothing said
        // while a previous command is still being processed gets dropped.
        startRecorderCycle();

        // Stopped (e.g. by the silence-based auto-stop) before any audio was
        // actually captured - nothing to send.
        if (!audioBlob.size) return;

        enqueueVoiceItem({ type: "audio", blob: audioBlob });
      };

      recorder.start(250);
    };

    vadCleanupRef.current?.();
    vadCleanupRef.current = startVoiceActivityMonitor(stream, () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state === "recording") {
        recorder.stop();
      }
    });

    startRecorderCycle();
  };

  const processVoiceText = async (text) => {
    const normalizedText = text.trim();

    if (!normalizedText) return;

    // The customer has said something - reset the silence-nudge streak and
    // stop any pending countdown for the duration of this turn (it restarts
    // once the assistant's reply finishes speaking, see scheduleSilenceNudge's
    // call sites). Mainly a safety net here for the MediaRecorder path, which
    // has no onspeechstart-equivalent event of its own to clear it earlier.
    silenceNudgeCountRef.current = 0;
    clearSilenceTimer();

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
        const availableSizes = product?.sizes || [];
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
      } else if (pending.type === "recommendation_clarify") {
        const gender = detectGenderSection(normalizedText);

        if (gender) {
          pendingActionRef.current = null;
          // Combine the answer with the original ask so any occasion/
          // garment type already mentioned ("suggest something warm") is
          // still honored now that the audience is known too.
          const spoken = handleRecommendationQuery(
            `${pending.originalText} ${normalizedText}`.trim(),
          );
          pushHistory("assistant", spoken);
          return spoken;
        }

        if (
          /\b(cancel|never\s?mind|forget it|stop|no thanks)\b/i.test(
            normalizedText,
          )
        ) {
          pendingActionRef.current = null;
          const spoken = "Okay, no problem.";
          setAiReply(spoken);
          speakText(spoken);
          pushHistory("assistant", spoken);
          return spoken;
        }

        // Didn't answer the audience question - drop the pending state and
        // fall through to treat this as a new, unrelated utterance.
        pendingActionRef.current = null;
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

    // The real recent transcript (oldest first), not just the clarification-
    // specific slice - the intent endpoint now also answers general
    // conversation directly, so it needs this to avoid re-greeting or
    // repeating itself and to resolve short follow-ups ("and in blue?").
    // Already capped to the last 11 turns by pushHistory; trimmed further
    // here to keep the request small.
    const recentHistory = conversationHistory
      .slice(-8)
      .map(({ role, content }) => ({ role, content }));

    try {
      toolCall = await getAssistantTool(
        normalizedText,
        clarificationHistory || recentHistory,
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
    } else if (toolCall?.reply && toolCall.replyType === "clarification") {
      // The model had live UI context but couldn't confidently resolve an
      // ambiguous reference (e.g. "open this") - ask the clarifying
      // question it produced instead of guessing. Remember the exchange so
      // the next utterance is understood as the answer to this exact
      // question.
      assistantResponse = toolCall.reply;
      setCurrentAction("Clarification requested");
      setAiReply(assistantResponse);
      speakText(assistantResponse);
      pendingActionRef.current = {
        type: "clarification",
        history: [
          ...(clarificationHistory || recentHistory),
          { role: "user", content: normalizedText },
          { role: "assistant", content: assistantResponse },
        ].slice(-6),
      };
    } else if (toolCall?.reply) {
      // No tool matched and no clarification needed - the same call already
      // produced the general-conversation answer (catalog + persona aware,
      // with real conversation history), so it can be spoken directly
      // without a second network round trip to the chat endpoint.
      assistantResponse = toolCall.reply;
      setCurrentAction("Answered");
      setAiReply(assistantResponse);
      speakText(assistantResponse);
    } else {
      // Only reached when the intent call itself failed/threw and the
      // offline fallback couldn't match a tool either - last-resort retry
      // against the plain chat endpoint.
      assistantResponse = await sendTranscriptToAI(normalizedText);
    }

    pushHistory(
      "assistant",
      assistantResponse || currentAction || "Processed command",
    );

    return assistantResponse;
  };

  useEffect(() => {
    processVoiceTextRef.current = processVoiceText;
  });

  const ensureRecognition = () => {
    if (isBraveBrowser()) return null;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) return null;

    if (recognitionRef.current) return recognitionRef.current;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    // Confirmed-working baseline across Chrome/Safari/Brave - see
    // recognizedTextBufferRef's declaration for why this stays fixed rather
    // than trying to switch locale for Hindi.
    recognition.lang = "en-IN";

    recognition.onstart = () => {
      setStatus("listening");
      scheduleSilenceNudge();
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
      clearSilenceTimer();
    };

    recognition.onresult = (event) => {
      clearSilenceTimer();

      // See ECHO_GUARD_MS's declaration - discard results that are most
      // likely the assistant's own voice echoing back through the mic
      // instead of the customer, rather than treating them as a command.
      if (
        isSpeakingRef.current ||
        Date.now() - lastSpeakEndTimeRef.current < ECHO_GUARD_MS
      ) {
        return;
      }

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

      // Chrome's recognizer fires a separate final result at every natural
      // pause even in continuous mode, so a long sentence routinely arrives
      // as several onresult events ("I want" / "a red shirt") rather than
      // one. Accumulate finalText here instead of acting on it immediately
      // - schedulePauseResponse below decides once nothing new has arrived
      // for a bit that the utterance is actually over, and only then hands
      // the whole accumulated sentence off to be answered.
      if (finalText.trim()) {
        recognizedTextBufferRef.current =
          `${recognizedTextBufferRef.current} ${finalText.trim()}`.trim();
      }

      const liveText = `${recognizedTextBufferRef.current} ${interimText}`.trim();

      if (liveText) {
        stopSpeaking();
        setTranscript(liveText);
      }

      // Only (re)arm the "utterance is done" debounce once there's at least
      // one finished segment buffered - interim-only results (still
      // mid-word) aren't a real pause yet.
      if (recognizedTextBufferRef.current) {
        schedulePauseResponse();
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
  // references like "this one". This endpoint now also answers general
  // conversation directly (see intentController's persona/catalog prompt),
  // so it returns one of: { tool } for an action, { reply, replyType:
  // "clarification" } when the model needs to ask about an ambiguous
  // reference, or { reply, replyType: "answer" } for a normal conversational
  // reply - callers should treat the last two differently (a clarification
  // expects the customer's next utterance to be its answer; a plain answer
  // does not). `history` is the real recent conversation (oldest first) so
  // the model can resolve follow-ups and clarifying-question answers in
  // context, and general chat doesn't come back blank on what was already
  // said. recentActivity is the session's rolling log of past searches/
  // commands (memoryRef), always sent, so the model can resolve follow-ups
  // that reference something earlier in the conversation even when it's no
  // longer what's on screen (e.g. "cheaper ones than what I searched
  // before"). Throws on network/config failure so the caller can fall back
  // to localFallbackTool.
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
          ...(token ? { token } : {}),
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
      replyType: data.replyType || null,
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
      recognizedTextBufferRef.current = "";
      hadSpeechRef.current = false;
      voiceModeRef.current = isBraveBrowser() ? "media" : "recognition";
      setTranscript("");
      setAiReply("");

      setStatus("requesting-mic");
      listeningSessionRef.current = true;

      const recognition =
        voiceModeRef.current === "recognition" ? ensureRecognition() : null;

      if (recognition) {
        setStatus("listening");
        if (!hasGreetedRef.current) {
          hasGreetedRef.current = true;
          speakText(greetingLine);
        }
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
    clearSilenceTimer();
    silenceNudgeCountRef.current = 0;
    voiceQueueRef.current = [];
    recognizedTextBufferRef.current = "";

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
      setRippleSeq((seq) => seq + 1);

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
    // Next open is a fresh conversation from the customer's point of view -
    // it should be greeted again. Only a mid-conversation mic restart (see
    // hasGreetedRef's declaration) should skip the greeting.
    hasGreetedRef.current = false;
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
    // isSpeaking is the actual source of truth for whether audio is
    // playing - `status` is never itself set to "speaking" (voice replies
    // are fired without awaiting so they don't block the status machine),
    // so without this check the status text falls through to its default
    // ("Ready to talk") for the entire duration of every spoken reply.
    if (isSpeaking) return "Speaking";

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

  const uiState = !open
    ? "default"
    : isSpeaking || status === "speaking"
      ? "speaking"
      : status === "listening" || status === "requesting-mic"
        ? "listening"
        : status === "thinking" || status === "transcribing"
          ? "thinking"
          : "idle";

  return (
    <>
      <style>{`
@keyframes idris-halo {
  0% {
    opacity: .55;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(1.55);
  }
}

@keyframes idris-breathe {
  0%,
  100% {
    transform: translateZ(0) scale(1);
  }
  50% {
    transform: translateZ(0) scale(1.06);
  }
}

@keyframes idris-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes idris-wave-bar {
  0%,
  100% {
    transform: scaleY(.4);
  }
  50% {
    transform: scaleY(1);
  }
}

@media(prefers-reduced-motion:reduce) {
  .idris-ai-button,
  .idris-ai-button * {
    animation-duration: .001ms!important;
    animation-iteration-count: 1!important;
    transition-duration: .001ms!important;
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
  --idris-ease: cubic-bezier(.22,1,.36,1);
  --idris-t-fast: 160ms;
  --idris-t-med: 300ms;
  --ring-color: 255,255,255;
  --ring-alpha: .18;
  --glow-alpha: .14;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: radial-gradient(circle at 32% 28%,#3c3c3c,#161616 55%,#000 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
  z-index: 10001;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 8px 24px rgba(0,0,0,.35), inset 0 1px 1px rgba(255,255,255,.22), inset 0 -6px 10px rgba(0,0,0,.5), 0 0 0 1px rgba(var(--ring-color),var(--ring-alpha)), 0 0 18px 2px rgba(var(--ring-color),var(--glow-alpha));
  transform: translateZ(0);
  transition: box-shadow var(--idris-t-med) var(--idris-ease), width var(--idris-t-med) var(--idris-ease), height var(--idris-t-med) var(--idris-ease), transform var(--idris-t-fast) var(--idris-ease);
}

.idris-ai-button:focus-visible {
  outline: 2px solid rgba(255,255,255,.85);
  outline-offset: 3px;
}

.idris-ai-button:not(.idris-state-listening):active {
  transform: translateZ(0) scale(.93);
}

.idris-ai-container.open .idris-ai-button {
  width: 74px;
  height: 74px;
}

.idris-ai-container:not(.open) .idris-ai-button:hover {
  --ring-alpha: .45;
  --glow-alpha: .32;
}

.idris-ai-button::before {
  content: "";
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 1.5px solid rgba(255,255,255,.6);
  opacity: 0;
  pointer-events: none;
}

.idris-ai-container:not(.open) .idris-ai-button:hover::before {
  animation: idris-halo 1.6s ease-out infinite;
}

.idris-ring-dashed {
  position: absolute;
  inset: -10px;
  border-radius: 50%;
  border: 2px dashed rgba(94,234,212,.65);
  opacity: 0;
  pointer-events: none;
  will-change: transform;
  animation: idris-spin 6s linear infinite;
  animation-play-state: paused;
  transition: opacity var(--idris-t-med) var(--idris-ease);
}

.idris-ai-button.idris-state-listening .idris-ring-dashed {
  opacity: 1;
  animation-play-state: running;
}

.idris-orbit {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
  will-change: transform;
  animation: idris-spin 3s linear infinite;
  animation-play-state: paused;
  transition: opacity var(--idris-t-med) var(--idris-ease);
}

.idris-ai-button.idris-state-thinking .idris-orbit {
  opacity: 1;
  animation-play-state: running;
}

.idris-orbit-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #a78bfa;
  box-shadow: 0 0 4px rgba(167,139,250,.8);
  transform: translate(-50%,-50%) rotate(calc(var(--i) * 30deg)) translateY(-44px);
}

.idris-ai-button.idris-state-listening {
  --ring-color: 45,212,218;
  --ring-alpha: .6;
  --glow-alpha: .42;
  animation: idris-breathe 1.6s var(--idris-ease) infinite;
}

.idris-ai-button.idris-state-thinking {
  --ring-color: 167,139,250;
  --ring-alpha: .55;
  --glow-alpha: .38;
}

.idris-ai-button.idris-state-speaking {
  --ring-color: 96,165,250;
  --ring-alpha: .6;
  --glow-alpha: .42;
}

.idris-ai-icon {
  width: 22px;
  height: 22px;
  position: relative;
  z-index: 2;
  transition: width var(--idris-t-med) var(--idris-ease),height var(--idris-t-med) var(--idris-ease);
}

.idris-ai-container.open .idris-ai-icon {
  width: 26px;
  height: 26px;
}

.idris-icon-layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  opacity: 0;
  transform: scale(.85);
  transition: opacity var(--idris-t-med) var(--idris-ease),transform var(--idris-t-med) var(--idris-ease);
}

.idris-ai-button.idris-state-default .idris-icon-sparkle,
.idris-ai-button.idris-state-idle .idris-icon-sparkle,
.idris-ai-button.idris-state-thinking .idris-icon-sparkle {
  opacity: 1;
  transform: scale(1);
}

.idris-ai-button.idris-state-listening .idris-icon-mic {
  opacity: 1;
  transform: scale(1);
}

.idris-ai-button.idris-state-speaking .idris-icon-wave {
  opacity: 1;
  transform: scale(1);
}

.idris-ai-close {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 22px;
  line-height: 1;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--idris-t-fast) var(--idris-ease);
  z-index: 3;
}

.idris-ai-container.open .idris-ai-button:hover .idris-ai-close {
  opacity: 1;
}

.idris-ai-container.open .idris-ai-button:hover .idris-ai-icon,
.idris-ai-container.open .idris-ai-button:hover .idris-orbit,
.idris-ai-container.open .idris-ai-button:hover .idris-ring-dashed {
  opacity: 0;
}

.idris-ai-tooltip {
  position: absolute;
  bottom: calc(100% + 12px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  background: #1a1a1a;
  color: #fff;
  font-family: Outfit;
  font-size: 12px;
  padding: 7px 14px;
  border-radius: 20px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--idris-t-med) var(--idris-ease),transform var(--idris-t-med) var(--idris-ease);
}

.idris-ai-tooltip::after {
  content: "";
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: #1a1a1a;
}

.idris-ai-button:hover .idris-ai-tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.idris-wave {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 22px;
}

.idris-wave span {
  width: 3px;
  border-radius: 2px;
  background: #93c5fd;
  will-change: transform;
  animation: idris-wave-bar .85s ease-in-out infinite;
  animation-play-state: paused;
}

.idris-ai-button.idris-state-speaking .idris-wave span {
  animation-play-state: running;
}

.idris-wave span:nth-child(1) {
  height: 8px;
  animation-delay: 0s;
}

.idris-wave span:nth-child(2) {
  height: 16px;
  animation-delay: .1s;
}

.idris-wave span:nth-child(3) {
  height: 22px;
  animation-delay: .2s;
}

.idris-wave span:nth-child(4) {
  height: 14px;
  animation-delay: .3s;
}

.idris-wave span:nth-child(5) {
  height: 10px;
  animation-delay: .4s;
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

@keyframes idris-pulse-ring {
  0% {
    transform: scale(1);
    opacity: .5;
  }
  100% {
    transform: scale(1.65);
    opacity: 0;
  }
}

.idris-ai-beacon {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: #1a1a1a;
  pointer-events: none;
  animation: idris-pulse-ring 1.6s ease-out infinite;
}

@keyframes idris-pulse-ring-screen {
  0% {
    transform: scale(1);
    opacity: .5;
  }
  100% {
    transform: scale(180);
    opacity: 0;
  }
}

.idris-screen-ripple {
  position: fixed;
  right: 40px;
  bottom: 113px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #1a1a1a;
  pointer-events: none;
  z-index: 9990;
  animation: idris-pulse-ring-screen 1s ease-out forwards;
}

@media(prefers-reduced-motion:reduce) {
  .idris-screen-ripple {
    display: none;
  }
  .idris-ai-beacon {
    display: none;
  }
}
`}</style>

      {rippleSeq > 0 && (
        <span
          key={rippleSeq}
          className="idris-screen-ripple"
          aria-hidden="true"
        />
      )}

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
          className={`idris-ai-button idris-state-${uiState}`}
          onClick={open ? closeAssistant : handleAssistantClick}
          aria-label={open ? "Close AI Assistant" : "Ask AI"}
        >
          {!open && <span className="idris-ai-beacon" aria-hidden="true" />}

          <span className="idris-ring-dashed" aria-hidden="true" />

          <span className="idris-orbit" aria-hidden="true">
            {ORBIT_DOTS.map((i) => (
              <span key={i} className="idris-orbit-dot" style={{ "--i": i }} />
            ))}
          </span>

          <span className="idris-ai-icon">
            <span className="idris-icon-layer idris-icon-sparkle">
              <SparkleIcon />
            </span>
            <span className="idris-icon-layer idris-icon-mic">
              <MicIcon />
            </span>
            <span className="idris-icon-layer idris-icon-wave">
              <span className="idris-wave">
                <span />
                <span />
                <span />
                <span />
                <span />
              </span>
            </span>
          </span>

          <span className="idris-ai-close" aria-hidden="true">
            ×
          </span>

          {!open && <span className="idris-ai-tooltip">Ask AI</span>}
        </button>
      </div>
    </>
  );
}
