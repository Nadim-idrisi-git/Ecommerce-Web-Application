// Produces a compact, structured-first text block for each product,
// combining every controlled attribute with the free-text description. This
// is what a future embedding step would encode - keeping it server-generated
// (never admin-entered) means it can never drift out of sync with the
// structured fields it's built from.
const joinList = (label, list) =>
  Array.isArray(list) && list.length ? `${label}: ${list.join(", ")}.` : "";

// Built as blank-line-separated sections (name / attribute block /
// description) rather than a single filter(Boolean)'d line array - an
// empty string "" used as a blank-line separator is itself falsy, so
// filtering the whole thing in one flat array would silently swallow the
// separators along with the genuinely-absent attribute lines.
export const buildSearchableText = (product) => {
  const name = (product.name || "").trim();
  const description = (product.description || "").trim();

  const attributeLines = [
    product.gender && `Gender: ${product.gender}.`,
    product.category && `Category: ${product.category}.`,
    product.productType && `Product type: ${product.productType}.`,
    product.color && `Color: ${product.color}.`,
    product.material && `Material: ${product.material}.`,
    product.fit && `Fit: ${product.fit}.`,
    product.pattern && `Pattern: ${product.pattern}.`,
    joinList("Style", product.style),
    joinList("Occasions", product.occasions),
    joinList("Seasons", product.seasons),
    joinList("Features", product.features),
    joinList("Sizes", product.sizes),
  ].filter(Boolean);

  const sections = [
    name,
    attributeLines.join("\n"),
    description && `Description:\n${description}`,
  ].filter(Boolean);

  return sections.join("\n\n");
};
