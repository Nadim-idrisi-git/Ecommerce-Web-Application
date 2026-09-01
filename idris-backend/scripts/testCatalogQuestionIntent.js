import { isCatalogQuestion } from "../utils/rag/catalogQuestionIntent.js";

const products = [
  { name: "Men Dark Wash Button-Front Denim Trucker Jacket" },
];

const cases = [
  ["What is the price of this jacket?", true],
  ["What material is Men Dark Wash Button-Front Denim Trucker Jacket?", true],
  ["Tell me about this dress", true],
  ["What is your return policy?", false],
  ["Track my order", false],
  ["Show me jackets", false],
  ["Tell me about the blue sky", false],
];

for (const [message, expected] of cases) {
  const actual = isCatalogQuestion(message, products);
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

console.log(`${cases.length} catalog-question intent tests passed.`);
