// packages/knowledge/src/wiki-policy.ts
import { createHash } from "node:crypto";
var MANAGED_START = "<!-- pi-agent:managed:start -->";
var MANAGED_END = "<!-- pi-agent:managed:end -->";
function validateSpecialistHtml(html) {
  if (typeof html !== "string" || html.length > 64e3 || !/<html\b/i.test(html) || !/<body\b/i.test(html))
    throw new Error("Explainer must be one bounded HTML document");
  if (/<(?:script|iframe|frame|object|embed|base|form|link)\b|\bon[a-z]+\s*=|<meta\b[^>]*http-equiv\s*=|javascript\s*:|@import|url\s*\(/i.test(
    html
  ))
    throw new Error("Explainer must be static and self-contained; active content was refused");
  if (/\bsrc\s*=\s*(?!["']?data:image\/)["']?[^\s>]/i.test(html))
    throw new Error("Explainer external resources are not allowed");
  return html;
}
function validateWikiSourcePaths(paths) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 12)
    throw Object.assign(
      new Error("source_paths: supply 1\u201312 Vault-relative Markdown notes already read this turn"),
      {
        code: "source-note-required",
        field: "source_paths"
      }
    );
  for (let index = 0; index < paths.length; index++) {
    const path = paths[index];
    if (typeof path !== "string" || path.includes("\\") || path.startsWith("/") || !path.endsWith(".md") || path.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
      throw Object.assign(
        new Error(
          `source_paths[${index}]: expected a Vault-relative Markdown source note (for example Library/Papers/source.md), not a workspace PDF or URL. Read the corresponding source note first; changing the Wiki target path cannot fix this field.`
        ),
        { code: "source-note-required", field: `source_paths[${index}]`, retryable: false }
      );
    }
  }
}
function targetWikiPath(path, project) {
  if (typeof path !== "string")
    throw new Error("Target must be a shared or current-project Wiki page, not navigation");
  const parts = path.split("/");
  if (!path.endsWith(".md") || path.includes("\\") || parts.some((part) => !part || part === "." || part === ".." || part.startsWith(".")))
    throw new Error("Target must be a shared or current-project Wiki page, not navigation");
  const prefix = `Projects/${project}/Wiki/`;
  const tail = path.startsWith("Wiki/") ? path.slice(5) : path.startsWith(prefix) ? path.slice(prefix.length) : null;
  if (!tail || tail.includes("/") || /^Index\.md$/i.test(tail) || /[[\]#|\r\n]/.test(tail))
    throw new Error("Target must be a shared or current-project Wiki page, not navigation");
  return path;
}
function immutableWikiProposalHash(proposal) {
  return createHash("sha256").update(
    JSON.stringify({
      id: proposal.id,
      vaultId: proposal.vaultId,
      bindingRevision: proposal.bindingRevision,
      project: proposal.project,
      path: proposal.path,
      title: proposal.title,
      rationale: proposal.rationale,
      createdAt: proposal.createdAt,
      before: proposal.before,
      after: proposal.after,
      sources: proposal.sources
    })
  ).digest("hex");
}
function managedParts(text) {
  const start = text.indexOf(MANAGED_START);
  const end = text.indexOf(MANAGED_END);
  if (start < 0 !== end < 0 || end < start || start >= 0 && (text.indexOf(MANAGED_START, start + 1) >= 0 || text.indexOf(MANAGED_END, end + 1) >= 0))
    throw new Error("Invalid managed block markers");
  return { start, end, body: start < 0 ? "" : text.slice(start + MANAGED_START.length, end).trim() };
}
function proposedWikiText(original, title, body) {
  const block = `${MANAGED_START}
${body.trim()}
${MANAGED_END}`;
  if (original === null)
    return `---
type: wiki
status: unverified
---

# ${title}

${block}

## Human review

`;
  const { start, end } = managedParts(original);
  return start < 0 ? `${original}${original.endsWith("\n") ? "\n" : "\n\n"}${block}
` : original.slice(0, start) + block + original.slice(end + MANAGED_END.length);
}

export {
  MANAGED_START,
  MANAGED_END,
  validateSpecialistHtml,
  validateWikiSourcePaths,
  targetWikiPath,
  immutableWikiProposalHash,
  managedParts,
  proposedWikiText
};
