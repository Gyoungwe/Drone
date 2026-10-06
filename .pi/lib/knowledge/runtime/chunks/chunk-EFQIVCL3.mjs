// @ts-nocheck
// packages/knowledge/src/daily-discovery.ts
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
var DAILY_DISCOVERY_LIMITS = {
  maxScannedFiles: 4e3,
  maxNoteBytes: 256 * 1024,
  maxNewNotes: 8,
  maxRelatedNotes: 10,
  maxNoteChars: 2400,
  maxIdeas: 3
};
var SCAN_ROOTS = ["Library", "Wiki", "Projects"];
var SKIP_DIRS = /* @__PURE__ */ new Set(["Explainers", "Attachments", ".obsidian", ".trash", ".git"]);
var NAVIGATION = /(?:^|\/)(?:Index|Home|Context)\.md$/;
function titleOf(path, text) {
  const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
  return (heading || path.split("/").pop()?.replace(/\.md$/, "") || path).slice(0, 200);
}
async function collectRecentNotes(vault, sinceMs) {
  const found = [];
  let scanned = 0;
  async function walk(dir) {
    if (scanned >= DAILY_DISCOVERY_LIMITS.maxScannedFiles) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) return;
    for (const entry of entries) {
      if (scanned >= DAILY_DISCOVERY_LIMITS.maxScannedFiles) return;
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        scanned++;
        const path = relative(vault, full).split(sep).join("/");
        if (NAVIGATION.test(path)) continue;
        const info = await stat(full).catch(() => null);
        if (info && info.mtimeMs > sinceMs && info.size <= DAILY_DISCOVERY_LIMITS.maxNoteBytes)
          found.push({ path, mtime: info.mtimeMs, size: info.size });
      }
    }
  }
  for (const root of SCAN_ROOTS) await walk(join(vault, root));
  found.sort((a, b) => b.mtime - a.mtime);
  const notes = [];
  for (const item of found.slice(0, DAILY_DISCOVERY_LIMITS.maxNewNotes)) {
    const text = await readFile(join(vault, item.path), "utf8").catch(() => "");
    if (!text.trim()) continue;
    notes.push({
      path: item.path,
      title: titleOf(item.path, text),
      text: text.slice(0, DAILY_DISCOVERY_LIMITS.maxNoteChars),
      mtime: item.mtime
    });
  }
  return notes;
}
function ideaNoteMarkdown(idea, createdAt) {
  return [
    "---",
    "type: idea",
    'status: "speculative"',
    "source: daily-discovery",
    `created: ${JSON.stringify(createdAt.toISOString())}`,
    "---",
    "",
    `# ${idea.title}`,
    "",
    idea.idea,
    "",
    "## \u4F9D\u636E",
    ...idea.basis.map((path) => `- [[${path.replace(/\.md$/, "")}]]`),
    "",
    "## \u5982\u4F55\u68C0\u9A8C",
    idea.test,
    ...idea.whyOverlooked ? ["", "## \u4E3A\u4EC0\u4E48\u53EF\u80FD\u88AB\u5FFD\u7565", idea.whyOverlooked] : [],
    "",
    "> \u63A8\u6D4B\uFF1A\u7531\u6BCF\u65E5\u53D1\u73B0\u6839\u636E\u77E5\u8BC6\u5E93\u81EA\u52A8\u63D0\u51FA\uFF0C\u5C1A\u672A\u9A8C\u8BC1\u3002",
    ""
  ].join("\n");
}

export {
  DAILY_DISCOVERY_LIMITS,
  collectRecentNotes,
  ideaNoteMarkdown
};
