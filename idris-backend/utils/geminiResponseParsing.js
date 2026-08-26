// Shared, pure Gemini function-call/text-reply parsing helpers. Used by both
// the existing first tool-selection call (controllers/intentController.js)
// and MODULE 14's re-plan call (utils/agentOrchestrator.js) so both parse a
// generateContent response identically instead of maintaining two copies.
// Extracted from intentController.js - behavior is byte-for-byte unchanged,
// only the location moved.

// Structural marker the model must prefix an ambiguous-reference clarifying
// question with, and nothing else - lets a response be parsed
// deterministically into "still needs an answer from the customer" vs "this
// is the final answer", instead of guessing from free text.
export const CLARIFY_PREFIX = "CLARIFY:";

export const extractFunctionCall = (response) => {
  if (response.functionCalls?.length) {
    return response.functionCalls[0];
  }

  const parts = response.candidates?.[0]?.content?.parts || [];
  const part = parts.find((item) => item.functionCall);
  return part?.functionCall || null;
};

export const extractReplyText = (response) => {
  const direct = response.text?.trim();
  if (direct) return direct;

  const parts = response.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || "").join("").trim();
};
