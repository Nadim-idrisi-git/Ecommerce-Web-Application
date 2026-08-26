// Deterministic, DB-free checks for utils/rag/buildRagDocument.js. Same
// pattern as scripts/testSearchableText.js - no test framework exists in
// this backend, so this uses only Node's built-in assert module.
//
//   node scripts/testRagDocument.js

import assert from "node:assert/strict";
import { buildSearchableText } from "../utils/buildSearchableText.js";
import { buildRagDocument } from "../utils/rag/buildRagDocument.js";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const product = {
  _id: "665f1a2b3c4d5e6f7a8b9c0d",
  name: "Women Off-Shoulder Floral Puff Sleeve Top",
  price: 100,
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
  bestseller: true,
  description: "A lightweight woven floral top with off-shoulder neckline and smocked puff sleeves.",
};

test("rag document text matches buildSearchableText(product) exactly", () => {
  const rag = buildRagDocument(product);
  assert.equal(rag.text, buildSearchableText(product));
});

test("sourceId/type/metadata are populated as expected, no embedding yet", () => {
  const rag = buildRagDocument(product);
  assert.equal(rag.sourceId, product._id);
  assert.equal(rag.type, "product");
  assert.deepEqual(rag.metadata, {
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
    price: 100,
    bestseller: true,
  });
  assert.equal(rag.embedding, undefined);
});

test("same product produces the same contentHash (determinism, no timestamp involved)", () => {
  const a = buildRagDocument({ ...product });
  const b = buildRagDocument({ ...product });
  assert.equal(a.contentHash, b.contentHash);
  assert.equal(a.contentHash, buildRagDocument({ ...product }).contentHash);
});

test("a relevant field change changes both text and contentHash", () => {
  const original = buildRagDocument(product);
  const changed = buildRagDocument({ ...product, color: "black" });
  assert.notEqual(changed.text, original.text);
  assert.notEqual(changed.contentHash, original.contentHash);
});

test("an irrelevant field (_id) does not change text/metadata/hash", () => {
  const a = buildRagDocument(product);
  const b = buildRagDocument({ ...product, _id: "different-id-but-same-attributes" });
  assert.equal(a.text, b.text);
  assert.deepEqual(a.metadata, b.metadata);
  assert.equal(a.contentHash, b.contentHash);
});

console.log(`\n${passed} test(s) passed.`);
