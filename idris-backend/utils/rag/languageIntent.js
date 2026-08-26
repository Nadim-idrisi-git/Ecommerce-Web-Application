// Deterministic response-language classification for RAG generation - NO
// Gemini call, NO DB call, synchronous, side-effect-free. Exists because
// letting the generation model infer the reply language itself (module 6's
// original approach) was empirically inconsistent for Hinglish queries
// whose content words are mostly English product vocabulary (see module 8's
// audit) - this removes the ambiguity by deciding deterministically in code
// and telling the model explicitly, rather than hoping it infers correctly.
export const RESPONSE_LANGUAGES = ["english", "hindi", "hinglish"];

const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;

// Hindi/Hinglish function-word and grammatical markers, in Roman script.
// Deliberately excludes a few forms from the illustrative list in the spec
// that are also extremely common standalone English words - including them
// would misclassify plain English queries as Hinglish:
//   - "me"  (English object pronoun: "show ME a jacket") - "mein" is used
//     instead, which has no common English-word collision.
//   - "do"  (English auxiliary verb: "DO you have this in blue?") - "karo"/
//     "kar" already cover the imperative "do/give" sense unambiguously.
// This is a deliberate precision-over-recall choice: a false "hinglish"
// classification on a pure English query is exactly the failure mode this
// module exists to eliminate.
const HINDI_MARKER_WORDS = [
  "mujhe", "mera", "meri", "mere", "hamein", "humein",
  "aap", "aapko", "aapka", "aapki", "aapke", "tum", "tumhe",
  "chahiye", "chahiyen", "dikhao", "dikha", "dikhana", "dikhaiye",
  "batao", "bataiye", "karo", "kar", "kijiye",
  "ke", "ki", "ka", "liye", "mein", "se", "par", "tak",
  "andar", "wala", "wali", "wale", "waala", "waali", "waale",
  "hai", "hain", "ho", "hoga", "hogi", "honge",
  "kya", "kaise", "kaisa", "kaisi", "kitna", "kitni", "kitne",
  "nahi", "nahin", "haan", "accha", "acha", "theek", "thik",
  "bhi", "koi", "kuch", "abhi", "zaroor", "jaldi",
];

const HINDI_MARKER_SET = new Set(HINDI_MARKER_WORDS);

const tokenize = (text) => text.toLowerCase().match(/[a-z']+/g) || [];

// Deterministic language instructions - the ONLY values a generation
// prompt ever receives for this, keyed by the closed RESPONSE_LANGUAGES
// enum. Never accepts free text, so a caller/product-data string can never
// become "the language instruction" no matter what it says - see
// getLanguageInstruction() below, which only ever indexes this object by a
// value detectResponseLanguage() itself produced.
const LANGUAGE_INSTRUCTIONS = {
  english: "Respond only in English.",
  hindi: "Respond only in Hindi, written in Devanagari script.",
  hinglish:
    "Respond naturally in Hinglish - Hindi and English mixed together in Roman script, the way the customer wrote their message - not in pure Hindi and not in pure English.",
};

const SHARED_INSTRUCTION_SUFFIX =
  " Keep product names, attributes, colors, materials, sizes, and prices exactly as they appear in the retrieved product data - never translate them, regardless of the response language.";

// query: string -> { language: "english"|"hindi"|"hinglish", confidence: number }
//
// Rules (in order):
// 1. Any Devanagari character present -> "hindi", regardless of any Latin
//    product terms mixed in (e.g. a brand name) - Devanagari script itself
//    is the strongest possible signal, per the module's own examples.
// 2. Otherwise, tokenize the (Latin-script) text and check for Hindi/
//    Hinglish function-word markers. Even ONE such marker present makes it
//    "hinglish" - product vocabulary (black, purple, jacket, cotton, top,
//    women, summer, ...) never counts as a marker, so a query built almost
//    entirely from English product words but containing a single Hindi
//    grammatical marker (e.g. "mujhe black jacket chahiye") is correctly
//    "hinglish", not "english".
// 3. No Devanagari and no markers at all -> "english".
export const detectResponseLanguage = (query) => {
  const text = String(query || "").trim();

  if (!text) {
    return { language: "english", confidence: 0 };
  }

  if (DEVANAGARI_PATTERN.test(text)) {
    const latinTokenCount = tokenize(text).length;
    // Still confidently "hindi" even with some Latin words mixed in
    // (e.g. a Roman-script brand/product name) - Devanagari presence
    // dominates the classification by design.
    const confidence = latinTokenCount === 0 ? 1 : 0.9;
    return { language: "hindi", confidence };
  }

  const tokens = tokenize(text);
  const markerCount = tokens.filter((token) => HINDI_MARKER_SET.has(token)).length;

  if (markerCount === 0) {
    return { language: "english", confidence: tokens.length > 0 ? 1 : 0 };
  }

  const confidence = Math.min(1, 0.6 + markerCount * 0.15);
  return { language: "hinglish", confidence };
};

// Only ever called with a value detectResponseLanguage() itself returned
// (see generateRagAnswer.js) - never with caller/product-data-supplied
// text. Falls back to English for any unrecognized value rather than
// throwing, since a broken language string must never break answer
// generation entirely.
export const getLanguageInstruction = (language) => {
  const instruction = LANGUAGE_INSTRUCTIONS[language] || LANGUAGE_INSTRUCTIONS.english;
  return `${instruction}${SHARED_INSTRUCTION_SUFFIX}`;
};
