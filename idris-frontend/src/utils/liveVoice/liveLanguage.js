// Which language Zara should answer in, decided deterministically from the
// customer's own transcribed words and attached to every live tool result.
//
// Why this exists: tool results and product names are English, and Hinglish
// speakers drop in English phrases all the time ("okay", "thank you", "show
// me", sizes, prices). Left to itself the model treated those as a switch to
// English mid-conversation, then switched back on the next question. The
// rule here mirrors the system prompt (idris-backend/utils/liveVoiceConfig.js):
// Hinglish unless the customer has spoken two complete English sentences in
// a row with no Hindi at all.

const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;

// Roman-script Hindi function words. Mirrors the backend's
// utils/rag/languageIntent.js list, plus conversational words that list
// (built for typed product searches) doesn't need. Words that are also
// common English ("do", "to", "ya") are deliberately left out.
const HINDI_MARKERS = new Set([
  "mujhe", "mera", "meri", "mere", "hamein", "humein", "hum", "main",
  "aap", "aapko", "aapka", "aapki", "aapke", "tum", "tumhe",
  "chahiye", "chahiyen", "dikhao", "dikha", "dikhana", "dikhaiye", "dekho", "dekhna",
  "batao", "bataiye", "karo", "kar", "kijiye", "karna", "karni", "dena", "daal", "daalo",
  "ke", "ki", "ka", "liye", "mein", "se", "par", "tak", "andar",
  "wala", "wali", "wale", "waala", "waali", "waale",
  "hai", "hain", "ho", "hoga", "hogi", "honge", "hoon", "hun", "tha", "thi",
  "kya", "kaise", "kaisa", "kaisi", "kitna", "kitni", "kitne", "kahan", "kab", "kyun",
  "kaunsa", "konsa", "kaunsi", "konsi", "sabse",
  "nahi", "nahin", "haan", "ji", "accha", "acha", "achha", "theek", "thik",
  "bhi", "koi", "kuch", "abhi", "zaroor", "jaldi", "bas", "itna", "thoda",
  "aur", "toh", "yeh", "ye", "woh", "isme", "usme", "inmein", "wahi", "yahi",
  "chalega", "matlab", "bhaiya", "didi", "shukriya", "dhanyavaad",
]);

const romanTokens = (text) => String(text || "").toLowerCase().match(/[a-z']+/g) || [];

// "english" only for a complete English sentence: at least four Roman words,
// no Devanagari and no Hindi marker. Short phrases ("thank you", "okay",
// "size M") never count as English on their own.
export const classifyUtterance = (text) => {
  const value = String(text || "").trim();
  if (!value) return "unknown";
  if (DEVANAGARI_PATTERN.test(value)) return "hindi";
  const tokens = romanTokens(value);
  if (tokens.some((token) => HINDI_MARKERS.has(token))) return "hinglish";
  return tokens.length >= 4 ? "english" : "unknown";
};

// utterances: the customer's turns, oldest first, current one last.
export const decideReplyLanguage = (utterances) => {
  const spoken = (utterances || []).filter((text) => String(text || "").trim());
  const recent = spoken.slice(-2).map(classifyUtterance);
  return recent.length === 2 && recent.every((kind) => kind === "english") ? "english" : "hinglish";
};

const REPLY_LANGUAGE_TEXT = {
  hinglish:
    "Hinglish - reply in natural spoken Hinglish (Hindi sentences with everyday English shopping words), every sentence. Do not switch to English.",
  english:
    "English - the customer is speaking English; reply in natural Indian English. Switch back to Hinglish as soon as they use Hindi.",
};

export const withReplyLanguage = (response, utterances) => ({
  ...(response || {}),
  replyLanguage: REPLY_LANGUAGE_TEXT[decideReplyLanguage(utterances)],
});
