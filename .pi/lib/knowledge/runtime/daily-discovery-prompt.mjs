// @ts-nocheck
import {
  DAILY_DISCOVERY_LIMITS
} from "./chunks/chunk-EFQIVCL3.mjs";

// packages/knowledge/src/daily-discovery-prompt.ts
var DAILY_DISCOVERY_SYSTEM = [
  "You are a research colleague looking for ideas the user has not considered.",
  "You get notes that were added or changed recently (NEW) and older related notes (OLD) from the user's knowledge base.",
  "Find connections between NEW and OLD: a contradiction between sources, a combination nobody has studied, a method that transfers from another field, a default assumption worth challenging, or the next implication of a conclusion.",
  "Keep only ideas that are new (not already stated in the notes), grounded (rest on specific notes given here) and testable (an experiment, dataset or analysis could confirm or refute them).",
  `Return ONLY a JSON array with at most ${DAILY_DISCOVERY_LIMITS.maxIdeas} objects: {"title": short title, "idea": one or two sentences, "basis": [note paths from the input], "test": how to test it, "whyOverlooked": why it may have been missed}.`,
  "Write title, idea, test and whyOverlooked in the language of the notes. If nothing passes all three checks, return []. Never invent a note path, paper or number."
].join("\n");
function buildDailyDiscoveryMessage(fresh, related) {
  const block = (note) => `### ${note.path}
${note.text}`;
  return [
    "NEW notes:",
    ...fresh.map(block),
    "",
    "OLD related notes:",
    ...related.length ? related.map(block) : ["(none found)"]
  ].join("\n\n");
}
function firstJsonArray(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
}
function parseDailyIdeas(text, allowedPaths, freshPaths) {
  const allowed = new Set(allowedPaths);
  const fresh = new Set(freshPaths);
  const raw = firstJsonArray(text);
  if (!Array.isArray(raw)) return [];
  const ideas = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item;
    const str = (key, max) => typeof value[key] === "string" ? value[key].trim().slice(0, max) : "";
    const basis = [];
    for (const path of Array.isArray(value.basis) ? value.basis : [])
      if (typeof path === "string" && allowed.has(path) && !basis.includes(path)) basis.push(path);
    const idea = {
      title: str("title", 160),
      idea: str("idea", 1200),
      basis,
      test: str("test", 800),
      whyOverlooked: str("whyOverlooked", 600)
    };
    if (!idea.title || !idea.idea || !idea.test || !basis.some((path) => fresh.has(path))) continue;
    ideas.push(idea);
    if (ideas.length >= DAILY_DISCOVERY_LIMITS.maxIdeas) break;
  }
  return ideas;
}
export {
  DAILY_DISCOVERY_SYSTEM,
  buildDailyDiscoveryMessage,
  parseDailyIdeas
};
