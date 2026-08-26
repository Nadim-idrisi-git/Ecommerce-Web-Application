import crypto from "node:crypto";
import { buildSearchableText } from "../buildSearchableText.js";

// Metadata carries only what a retrieval step needs for exact filtering and
// for returning structured info without a second Product lookup - not a
// replacement for the Product collection (no images, __v, description, etc).
const buildMetadata = (product) => ({
  gender: product.gender || "",
  category: product.category || "",
  productType: product.productType || "",
  color: product.color || "",
  material: product.material || "",
  fit: product.fit || "",
  pattern: product.pattern || "",
  features: Array.isArray(product.features) ? product.features : [],
  occasions: Array.isArray(product.occasions) ? product.occasions : [],
  seasons: Array.isArray(product.seasons) ? product.seasons : [],
  style: Array.isArray(product.style) ? product.style : [],
  sizes: Array.isArray(product.sizes) ? product.sizes : [],
  price: Number.isFinite(Number(product.price)) ? Number(product.price) : null,
  bestseller: Boolean(product.bestseller),
});

// Deterministic by construction: fixed key order above means JSON.stringify
// is stable for the same input, and nothing time-based (Date.now(), a
// random id, etc.) ever enters the hashed payload - the same product fields
// always produce the same hash, run today or run next year.
const buildContentHash = (text, metadata) =>
  crypto.createHash("sha256").update(JSON.stringify({ text, metadata })).digest("hex");

// Product -> RAG document. Reuses buildSearchableText() for `text` rather
// than re-deriving semantic text here - this is the only place that
// transformation should happen.
export const buildRagDocument = (product) => {
  const text = buildSearchableText(product);
  const metadata = buildMetadata(product);

  return {
    sourceId: product._id,
    type: "product",
    text,
    metadata,
    contentHash: buildContentHash(text, metadata),
  };
};
