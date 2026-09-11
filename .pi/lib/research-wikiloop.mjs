import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { loadWorkspaceConfig } from "../extensions/workspace-config.mjs";
import { initializeVaultLayout, MANAGED_END, MANAGED_START } from "./vault-layout.mjs";
import { refreshProjectIndexes } from "./obsidian-workbench.mjs";

const MAX_QUERY_TERMS = 64;
const MAX_PAGE_BYTES = 256 * 1024;
const MAX_TOP_K = 12;

function validateSegment(value, label) {
  const text = String(value ?? "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)) throw new Error(`${label} must be lowercase kebab-case`);
  return text;
}

function normalize(text) {
  return String(text ?? "").normalize("NFKC").toLowerCase();
}

export function queryTerms(query) {
  const text = normalize(query);
  const terms = new Set(text.match(/[a-z0-9][a-z0-9._+-]*/g) || []);
  for (const chunk of text.match(/[\p{Script=Han}]+/gu) || []) {
    if (chunk.length <= 2) terms.add(chunk);
    else {
      terms.add(chunk);
      for (let i = 0; i < chunk.length - 1; i += 1) terms.add(chunk.slice(i, i + 2));
    }
  }
  return [...terms].filter(Boolean).slice(0, MAX_QUERY_TERMS);
}

async function readText(path) {
  try { return await readFile(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function walkMarkdown(root) {
  const out = [];
  let entries = [];
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return out; throw error; }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...await walkMarkdown(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(path);
  }
  return out;
}

function titleOf(path, text) {
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(path, ".md");
}

function scorePage(query, terms, title, text) {
  const q = normalize(query);
  const heading = normalize(title);
  const body = normalize(text);
  let score = q && heading.includes(q) ? 24 : q && body.includes(q) ? 12 : 0;
  for (const term of terms) {
    if (heading.includes(term)) score += 5;
    const occurrences = body.split(term).length - 1;
    score += Math.min(occurrences, 8);
  }
  return score;
}

function excerptFor(text, terms) {
  const plain = text.replace(/^---[\s\S]*?---\s*/m, "").replace(/<!--[^]*?-->/g, " ").replace(/\s+/g, " ").trim();
  const lower = normalize(plain);
  let index = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found >= 0 && (index < 0 || found < index)) index = found;
  }
  const start = Math.max(0, index < 0 ? 0 : index - 100);
  return plain.slice(start, start + 420);
}

function wikiRoot(vault, project) {
  return join(vault, "Projects", project, "Wiki");
}

export async function navigateResearchWiki({ cwd = process.cwd(), project, query, topK = 5 } = {}) {
  project = validateSegment(project, "project");
  if (typeof query !== "string" || !query.trim()) throw new Error("query is required");
  topK = Math.max(1, Math.min(MAX_TOP_K, Number(topK) || 5));
  const config = await loadWorkspaceConfig(cwd);
  if (!config.obsidianVault) return { configured: false, project, query, hits: [], total_pages: 0 };
  const root = wikiRoot(config.obsidianVault, project);
  const terms = queryTerms(query);
  const pages = [];
  for (const path of await walkMarkdown(root)) {
    const text = await readText(path);
    if (!text) continue;
    const title = titleOf(path, text);
    const score = scorePage(query, terms, title, text);
    if (score > 0) pages.push({ path, title, score, excerpt: excerptFor(text, terms) });
  }
  pages.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return { configured: true, project, query, terms, total_pages: (await walkMarkdown(root)).length, hits: pages.slice(0, topK).map((hit, i) => ({ ...hit, rank: i + 1 })) };
}

function managedBody({ content, sourceRefs, relatedPages }) {
  const sources = sourceRefs.length ? sourceRefs.map(value => `- ${value}`).join("\n") : "- Unverified: no source reference supplied";
  const related = relatedPages.length ? `\n\n## Related Wiki pages\n${relatedPages.map(value => `- [[${value}]]`).join("\n")}` : "";
  return `${String(content).trim()}\n\n## Evidence references\n${sources}${related}`;
}

function updateManaged(original, replacement) {
  const start = original.indexOf(MANAGED_START);
  const end = original.indexOf(MANAGED_END);
  if (start < 0 && end < 0) return `${original.trimEnd()}\n\n${MANAGED_START}\n${replacement}\n${MANAGED_END}\n`;
  if (start < 0 || end < start) throw new Error("invalid managed block markers");
  return `${original.slice(0, start)}${MANAGED_START}\n${replacement}\n${MANAGED_END}${original.slice(end + MANAGED_END.length)}`;
}

async function atomicText(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, text, "utf8");
  await rename(temp, path);
}

