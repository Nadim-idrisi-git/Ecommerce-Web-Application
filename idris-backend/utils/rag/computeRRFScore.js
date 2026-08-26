// Reciprocal Rank Fusion. RRFScore = 1/(k + rank) per contributing rank
// list; a candidate missing from one list simply contributes 0 from that
// side rather than being penalized for it. Rank-based (not raw-score-based)
// fusion is deliberate - vector similarity and BM25-style lexical scores
// live in incomparable ranges/distributions, so summing them directly would
// let whichever score happens to be numerically larger dominate for no
// principled reason.
import { RAG_RRF_K } from "./hybridSearchConfig.js";

export const computeRRFScore = (vectorRank, lexicalRank, k = RAG_RRF_K) => {
  const vectorContribution = Number.isFinite(vectorRank) && vectorRank > 0 ? 1 / (k + vectorRank) : 0;
  const lexicalContribution = Number.isFinite(lexicalRank) && lexicalRank > 0 ? 1 / (k + lexicalRank) : 0;
  return vectorContribution + lexicalContribution;
};
