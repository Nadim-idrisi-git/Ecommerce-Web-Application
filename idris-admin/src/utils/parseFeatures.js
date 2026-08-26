// Parses the Features input: normally comma-separated plain text, but if
// someone pastes a JSON-array-formatted string (e.g. from an AI-generated
// description) it's parsed as JSON instead of comma-splitting it verbatim -
// a naive split on "," would otherwise leave literal brackets/quotes stuck
// to the boundary entries (["Square neckline" -> "[\"Square neckline\"").
export const parseFeaturesInput = (raw) => {
  const trimmed = (raw || "").trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch {
      // Not valid JSON - fall through and treat as plain comma-separated
      // text with the outer brackets stripped.
    }
  }

  return trimmed
    .replace(/^\[+/, "")
    .replace(/\]+$/, "")
    .split(",")
    .map((item) => item.trim().replace(/^["']+/, "").replace(/["']+$/, "").trim())
    .filter(Boolean);
};
