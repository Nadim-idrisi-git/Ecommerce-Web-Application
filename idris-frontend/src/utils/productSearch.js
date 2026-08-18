// Shared best-effort product matching for AI/voice-driven search, used by
// both AIAssistant (to count/speak results) and Collection (to display them)
// so the two stay in sync.
//
// The catalog doesn't carry every facet the assistant can extract (e.g.
// there's no `color` field on products at all). A strict AND filter across
// query/category/color/price means one unsupported keyword (like "black")
// zeroes out every result, even when the rest of the request (jacket,
// winter, men) genuinely matches real products. Instead, every keyword is
// scored against each product's text - a keyword nothing matches simply
// contributes nothing, rather than excluding everything.

const productHaystack = (product) =>
  [product.name, product.description, product.category, product.subCategory]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

export const buildSearchKeywords = (filters = {}) => {
  const words = [
    ...(filters.query || "").toLowerCase().split(/\s+/),
    filters.category,
    filters.color,
  ]
    .filter(Boolean)
    .map((word) => word.toLowerCase().trim())
    .filter((word) => word.length > 1);

  return [...new Set(words)];
};

export const scoreProducts = (products, keywords) =>
  products.map((product) => {
    const haystack = productHaystack(product);
    const score = keywords.filter((word) => haystack.includes(word)).length;
    return { product, score };
  });

const hasMaxPrice = (maxPrice) =>
  maxPrice !== null && maxPrice !== undefined && maxPrice !== "";

// Returns products ranked by how many of the requested keywords they match
// (most relevant first). If keywords were given but none matched anything,
// returns an empty list - intentionally, so the UI shows "no results"
// instead of silently falling back to the entire catalog. maxPrice is
// treated as a hard constraint (an explicit budget), not a soft signal.
export const searchProducts = (products, filters = {}) => {
  const keywords = buildSearchKeywords(filters);

  let results;

  if (keywords.length) {
    results = scoreProducts(products, keywords)
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.product);
  } else {
    results = products.slice();
  }

  if (hasMaxPrice(filters.maxPrice)) {
    results = results.filter((product) => Number(product.price) <= Number(filters.maxPrice));
  }

  return results;
};
