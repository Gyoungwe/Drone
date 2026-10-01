// packages/knowledge/src/source-links.ts
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
function inside(root, path) {
  const relativePath = relative(root, path);
  return !relativePath || !isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`);
}
function hasControl(text) {
  return [...String(text)].some((char) => char.charCodeAt(0) < 32);
}
function label(text) {
  return [...String(text)].map(
    (char) => "[]<>".includes(char) || char.charCodeAt(0) === 10 || char.charCodeAt(0) === 13 ? " " : char
  ).join("").slice(0, 220);
}
var omittedSegments = /* @__PURE__ */ new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "venv",
  "__pycache__",
  "Attachments",
  "Templates",
  "_template"
]);
function allowedSegment(name) {
  return !!name && !name.startsWith(".") && !omittedSegments.has(name) && !/^(?:secrets?|credentials?|id_rsa|id_ed25519)(?:[.\-_]|$)/i.test(name);
}
function validateNote(path) {
  if (typeof path !== "string" || isAbsolute(path) || path.includes("\\") || !path.endsWith(".md") || !path.split("/").every(allowedSegment))
    throw new Error("Expected an allowed Vault-relative Markdown path");
  const reserved = ["Projects", "Library", "Wiki", "Attachments", "Templates", "Indexes", "Inbox"];
  const first = path.split("/")[0] ?? "";
  if (reserved.some((name) => name.toLowerCase() === first.toLowerCase() && name !== first))
    throw new Error("Reserved Vault directories require canonical casing");
}
function canRead(path, project) {
  const scope = path.startsWith("Projects/") && path.split("/").length > 2 ? path.split("/")[1] : "shared";
  return scope === "shared" || scope === project;
}
function onlineSourceLink(value, title = "Online source") {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Expected a credential-free HTTP(S) source URL");
  return `[${label(title)}](<${url.href}>)`;
}
async function normalizeSourceLinks(values, { cwd, vault, resultsRoot, project }) {
  if (!Array.isArray(values) || values.length > 40) throw new Error("Use at most 40 source references");
  const links = [];
  const unresolved = [];
  for (const value of values) {
    let raw = String(value).trim();
    if (!raw || raw.length > 4096 || hasControl(raw)) throw new Error("Invalid source reference");
    const md = raw.match(/^\[([^\]]+)\]\(<?([^>]+?)>?\)$/);
    const title = md?.[1];
    if (md) raw = md[2] ?? "";
    if (/^10\.\d{4,9}\//.test(raw)) raw = `https://doi.org/${raw}`;
    if (/^doi:/i.test(raw)) raw = `https://doi.org/${raw.slice(4).trim()}`;
    if (/^https?:/i.test(raw)) {
      links.push(onlineSourceLink(raw, title || raw));
      continue;
    }
    const zotero = raw.match(/^zotero:([A-Za-z0-9]{8})$/i);
    if (zotero) {
      links.push(`[Zotero ${zotero[1]}](zotero://select/library/items/${zotero[1]})`);
      continue;
    }
    const wiki = raw.match(/^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]$/);
    const notePath = `${(wiki?.[1] || raw).replace(/\.md$/, "")}.md`;
    if (/^(?:Wiki|Library|Projects|Inbox|Indexes)\//.test(notePath)) {
      validateNote(notePath);
      if (!canRead(notePath, project)) throw new Error("Source note is outside project scope");
      const full = resolve(vault, notePath);
      try {
        if (!inside(await realpath(vault), await realpath(full)) || !(await stat(full)).isFile())
          throw new Error("not a regular note");
        links.push(`[[${notePath.slice(0, -3)}${wiki?.[2] ? `|${label(wiki[2])}` : ""}]]`);
        continue;
      } catch {
      }
    } else if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("file:")) {
      try {
        const full = raw.startsWith("file:") ? fileURLToPath(raw) : resolve(cwd, raw);
        const actual = await realpath(full);
        const roots = await Promise.all(
          [vault, resultsRoot].filter((path) => Boolean(path)).map((path) => realpath(path).catch(() => null))
        );
        if (!roots.some((root) => root && inside(root, actual)) || !(await stat(actual)).isFile())
          throw new Error("Source file is outside Vault/results");
        links.push(`[${label(title || raw)}](<${pathToFileURL(actual).href}>)`);
        continue;
      } catch {
      }
    }
    unresolved.push(raw);
    links.push(`\`${raw.replace(/`/g, "")}\` \u2014 unresolved reference`);
  }
  return { links, unresolved };
}

export {
  onlineSourceLink,
  normalizeSourceLinks
};
