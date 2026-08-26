// Deterministic, DB-free checks for buildSearchableText()/validateProductData().
// No test framework exists in this backend yet, so this uses only Node's
// built-in assert module rather than adding one as a dependency.
//
//   node scripts/testSearchableText.js

import assert from "node:assert/strict";
import { buildSearchableText } from "../utils/buildSearchableText.js";
import { validateProductData } from "../utils/validateProductData.js";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

// The exact product from the spec's worked example.
const fullProduct = {
  name: "Women Off-Shoulder Floral Puff Sleeve Top",
  gender: "Women",
  category: "Topwear",
  productType: "Top",
  color: "purple multicolor",
  material: "Cotton",
  fit: "Regular",
  pattern: "Floral",
  features: ["Off-the-shoulder", "Short puff sleeves", "Smocked cuffs", "Floral print"],
  occasions: ["Casual"],
  seasons: ["Summer", "Spring"],
  style: ["Casual"],
  sizes: ["S", "M", "L"],
  description: "A lightweight woven floral top with off-shoulder neckline and smocked puff sleeves.",
};

test("full product produces the expected clean text block", () => {
  const text = buildSearchableText(fullProduct);
  assert.equal(
    text,
    [
      "Women Off-Shoulder Floral Puff Sleeve Top",
      "",
      "Gender: Women.",
      "Category: Topwear.",
      "Product type: Top.",
      "Color: purple multicolor.",
      "Material: Cotton.",
      "Fit: Regular.",
      "Pattern: Floral.",
      "Style: Casual.",
      "Occasions: Casual.",
      "Seasons: Summer, Spring.",
      "Features: Off-the-shoulder, Short puff sleeves, Smocked cuffs, Floral print.",
      "Sizes: S, M, L.",
      "",
      "Description:",
      "A lightweight woven floral top with off-shoulder neckline and smocked puff sleeves.",
    ].join("\n"),
  );
});

test("multiple features render as natural comma-separated text, not JSON", () => {
  const text = buildSearchableText({ ...fullProduct, features: ["Feature A", "Feature B", "Feature C"] });
  assert.match(text, /Features: Feature A, Feature B, Feature C\./);
  assert.doesNotMatch(text, /\[|\]|"/);
});

test("missing optional fields do not produce undefined/null garbage", () => {
  const minimal = {
    name: "Basic Tee",
    gender: "Men",
    category: "Topwear",
    sizes: ["M"],
    description: "A basic tee.",
  };
  const text = buildSearchableText(minimal);
  assert.doesNotMatch(text, /undefined/i);
  assert.doesNotMatch(text, /\bnull\b/i);
  assert.equal(text, "Basic Tee\n\nGender: Men.\nCategory: Topwear.\nSizes: M.\n\nDescription:\nA basic tee.");
});

test("output is deterministic - same input twice gives the same output", () => {
  const a = buildSearchableText(fullProduct);
  const b = buildSearchableText({ ...fullProduct });
  assert.equal(a, b);
});

test("empty description does not leave a dangling 'Description:' label", () => {
  const text = buildSearchableText({ name: "X", gender: "Men", category: "Topwear", sizes: ["M"], description: "" });
  assert.doesNotMatch(text, /Description:/);
});

test("validateProductData flags a clean product as valid", () => {
  const product = { ...fullProduct, images: ["https://example.com/a.png"], price: 100 };
  const { valid, issues } = validateProductData({ ...product, searchableText: buildSearchableText(product) });
  assert.equal(valid, true, `expected valid, got issues: ${issues.join("; ")}`);
});

test("validateProductData detects serialized-JSON artifacts in features", () => {
  const product = {
    ...fullProduct,
    images: ["https://example.com/a.png"],
    price: 100,
    features: ['["Off-the-shoulder"', '"Short puff sleeves"', '"Smocked cuffs"]'],
  };
  const { valid, issues } = validateProductData(product);
  assert.equal(valid, false);
  assert.ok(issues.some((issue) => issue.includes("features[0]")));
});

test("validateProductData detects stale searchableText", () => {
  const product = { ...fullProduct, images: ["https://example.com/a.png"], price: 100, searchableText: "stale text" };
  const { valid, issues } = validateProductData(product);
  assert.equal(valid, false);
  assert.ok(issues.some((issue) => issue.includes("stale")));
});

console.log(`\n${passed} test(s) passed.`);