function rankFor(result, path) {
  return result.hits.find(hit => resolve(hit.path) === resolve(path))?.rank ?? null;
}

export async function buildResearchWikiPage({ cwd = process.cwd(), project, slug, title, content, sourceRefs = [], relatedPages = [], validationQuery } = {}) {
  project = validateSegment(project, "project");
  slug = validateSegment(slug, "slug");
  if (typeof title !== "string" || !title.trim()) throw new Error("title is required");
  if (typeof content !== "string" || !content.trim()) throw new Error("content is required");
  if (Buffer.byteLength(content, "utf8") > MAX_PAGE_BYTES) throw new Error("content exceeds 256 KiB");
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) throw new Error("source_refs must contain at least one traceable source");
  if (typeof validationQuery !== "string" || !validationQuery.trim()) throw new Error("validation_query is required");
  const config = await loadWorkspaceConfig(cwd);
  if (!config.obsidianVault) throw new Error("Obsidian vault is not configured");
  const before = await navigateResearchWiki({ cwd, project, query: validationQuery, topK: MAX_TOP_K });
  await initializeVaultLayout(config.obsidianVault, { project });
  const root = wikiRoot(config.obsidianVault, project);
  const path = join(root, `${slug}.md`);
  const existing = await readText(path);
  const body = managedBody({ content, sourceRefs: sourceRefs.map(String), relatedPages: relatedPages.map(String) });
  const initial = `---\nid: pi-wiki-${project}-${slug}\ntype: wiki\nproject: ${JSON.stringify(project)}\nstatus: active\n---\n\n# ${title.trim()}\n\n${MANAGED_START}\n${body}\n${MANAGED_END}\n\n## Human review\n\n`;
  await atomicText(path, existing === null ? initial : updateManaged(existing, body));
  await refreshProjectIndexes({ cwd, project });
  const after = await navigateResearchWiki({ cwd, project, query: validationQuery, topK: MAX_TOP_K });
  const beforeRank = rankFor(before, path);
  const afterRank = rankFor(after, path);
  const feedback = {
    at: new Date().toISOString(), project, page: relative(config.obsidianVault, path).split(sep).join("/"), query: validationQuery,
    before_rank: beforeRank, after_rank: afterRank, retrievable: afterRank !== null,
    improved: afterRank !== null && (beforeRank === null || afterRank < beforeRank),
  };
  await appendFile(join(root, ".feedback.jsonl"), `${JSON.stringify(feedback)}\n`, "utf8");
  return { path, feedback, before: before.hits.slice(0, 5), after: after.hits.slice(0, 5) };
}

export async function researchWikiStatus({ cwd = process.cwd(), project } = {}) {
  project = validateSegment(project, "project");
  const config = await loadWorkspaceConfig(cwd);
  if (!config.obsidianVault) return { configured: false, project, pages: 0, feedback_events: 0 };
  const root = wikiRoot(config.obsidianVault, project);
  const pages = await walkMarkdown(root);
  const feedback = await readText(join(root, ".feedback.jsonl"));
  return { configured: true, project, root, pages: pages.length, feedback_events: feedback ? feedback.trim().split("\n").filter(Boolean).length : 0 };
}
