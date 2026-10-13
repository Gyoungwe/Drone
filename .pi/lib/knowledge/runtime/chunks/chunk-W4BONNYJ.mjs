// @ts-nocheck
// packages/knowledge/src/memory-note.ts
var yaml = (value) => JSON.stringify(value.replace(/\s+/g, " ").trim());
function memoryNoteSlug(memory) {
  const base = memory.title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 48);
  return `${base || "memory"}-m${memory.id}`;
}
function memoryNoteMarkdown(memory, related = []) {
  const date = new Date(memory.createdAt).toISOString().slice(0, 10);
  const files = [...new Set(memory.files ?? [])].slice(0, 20);
  const lines = [
    "---",
    "type: memory",
    `title: ${yaml(memory.title)}`,
    "source: drone-memory",
    `memory_id: ${memory.id}`,
    `memory_kind: ${memory.kind}`,
    `session: ${yaml(memory.sessionId ?? "")}`,
    `date: ${date}`,
    ...files.length ? ["files:", ...files.map((f) => `  - ${yaml(f)}`)] : [],
    "---",
    "",
    `# ${memory.title.trim()}`,
    "",
    memory.body.trim() || "\uFF08\u65E0\u6B63\u6587\uFF09",
    "",
    "## \u6765\u6E90",
    "",
    `- \u4F1A\u8BDD\uFF1A${memory.sessionId ?? "\u672A\u77E5"}`,
    `- \u65E5\u671F\uFF1A${date}`,
    `- \u7C7B\u578B\uFF1A${memory.kind}`,
    ...files.length ? ["- \u6D89\u53CA\u6587\u4EF6\uFF1A", ...files.map((f) => `  - \`${f}\``)] : []
  ];
  const links = [...new Set(related.map((p) => p.replace(/\.md$/i, "")))].slice(0, 5);
  if (links.length) lines.push("", "## \u76F8\u5173", "", ...links.map((p) => `- [[${p}]]`));
  return `${lines.join("\n")}
`;
}

export {
  memoryNoteSlug,
  memoryNoteMarkdown
};
