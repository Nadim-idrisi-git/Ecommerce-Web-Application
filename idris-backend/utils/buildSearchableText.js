// Produces a compact, structured-first text block for each product,
// combining every controlled attribute with the free-text description. This
// is what a future embedding step would encode - keeping it server-generated
// (never admin-entered) means it can never drift out of sync with the
// structured fields it's built from.
export const buildSearchableText = (product) => {
  const lines = [
    product.name,
    "",
    product.gender && `Gender: ${product.gender}.`,
    product.category && `Category: ${product.category}.`,
    product.productType && `Product type: ${product.productType}.`,
    product.color && `Color: ${product.color}.`,
    product.material && `Material: ${product.material}.`,
    product.fit && `Fit: ${product.fit}.`,
    product.pattern && `Pattern: ${product.pattern}.`,
    Array.isArray(product.style) && product.style.length && `Style: ${product.style.join(", ")}.`,
    Array.isArray(product.occasions) && product.occasions.length && `Occasions: ${product.occasions.join(", ")}.`,
    Array.isArray(product.seasons) && product.seasons.length && `Seasons: ${product.seasons.join(", ")}.`,
    Array.isArray(product.features) && product.features.length && `Features: ${product.features.join(", ")}.`,
    "",
    "Description:",
    product.description,
  ].filter(Boolean);

  return lines.join("\n");
};
