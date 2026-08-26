// Pure, dependency-free vector validation - no Gemini/DB access, so this
// can be unit-tested directly (see scripts/testEmbeddingPipeline.js) and
// reused by both the generation utility (before returning a vector) and the
// validation script (before trusting a stored one).
export const validateEmbeddingVector = (vector, expectedDimension = null) => {
  const issues = [];

  if (!Array.isArray(vector)) {
    return { valid: false, issues: ["embedding is not an array."] };
  }

  if (vector.length === 0) {
    issues.push("embedding is empty.");
  }

  vector.forEach((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push(`embedding[${index}] is not a finite number (${JSON.stringify(value)}).`);
    }
  });

  if (expectedDimension !== null && vector.length > 0 && vector.length !== expectedDimension) {
    issues.push(`embedding has dimension ${vector.length}, expected ${expectedDimension}.`);
  }

  return { valid: issues.length === 0, issues };
};
