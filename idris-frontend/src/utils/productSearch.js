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

// category/subCategory are controlled facet values (Men/Women/Kids,
// Topwear/Bottomwear/Winterwear), not free text - they need an exact match
// against the product's actual field, not a substring scan. Folding them
// into the same haystack as name/description used to mean "men" scored a
// hit on any "Women" product too, since the substring "men" literally
// appears inside "women" (wo-MEN).
const STRUCTURED_FACET_VALUES = new Set([
  "men",
  "women",
  "kids",
  "topwear",
  "bottomwear",
  "winterwear",
]);

const productHaystack = (product) =>
  [product.name, product.description]
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
    const category = (product.category || "").toLowerCase();
    const subCategory = (product.subCategory || "").toLowerCase();

    const score = keywords.reduce((total, word) => {
      if (STRUCTURED_FACET_VALUES.has(word)) {
        return total + (word === category || word === subCategory ? 1 : 0);
      }
      return total + (haystack.includes(word) ? 1 : 0);
    }, 0);

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
