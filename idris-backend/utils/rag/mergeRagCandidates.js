// Pure merge/dedup step: takes the two already-ranked recall result arrays
// (vector and lexical, each ordered best-first) and combines them into one
// candidate list keyed by sourceId - the ONLY dedup key used (never name,
// never array position, per module 5's explicit instruction). A candidate
// present in both branches keeps both ranking signals; one present in only
// one branch keeps only that signal (the other stays null).
export const mergeRagCandidates = (vectorResults = [], lexicalResults = []) => {
  const bySourceId = new Map();

  vectorResults.forEach((doc, index) => {
    const key = String(doc.sourceId);
    bySourceId.set(key, {
      sourceId: doc.sourceId,
      type: doc.type,
      text: doc.text,
      metadata: doc.metadata,
      vectorRank: index + 1,
      vectorScore: doc.score,
      lexicalRank: null,
      lexicalScore: null,
    });
  });

  lexicalResults.forEach((doc, index) => {
    const key = String(doc.sourceId);
    const existing = bySourceId.get(key);

    if (existing) {
      existing.lexicalRank = index + 1;
      existing.lexicalScore = doc.lexicalScore;
    } else {
      bySourceId.set(key, {
        sourceId: doc.sourceId,
        type: doc.type,
        text: doc.text,
        metadata: doc.metadata,
        vectorRank: null,
        vectorScore: null,
        lexicalRank: index + 1,
        lexicalScore: doc.lexicalScore,
      });
    }
  });

  return [...bySourceId.values()];
};
