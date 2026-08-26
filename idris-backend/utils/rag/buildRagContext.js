// Pure, deterministic, DB/API-independent: converts already-ranked RAG
// candidates (from module 4's searchRag() or module 5's searchHybridRag(),
// both of which share the same sourceId/text/metadata shape) into a
// compact product-context block for generation.
import {
  RAG_GENERATION_MAX_CANDIDATES,
  RAG_GENERATION_MAX_CONTEXT_CHARS,
} from "./ragGenerationConfig.js";

const PRODUCT_DELIMITER = "\n\n---\n\n";

// candidate.text is already the full canonical buildSearchableText() output
// (name, gender, category, productType, color, material, fit, pattern,
// style, occasions, seasons, features, sizes, description) - reused as-is
// rather than re-deriving the same formatting a second time here. Only
// price/bestseller are added, since module 1 deliberately excludes price
// from the semantic text (see buildSearchableText.js's own rationale).
const formatCandidate = (candidate, position) => {
  const metadata = candidate.metadata || {};
  const price = Number.isFinite(Number(metadata.price)) ? Number(metadata.price) : null;

  return [
    `PRODUCT ${position + 1}`,
    `ID: ${candidate.sourceId}`,
    `PRICE: ${price !== null ? price : "not available"}`,
    `BESTSELLER: ${metadata.bestseller === true ? "true" : "false"}`,
    String(candidate.text || "").trim(),
  ].join("\n");
};

// Returns { context, includedCount, totalCandidates, truncated }.
// Truncation is deterministic and rank-preserving: candidates are consumed
// in the order given (never re-sorted), stops as soon as either the
// candidate-count cap or the character budget would be exceeded, and never
// includes a partially-cut block - each included PRODUCT section is always
// complete.
export const buildRagContext = (candidates) => {
  const list = Array.isArray(candidates) ? candidates : [];
  const withinCountLimit = list.slice(0, RAG_GENERATION_MAX_CANDIDATES);

  const blocks = [];
  let totalChars = 0;
  let truncated = withinCountLimit.length < list.length;

  for (const candidate of withinCountLimit) {
    if (!candidate || !candidate.sourceId || !String(candidate.text || "").trim()) {
      continue; // defensively skip malformed entries even though the caller should have filtered already
    }

    const block = formatCandidate(candidate, blocks.length);
    const addedLength = block.length + (blocks.length > 0 ? PRODUCT_DELIMITER.length : 0);

    if (totalChars + addedLength > RAG_GENERATION_MAX_CONTEXT_CHARS) {
      truncated = true;
      break;
    }

    blocks.push(block);
    totalChars += addedLength;
  }

  return {
    context: blocks.join(PRODUCT_DELIMITER),
    includedCount: blocks.length,
    totalCandidates: list.length,
    truncated,
  };
};
