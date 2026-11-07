"use strict";

/**
 * Local retrieval over the user's own stored messages. Deliberately simple and
 * explainable: term overlap with a length normaliser, newest first on ties.
 * No embeddings, no network, no hidden scoring.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "done",
  "of", "to", "in", "on", "at", "for", "with", "about", "as", "by", "from", "into", "over",
  "it", "its", "i", "me", "my", "we", "our", "you", "your", "he", "she", "they", "them",
  "what", "which", "who", "whom", "when", "where", "why", "how", "can", "could", "would",
  "should", "will", "shall", "may", "might", "must", "have", "has", "had", "not", "no",
  "so", "just", "very", "also", "please", "thanks", "ok", "okay", "there", "here",
]);

function tokenise(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9'-]*/g) || [];
}

function meaningfulTerms(text) {
  return tokenise(text).filter((term) => term.length > 1 && !STOPWORDS.has(term));
}

function scorePassage(passage, terms) {
  const content = String((passage && passage.content) || "").toLowerCase();
  if (!content) return 0;
  let hits = 0;
  for (const term of terms) {
    let index = content.indexOf(term);
    let occurrences = 0;
    while (index !== -1 && occurrences < 4) {
      occurrences += 1;
      index = content.indexOf(term, index + term.length);
    }
    hits += occurrences;
  }
  if (!hits) return 0;
  // Longer passages are not automatically better; divide by a mild length factor.
  const lengthFactor = 1 + Math.min(content.length, 4000) / 4000;
  return hits / lengthFactor;
}

function rankPassages({ passages = [], query = "", limit = 6, excludeMessageIds = [] } = {}) {
  const terms = meaningfulTerms(query);
  if (!terms.length) return [];
  const excluded = new Set(excludeMessageIds);
  const scored = [];
  for (const passage of passages) {
    if (!passage || excluded.has(passage.message_id)) continue;
    const score = scorePassage(passage, terms);
    if (score > 0) scored.push({ ...passage, score: Math.round(score * 1000) / 1000 });
  }
  scored.sort((a, b) => b.score - a.score || (b.created_at || 0) - (a.created_at || 0));
  const seen = new Set();
  const picked = [];
  for (const item of scored) {
    const fingerprint = String(item.content).slice(0, 160);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    picked.push(item);
    if (picked.length >= limit) break;
  }
  return picked;
}

module.exports = { tokenise, meaningfulTerms, scorePassage, rankPassages, STOPWORDS };