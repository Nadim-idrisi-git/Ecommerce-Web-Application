// Lightweight, dependency-free checks for product data quality - catches
// the kind of corruption that has happened in practice (a JSON-array
// string pasted into a comma-separated admin field, leaving literal
// brackets/quotes baked into array entries) plus generic structural
// problems, without pulling in a validation framework.
import { buildSearchableText } from "./buildSearchableText.js";
import { GENDERS, CATEGORIES } from "./productAttributes.js";

const JSON_ARTIFACT_PATTERN = /[[\]]|^["'].*["']$/;

const isCleanStringArray = (value) =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const arrayIssues = (fieldName, value) => {
  const issues = [];

  if (value === undefined) return issues;

  if (!Array.isArray(value)) {
    issues.push(`${fieldName} is not an array (got ${typeof value}).`);
    return issues;
  }

  value.forEach((item, index) => {
    if (Array.isArray(item)) {
      issues.push(`${fieldName}[${index}] is a nested array, expected a string.`);
    } else if (typeof item !== "string") {
      issues.push(`${fieldName}[${index}] is not a string (got ${typeof item}).`);
    } else if (JSON_ARTIFACT_PATTERN.test(item)) {
      issues.push(`${fieldName}[${index}] looks like a serialized JSON fragment: ${JSON.stringify(item)}.`);
    } else if (!item.trim()) {
      issues.push(`${fieldName}[${index}] is blank.`);
    }
  });

  return issues;
};

// Returns { valid, issues } - issues is always an array (empty when valid).
// Pure function, no DB access, so it can be reused by scripts, controllers,
// or ad-hoc checks without side effects.
export const validateProductData = (product) => {
  const issues = [];

  if (!product || typeof product !== "object") {
    return { valid: false, issues: ["Product is not an object."] };
  }

  if (!product.name || !String(product.name).trim()) issues.push("name is missing/blank.");
  if (!product.description || !String(product.description).trim()) issues.push("description is missing/blank.");
  if (!Number.isFinite(Number(product.price))) issues.push("price is missing or not a number.");
  if (!Array.isArray(product.images) || product.images.length === 0) issues.push("images is missing/empty.");

  if (!product.gender) {
    issues.push("gender is missing.");
  } else if (!GENDERS.includes(String(product.gender).toLowerCase())) {
    issues.push(`gender "${product.gender}" is not one of: ${GENDERS.join(", ")}.`);
  }

  if (!product.category) {
    issues.push("category is missing.");
  } else if (!CATEGORIES.includes(String(product.category).toLowerCase())) {
    issues.push(`category "${product.category}" is not one of: ${CATEGORIES.join(", ")}.`);
  }

  if (!isCleanStringArray(product.sizes) || product.sizes.length === 0) {
    issues.push("sizes must be a non-empty array of strings.");
  } else {
    issues.push(...arrayIssues("sizes", product.sizes));
  }

  if (product.color && product.color !== product.color.toLowerCase()) {
    issues.push(`color "${product.color}" is not stored lowercase.`);
  }

  ["features", "occasions", "seasons", "style"].forEach((field) => {
    issues.push(...arrayIssues(field, product[field]));
  });

  if (typeof product.searchableText === "string" && /\b(undefined|null)\b/.test(product.searchableText)) {
    issues.push("searchableText contains a literal 'undefined'/'null'.");
  }

  if (product.searchableText !== undefined) {
    const expected = buildSearchableText(product);
    if (product.searchableText !== expected) {
      issues.push("searchableText is stale - does not match buildSearchableText(product).");
    }
  }

  return { valid: issues.length === 0, issues };
};
