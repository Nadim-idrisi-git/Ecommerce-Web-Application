// Deterministic, complete attribute matching over the whole catalog.
//
// Semantic retrieval (hybridSearchRag) ranks the top few products that
// "sound like" a query, which is right for vague requests ("party ke liye
// kuch") but wrong for a structured listing: "sabhi jackets dikhao" must
// return every jacket, not the top 8, and "blue jacket" must include light
// blue, navy blue and teal blue rather than only products whose colour is
// stored as exactly "blue". This module answers those requests exactly,
// from the real product records.

// Fields a structured listing can be filtered on, mapped to the product
// record field that holds them.
const SCALAR_FIELDS = {
  gender: "gender",
  category: "category",
  productType: "productType",
  color: "color",
  material: "material",
  fit: "fit",
  pattern: "pattern",
};

// Array fields on the product record (occasions/seasons/style).
const LIST_FIELDS = {
  occasion: "occasions",
  season: "seasons",
  style: "style",
};

export const STRUCTURED_FIELDS = Object.keys(SCALAR_FIELDS);

const normalizeWord = (word) =>
  word
    .replace(/colour/g, "color")
    .replace(/grey/g, "gray")
    .replace(/s$/, "");

const tokens = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeWord);

// "t-shirt" / "T-Shirt" / "tshirt" all compare equal.
const compact = (value) => tokens(value).join("");

// A requested value matches when every one of its words appears in the
// product's value: "blue" matches "light blue" and "navy blue", "cotton"
// matches "pure cotton" and "cotton blend", "relaxed" matches "relaxed fit".
// Product type, category and gender must match exactly - "shirt" must never
// match "t-shirt", and "men" must never match "women".
const EXACT_FIELDS = new Set(["gender", "category", "productType"]);

const valueMatches = (field, requested, actual) => {
  if (EXACT_FIELDS.has(field)) return compact(requested) === compact(actual);
  const want = tokens(requested);
  if (!want.length) return true;
  const have = new Set(tokens(actual));
  return want.every((word) => have.has(word));
};

const listMatches = (requested, actualList) =>
  Array.isArray(actualList) && actualList.some((item) => valueMatches("list", requested, item));

const productMatchesField = (product, field, requested) => {
  if (SCALAR_FIELDS[field]) return valueMatches(field, requested, product[SCALAR_FIELDS[field]]);
  if (LIST_FIELDS[field]) return listMatches(requested, product[LIST_FIELDS[field]]);
  return true;
};

// plan: buildShoppingQueryPlan() output (include / exclude / price).
// options.ignore: fields to drop from the include set (used to find the
// closest alternatives when nothing matches exactly).
// options.ignorePrice: drop the price constraint.
export const matchCatalog = (products, plan, { ignore = [], ignorePrice = false } = {}) => {
  const include = plan?.include || {};
  const exclude = plan?.exclude || {};
  const minPrice = ignorePrice ? null : plan?.price?.minPrice ?? null;
  const maxPrice = ignorePrice ? null : plan?.price?.maxPrice ?? null;

  return (products || []).filter((product) => {
    for (const [field, requested] of Object.entries(include)) {
      if (!requested || ignore.includes(field)) continue;
      if (!SCALAR_FIELDS[field] && !LIST_FIELDS[field]) continue;
      if (!productMatchesField(product, field, requested)) return false;
    }

    for (const [field, values] of Object.entries(exclude)) {
      if (!Array.isArray(values)) continue;
      if (values.some((value) => productMatchesField(product, field, value))) return false;
    }

    const price = Number(product.price);
    if (minPrice != null && !(price >= minPrice)) return false;
    if (maxPrice != null && !(price <= maxPrice)) return false;
    return true;
  });
};

export const hasStructuredConstraint = (plan) =>
  STRUCTURED_FIELDS.some((field) => Boolean(plan?.include?.[field]));

// When nothing matches, relax the softest constraints first (occasion,
// season, style - descriptive tags, often missing on a product), then colour,
// then the finer attributes - but never gender, category or product type: a
// customer asking for a men's jacket must never be offered a women's top.
const SOFT_FIELDS = ["occasion", "season", "style"];
const RELAXATION_ORDER = [
  SOFT_FIELDS,
  ["color"],
  ["pattern"],
  ["fit"],
  ["material"],
  [...SOFT_FIELDS, "color", "pattern", "fit", "material"],
];

export const findClosestAlternatives = (products, plan) => {
  for (const ignore of RELAXATION_ORDER) {
    if (!ignore.some((field) => plan?.include?.[field])) continue;
    const matches = matchCatalog(products, plan, { ignore });
    if (matches.length) return { relaxedFields: ignore.filter((field) => plan.include[field]), matches };
  }
  return { relaxedFields: [], matches: [] };
};

// Distinct values of one field among products, for telling the customer
// what IS available ("is jacket mein ye colours hain: ...").
export const distinctValues = (products, field) => {
  const key = SCALAR_FIELDS[field] || LIST_FIELDS[field] || field;
  return [...new Set((products || []).flatMap((product) => product[key] ?? []).filter(Boolean))];
};
