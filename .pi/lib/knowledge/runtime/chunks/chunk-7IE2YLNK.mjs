// @ts-nocheck
// packages/knowledge/src/search-policy.ts
function tokenizeKnowledgeText(text) {
  const words = String(text).normalize("NFKC").toLowerCase().match(/[a-z0-9][a-z0-9._+-]*|[\p{Script=Han}]+/gu) || [];
  const output = [];
  for (const word of words) {
    if (/\p{Script=Han}/u.test(word)) {
      const characters = [...word];
      for (let index = 0; index < characters.length; index++) {
        const character = characters[index];
        if (!character) continue;
        output.push(character);
        const next = characters[index + 1];
        if (next) output.push(character + next);
      }
    } else output.push(word);
  }
  return output;
}
function buildKnowledgeSearchExpression(query) {
  if (typeof query !== "string" || !query.trim() || query.length > 2e3)
    throw new Error("Query must contain 1\u20132000 characters");
  const terms = [...new Set(tokenizeKnowledgeText(query))].slice(0, 32);
  if (!terms.length) throw new Error("Query has no searchable terms");
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}
function splitKnowledgeChunks(text, maxChars = 1200) {
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 8e3)
    throw new Error("Semantic chunk size must be an integer between 1 and 8000");
  const chunks = [];
  for (let start = 0; start < text.length; start += maxChars)
    chunks.push(text.slice(start, start + maxChars));
  return chunks;
}

export {
  tokenizeKnowledgeText,
  buildKnowledgeSearchExpression,
  splitKnowledgeChunks
};
