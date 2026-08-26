// Deterministic RAG eligibility gate. Deliberately NOT a keyword/NLP
// classifier - the existing assistant's own tool-selection call
// (controllers/intentController.js, via utils/assistantTools.js) already
// classifies a customer message into a specific intent (navigate, cart
// ops, order ops, search_products, recommend_products, ...) using the same
// Gemini call that's already made for every message. That existing,
// already-structured classification IS the "existing intent architecture"
// this reuses, rather than building a second, competing classifier out of
// fragile keyword matching.
//
// search_products/recommend_products are exactly the two existing intents
// that mean "the customer wants semantic product discovery/recommendation"
// - precisely RAG's job. Every other tool (navigate, add_to_cart,
// update_cart_quantity, remove_from_cart, place_order, cancel_order,
// track_order, sort_products, open_product) is a deterministic action/
// lookup that must keep using its existing tool-dispatch behavior
// unchanged - RAG never runs for those.
const RAG_ELIGIBLE_TOOLS = new Set(["search_products", "recommend_products"]);

export const isRagEligibleTool = (toolName) => RAG_ELIGIBLE_TOOLS.has(toolName);
