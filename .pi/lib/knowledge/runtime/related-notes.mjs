// @ts-nocheck
import {
  getKnowledgeService
} from "./chunks/chunk-V6PECWHO.mjs";
import "./chunks/chunk-6YLIZTKN.mjs";
import "./chunks/chunk-6LT3KQRY.mjs";
import "./chunks/chunk-OWE2DUY5.mjs";
import "./chunks/chunk-O536IQIE.mjs";
import "./chunks/chunk-H6MOV67K.mjs";
import "./chunks/chunk-RCUF5QK4.mjs";
import "./chunks/chunk-4VUDROQV.mjs";
import {
  readKnowledgeBinding,
  withKnowledgeBinding
} from "./chunks/chunk-CXEKIGAQ.mjs";
import "./chunks/chunk-AHEUR5VB.mjs";

// packages/knowledge/src/related-notes.ts
async function findRelatedNotes(title, limit = 5) {
  const query = String(title || "").trim().slice(0, 120);
  if (!query) return [];
  try {
    const binding = await readKnowledgeBinding();
    if (!binding) return [];
    const service = await getKnowledgeService();
    const found = await withKnowledgeBinding(
      binding,
      () => service.request("search", { query, limit: limit + 2, project: "" })
    );
    const wanted = query.toLowerCase();
    const paths = [];
    for (const hit of found?.hits ?? []) {
      if (hit.kind === "explainer" || hit.kind === "navigation") continue;
      if (String(hit.title || "").trim().toLowerCase() === wanted) continue;
      paths.push(hit.path);
      if (paths.length >= limit) break;
    }
    return paths;
  } catch {
    return [];
  }
}
function appendRelatedLinks(markdown, paths) {
  const text = String(markdown || "");
  const fresh = paths.filter((path) => !text.includes(`[[${path.replace(/\.md$/, "")}`));
  if (!fresh.length) return text;
  return `${text.trimEnd()}

## \u76F8\u5173\u7B14\u8BB0
${fresh.map((path) => `- [[${path.replace(/\.md$/, "")}]]`).join("\n")}
`;
}
export {
  appendRelatedLinks,
  findRelatedNotes
};
