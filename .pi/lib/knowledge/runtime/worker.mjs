// @ts-nocheck
// packages/knowledge/src/worker.ts
import { watch } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join as join2 } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { parentPort, workerData } from "node:worker_threads";

// packages/knowledge/src/files.ts
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
var MAX_NOTE_BYTES = 1024 * 1024;
var OMIT = /* @__PURE__ */ new Set([
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
var RESERVED = ["Projects", "Library", "Wiki", "Attachments", "Templates", "Indexes", "Inbox"];
function allowedSegment(name) {
  return !!name && !name.startsWith(".") && !OMIT.has(name) && !/^(?:secrets?|credentials?|id_rsa|id_ed25519)(?:[.\-_]|$)/i.test(name);
}
function validateNote(path) {
  if (typeof path !== "string" || isAbsolute(path) || path.includes("\\") || !path.endsWith(".md") || !path.split("/").every(allowedSegment))
    throw new Error("Expected an allowed Vault-relative Markdown path");
  const first = path.split("/")[0] ?? "";
  if (RESERVED.some((name) => name.toLowerCase() === first.toLowerCase() && name !== first))
    throw new Error("Reserved Vault directories require canonical casing");
  return path;
}
function noteScope(path) {
  const parts = path.split("/");
  return path.startsWith("Projects/") && parts.length > 2 ? parts[1] ?? "shared" : "shared";
}
function canRead(path, project) {
  const scope = noteScope(path);
  return scope === "shared" || scope === project;
}
function fileVersion(stat) {
  return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`;
}
async function safeNotePath(vault, path) {
  validateNote(path);
  let full = vault;
  for (const part of path.split("/")) {
    full = join(full, part);
    if ((await lstat(full)).isSymbolicLink()) throw new Error("Knowledge reads do not follow symlinks");
  }
  const actual = await realpath(full);
  const rel = relative(vault, actual);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
    throw new Error("Note is outside the bound Vault");
  return actual;
}
async function inspectNote(vault, path) {
  const full = await safeNotePath(vault, path);
  const stat = await lstat(full);
  if (!stat.isFile()) throw new Error("Expected a regular note");
  return { full, stat, signature: fileVersion(stat) };
}
async function closeQuietly(handle) {
  try {
    await handle.close();
  } catch {
  }
}
async function readNoteFile(vault, path) {
  const { full } = await inspectNote(vault, path);
  const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_NOTE_BYTES)
      throw new Error("Note exceeds the 1 MiB indexing limit");
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    const current = await inspectNote(vault, path);
    if (fileVersion(before) !== fileVersion(after) || fileVersion(after) !== current.signature || offset !== before.size)
      throw new Error("Note changed while reading; retry against its latest version");
    const bytes = buffer.subarray(0, offset);
    return {
      path,
      text: bytes.toString("utf8"),
      hash: createHash("sha256").update(bytes).digest("hex"),
      signature: fileVersion(after),
      bytes: offset
    };
  } catch (error) {
    await closeQuietly(handle);
    throw error;
  } finally {
    await closeQuietly(handle);
  }
}
function snippet(text, { startLine = 1, maxChars = 5e3 } = {}) {
  const lines = text.split("\n");
  const start = Math.max(0, Math.floor(startLine) - 1);
  const selected = [];
  let chars = 0;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (chars + line.length + 1 > maxChars) {
      if (!selected.length) selected.push(line.slice(0, maxChars));
      break;
    }
    selected.push(line);
    chars += line.length + 1;
  }
  return {
    text: selected.join("\n"),
    startLine: start + 1,
    endLine: start + selected.length,
    totalLines: lines.length,
    truncated: start > 0 || start + selected.length < lines.length || selected.length === 1 && (selected[0]?.length ?? 0) < (lines[start]?.length || 0)
  };
}

// packages/knowledge/src/graph-retrieval.ts
function backlinkContext(body, target, max = 240) {
  const bare = target.split("/").at(-1)?.replace(/\.md$/, "") || target;
  const full = target.replace(/\.md$/, "");
  for (const line of String(body || "").split(/\r?\n/)) {
    for (const m of line.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
      const t = (m[1] || "").trim().replace(/\.md$/, "");
      if (t === full || t.toLowerCase() === bare.toLowerCase()) {
        const s = line.trim();
        return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
      }
    }
  }
  return void 0;
}

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
  for (let start = 0; start < text.length && chunks.length < 64; start += maxChars)
    chunks.push(text.slice(start, start + maxChars));
  return chunks;
}

// packages/knowledge/src/semantic-model.ts
var WIDTH = 720;
var HEIGHT = 440;
var INFRASTRUCTURE = /(?:^|\/)(?:Index|Context|Home|Template|Templates)\.md$/i;
function isInfrastructureNode(node) {
  return node.kind === "navigation" || INFRASTRUCTURE.test(node.path);
}
function nodeType(node) {
  if (isInfrastructureNode(node)) return "infrastructure";
  if (node.kind === "wiki") return "wiki";
  return "note";
}
function classifyRelation(source, target, type) {
  if (type) return type;
  const sourceDir = source.path.slice(0, source.path.lastIndexOf("/"));
  const targetDir = target.path.slice(0, target.path.lastIndexOf("/"));
  return sourceDir && sourceDir === targetDir ? "directory" : "link";
}
function normalizeIdentity(value) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
  if (/^doi:\s*/.test(normalized) || /^10\.\d{4,9}\//.test(normalized)) return `doi:${normalized.replace(/^doi:\s*/, "")}`;
  if (/^pmid:\s*\d+$/.test(normalized) || /^\d{1,9}$/.test(normalized)) return `pmid:${normalized.replace(/^pmid:\s*/, "")}`;
  if (/^arxiv:\s*/.test(normalized) || /^\d{4}\.\d{4,5}(?:v\d+)?$/.test(normalized)) return `arxiv:${normalized.replace(/^arxiv:\s*/, "")}`;
  return normalized || null;
}
function fallbackIdentity(node) {
  if (node.identity) return normalizeIdentity(node.identity);
  return null;
}
function canonicalRank(path) {
  return [path.startsWith("Library/") ? 0 : path.startsWith("Projects/") ? 1 : 2, path];
}
function comparePath(a, b) {
  return a.localeCompare(b);
}
function hash(value, seed = 42) {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
function assignCommunities(paths, edges, seed = 42) {
  const ordered = [...new Set(paths)].sort(comparePath);
  const adjacency = new Map(ordered.map((path) => [path, /* @__PURE__ */ new Set()]));
  for (const edge of edges) {
    if (edge.type !== "link" || !adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }
  const labels = new Map(ordered.map((path, index) => [path, index]));
  const degree = new Map(ordered.map((path) => [path, adjacency.get(path)?.size ?? 0]));
  const total = [...degree.values()].reduce((sum, value) => sum + value, 0) || 1;
  for (let round = 0; round < 12; round++) {
    let changed2 = false;
    for (const path of ordered) {
      const neighbours = [...adjacency.get(path) ?? []].sort(comparePath);
      if (!neighbours.length) continue;
      const scores = /* @__PURE__ */ new Map();
      for (const neighbour of neighbours) {
        const label = labels.get(neighbour) ?? 0;
        scores.set(label, (scores.get(label) ?? 0) + 1 - (degree.get(path) ?? 0) * (degree.get(neighbour) ?? 0) / total);
      }
      const current = labels.get(path) ?? 0;
      const best = [...scores.entries()].sort((a, b) => b[1] - a[1] || hash(`${path}:${a[0]}`, seed) - hash(`${path}:${b[0]}`, seed) || a[0] - b[0])[0];
      if (best && best[1] > 0 && best[0] !== current) {
        labels.set(path, best[0]);
        changed2 = true;
      }
    }
    if (!changed2) break;
  }
  const counts = /* @__PURE__ */ new Map();
  for (const label of labels.values()) counts.set(label, (counts.get(label) ?? 0) + 1);
  const rank = new Map([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([label], index) => [label, index]));
  return Object.fromEntries(ordered.map((path) => [path, degree.get(path) ?? 0 ? rank.get(labels.get(path) ?? -1) ?? -1 : -1]));
}
function createSemanticModel(input, options = {}) {
  const view = options.view ?? "semantic";
  const mergeMirrors = options.mergeMirrors ?? true;
  const seed = options.seed ?? 42;
  const sourceNodes = [...input.nodes].sort((a, b) => comparePath(a.path, b.path));
  const visible = sourceNodes.filter((node) => view === "all" || !isInfrastructureNode(node));
  const groups = /* @__PURE__ */ new Map();
  for (const node of visible) {
    const identity = fallbackIdentity(node);
    if (mergeMirrors && identity) {
      const group = groups.get(identity) ?? [];
      group.push(node);
      groups.set(identity, group);
    }
  }
  const canonicalFor = /* @__PURE__ */ new Map();
  const duplicates = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => {
      const [ar, ap] = canonicalRank(a.path);
      const [br, bp] = canonicalRank(b.path);
      return ar - br || ap.localeCompare(bp);
    });
    const first = ordered[0];
    if (!first) continue;
    const canonical = first.path;
    for (const node of ordered) {
      canonicalFor.set(node.path, canonical);
      if (node.path !== canonical) duplicates.push({ canonical, duplicate: node.path });
    }
  }
  const modelNodes = /* @__PURE__ */ new Map();
  for (const node of visible) {
    const canonical = canonicalFor.get(node.path) ?? node.path;
    if (!modelNodes.has(canonical)) modelNodes.set(canonical, node);
  }
  const relations = [];
  for (const raw of input.edges ?? []) {
    const source = canonicalFor.get(raw.source) ?? raw.source;
    const target = canonicalFor.get(raw.target) ?? raw.target;
    if (source === target || !modelNodes.has(source) || !modelNodes.has(target)) continue;
    const type = classifyRelation({ path: source }, { path: target }, raw.type);
    if (!relations.some((edge) => edge.source === source && edge.target === target && edge.type === type)) relations.push({ source, target, type });
  }
  if (view === "all") {
    const all = [...modelNodes.keys()].sort(comparePath);
    const siblings = /* @__PURE__ */ new Map();
    for (const path of all) {
      const parent = path.slice(0, path.lastIndexOf("/"));
      const group = siblings.get(parent) ?? [];
      group.push(path);
      siblings.set(parent, group);
    }
    for (const group of siblings.values()) {
      for (let i = 1; i < group.length; i++) {
        const source = group[i - 1];
        const target = group[i];
        if (source && target && !relations.some((edge) => edge.source === source && edge.target === target)) relations.push({ source, target, type: "directory" });
      }
    }
  }
  for (const duplicate of duplicates) relations.push({ source: duplicate.canonical, target: duplicate.duplicate, type: "duplicate" });
  const communities = assignCommunities([...modelNodes.keys()], relations, seed);
  const communitySizes = /* @__PURE__ */ new Map();
  for (const community of Object.values(communities)) if (community >= 0) communitySizes.set(community, (communitySizes.get(community) ?? 0) + 1);
  const communityCount = Math.max(1, communitySizes.size);
  const layout = {};
  for (const path of [...modelNodes.keys()].sort(comparePath)) {
    const community = communities[path] ?? -1;
    const centerAngle = community >= 0 ? 2 * Math.PI * community / communityCount : 2 * Math.PI * hash(path, seed);
    const radius = community >= 0 ? 75 + 24 * hash(`${path}:r`, seed) : 150 + 35 * hash(`${path}:r`, seed);
    const jitter = 2 * Math.PI * hash(`${path}:a`, seed);
    layout[path] = { x: WIDTH / 2 + radius * Math.cos(centerAngle) + 18 * Math.cos(jitter), y: HEIGHT / 2 + radius * Math.sin(centerAngle) + 18 * Math.sin(jitter) };
  }
  const linkRelations = relations.filter((edge) => edge.type === "link");
  const degree = /* @__PURE__ */ new Map();
  for (const edge of linkRelations) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const nodes = [...modelNodes.entries()].sort(([a], [b]) => comparePath(a, b)).map(([path, node]) => {
    const mirrorPaths = [...canonicalFor.entries()].filter(([, canonical]) => canonical === path).map(([mirror]) => mirror).filter((mirror) => mirror !== path).sort(comparePath);
    const type = nodeType(node);
    return { path, title: node.title, kind: node.kind, degree: degree.get(path) ?? 0, nodeType: mirrorPaths.length ? "mirror" : type, isInfrastructure: type === "infrastructure", community: communities[path] ?? -1, ...layout[path] ?? { x: WIDTH / 2, y: HEIGHT / 2 }, ...mirrorPaths.length ? { mirrors: mirrorPaths, warnings: ["mirror"] } : {} };
  });
  return { nodes, edges: linkRelations.map(({ source, target }) => ({ source, target })), relations, duplicates, communities, layout };
}

// packages/knowledge/src/worker.ts
await mkdir(dirname(workerData.database), { recursive: true, mode: 448 });
var db = new DatabaseSync(workerData.database, { timeout: 1500 });
var priorSchemaVersion = Number(db.prepare("PRAGMA user_version").get().user_version ?? 0);
if (!Number.isInteger(priorSchemaVersion) || priorSchemaVersion > 1)
  throw new Error("Knowledge database schema is newer than this worker");
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1500; PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT OR IGNORE INTO meta VALUES('revision',0);
CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL, signature TEXT NOT NULL,
 scope TEXT NOT NULL, kind TEXT NOT NULL, bytes INTEGER NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(title, terms, tokenize='unicode61');
CREATE TABLE IF NOT EXISTS links(source TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY(source,target));
CREATE INDEX IF NOT EXISTS links_target ON links(target);
CREATE INDEX IF NOT EXISTS notes_scope ON notes(scope,kind);
CREATE TABLE IF NOT EXISTS jobs(key TEXT PRIMARY KEY, kind TEXT NOT NULL, path TEXT NOT NULL,
 scope TEXT NOT NULL, revision INTEGER NOT NULL, updated TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_scope_updated ON jobs(scope,updated DESC);
CREATE INDEX IF NOT EXISTS jobs_scope_kind_updated ON jobs(scope,kind,updated DESC);
CREATE TABLE IF NOT EXISTS problems(path TEXT PRIMARY KEY, message TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS semantic_chunks(
 path TEXT NOT NULL, chunk_index INTEGER NOT NULL, hash TEXT NOT NULL, fingerprint TEXT NOT NULL,
 mtime TEXT NOT NULL, vector TEXT NOT NULL, dimension INTEGER NOT NULL,
 start_char INTEGER, end_char INTEGER,
 PRIMARY KEY(path,chunk_index,hash,fingerprint)
);
CREATE INDEX IF NOT EXISTS semantic_chunks_lookup ON semantic_chunks(fingerprint,hash,path);
CREATE TABLE IF NOT EXISTS semantic_meta(fingerprint TEXT PRIMARY KEY, dimension INTEGER NOT NULL);
`);
if (priorSchemaVersion < 1) db.exec("PRAGMA user_version=1;");
var semanticColumns = db.prepare("PRAGMA table_info(semantic_chunks)").all().map((column) => column.name);
if (!semanticColumns.includes("start_char"))
  db.exec("ALTER TABLE semantic_chunks ADD COLUMN start_char INTEGER");
if (!semanticColumns.includes("end_char")) db.exec("ALTER TABLE semantic_chunks ADD COLUMN end_char INTEGER");
if (semanticColumns.includes("text")) {
  db.exec(`BEGIN IMMEDIATE;
DROP INDEX IF EXISTS semantic_chunks_lookup;
ALTER TABLE semantic_chunks RENAME TO semantic_chunks_legacy;
CREATE TABLE semantic_chunks(
 path TEXT NOT NULL, chunk_index INTEGER NOT NULL, hash TEXT NOT NULL, fingerprint TEXT NOT NULL,
 mtime TEXT NOT NULL, vector TEXT NOT NULL, dimension INTEGER NOT NULL,
 start_char INTEGER, end_char INTEGER,
 PRIMARY KEY(path,chunk_index,hash,fingerprint)
);
INSERT INTO semantic_chunks(path,chunk_index,hash,fingerprint,mtime,vector,dimension)
 SELECT path,chunk_index,hash,fingerprint,mtime,vector,dimension FROM semantic_chunks_legacy;
DROP TABLE semantic_chunks_legacy;
CREATE INDEX IF NOT EXISTS semantic_chunks_lookup ON semantic_chunks(fingerprint,hash,path);
COMMIT;`);
}
var revision = Number(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value);
var scan = null;
var coverage = "uninitialized";
var lastReconciledAt = null;
var watching = false;
var timer = null;
var _closed = false;
var fullScanRequested = false;
var activeRequests = /* @__PURE__ */ new Set();
var flushes = /* @__PURE__ */ new Set();
var closePromise;
var dirty = /* @__PURE__ */ new Set();
var inflight = /* @__PURE__ */ new Map();
var stats = { bodyReads: 0, metadataChecks: 0, reconciliations: 0, changes: 0, searches: 0 };
var statements = {
  get: db.prepare("SELECT * FROM notes WHERE path=?"),
  count: db.prepare("SELECT count(*) count FROM notes"),
  removeFts: db.prepare("DELETE FROM search WHERE rowid=?"),
  remove: db.prepare("DELETE FROM notes WHERE path=?"),
  links: db.prepare("DELETE FROM links WHERE source=?"),
  addLink: db.prepare("INSERT OR IGNORE INTO links VALUES(?,?)"),
  problem: db.prepare("INSERT OR REPLACE INTO problems VALUES(?,?)"),
  clearProblem: db.prepare("DELETE FROM problems WHERE path=?"),
  semanticDelete: db.prepare("DELETE FROM semantic_chunks WHERE path=?"),
  job: db.prepare(
    "INSERT INTO jobs VALUES(?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET revision=excluded.revision,updated=excluded.updated"
  )
};
function bump() {
  revision = Number(
    db.prepare("UPDATE meta SET value=value+1 WHERE key='revision' RETURNING value").get().value
  );
}
function job(kind, path, scope) {
  statements.job.run(`${kind}:${path}`, kind, path, scope, revision, (/* @__PURE__ */ new Date()).toISOString());
}
var uiTimer = null;
function signalUiChange() {
  if (_closed || uiTimer) return;
  uiTimer = setTimeout(() => {
    uiTimer = null;
    parentPort.postMessage({ uiChanged: true });
  }, 500);
  uiTimer.unref();
}
function changed(path, previous) {
  signalUiChange();
  stats.changes++;
  const scope = noteScope(path);
  if (!/(?:^|\/)(?:Index|Context|Home)\.md$/i.test(path)) {
    job(
      "navigation",
      scope === "shared" ? path.startsWith("Wiki/") ? "Wiki/Index.md" : "Library/Index.md" : `Projects/${scope}/Index.md`,
      scope
    );
    if (!/(?:^|\/)Wiki\//.test(path)) job("evidence-review", path, scope);
  }
  const dependents = db.prepare("SELECT source FROM links WHERE target=?").all(path);
  for (const { source } of dependents)
    if (/(?:^|\/)Wiki\//.test(source) && !source.endsWith("/Index.md"))
      job("wiki-review", source, noteScope(source));
  if (previous && previous.scope !== scope)
    job("navigation", `Projects/${previous.scope}/Index.md`, previous.scope);
}
function internalLinks(path, text) {
  const out = /* @__PURE__ */ new Set();
  for (const match of text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    let target = match[1].trim();
    if (!target.includes("/")) {
      target = ["Home", "Index", "Context"].includes(target) && target !== "Home" ? `${path.split("/").slice(0, -1).join("/")}/${target}` : target;
    }
    if (!target.endsWith(".md")) target += ".md";
    try {
      validateNote(target);
      out.add(target);
    } catch {
    }
  }
  return out;
}
async function updatePath(path, force = false) {
  validateNote(path);
  if (inflight.has(path)) return inflight.get(path);
  const task = (async () => {
    const previous = statements.get.get(path);
    try {
      stats.metadataChecks++;
      const info = await inspectNote(workerData.vault, path);
      if (!force && previous?.signature === info.signature) return previous;
      const file = await readNoteFile(workerData.vault, path);
      stats.bodyReads++;
      if (previous?.hash === file.hash) {
        db.prepare("UPDATE notes SET signature=? WHERE path=?").run(file.signature, path);
        statements.clearProblem.run(path);
        return statements.get.get(path);
      }
      const title = file.text.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.split("/").at(-1).slice(0, -3);
      const kind = /(?:^|\/)(?:Index|Context|Home)\.md$/i.test(path) ? "navigation" : /(?:^|\/)Wiki\//.test(path) ? "wiki" : path.startsWith("Library/Explainers/") ? "explainer" : "note";
      db.exec("BEGIN IMMEDIATE");
      try {
        if (previous) statements.removeFts.run(previous.id);
        if (previous && (previous.hash !== file.hash || previous.signature !== file.signature))
          statements.semanticDelete.run(path);
        db.prepare(`INSERT INTO notes(path,title,body,hash,signature,scope,kind,bytes) VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(path) DO UPDATE SET title=excluded.title,body=excluded.body,hash=excluded.hash,
          signature=excluded.signature,scope=excluded.scope,kind=excluded.kind,bytes=excluded.bytes`).run(
          path,
          title,
          file.text,
          file.hash,
          file.signature,
          noteScope(path),
          kind,
          file.bytes
        );
        const row = statements.get.get(path);
        db.prepare("INSERT INTO search(rowid,title,terms) VALUES(?,?,?)").run(
          row.id,
          tokenizeKnowledgeText(title).join(" "),
          tokenizeKnowledgeText(file.text).join(" ")
        );
        statements.links.run(path);
        for (const target of internalLinks(path, file.text)) statements.addLink.run(path, target);
        statements.clearProblem.run(path);
        bump();
        changed(path, previous);
        db.exec("COMMIT");
        return row;
      } catch (error) {
        db.exec("ROLLBACK");
        revision = Number(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value);
        throw error;
      }
    } catch (error) {
      if (previous) {
        db.exec("BEGIN IMMEDIATE");
        try {
          statements.removeFts.run(previous.id);
          statements.remove.run(path);
          statements.semanticDelete.run(path);
          statements.links.run(path);
          bump();
          changed(path, previous);
          db.exec("COMMIT");
        } catch (inner) {
          db.exec("ROLLBACK");
          throw inner;
        }
      }
      if (["ENOENT", "ENOTDIR"].includes(error.code)) statements.clearProblem.run(path);
      else statements.problem.run(path, String(error.message).slice(0, 400));
      if (["ENOENT", "ENOTDIR"].includes(error.code)) return null;
      throw error;
    }
  })();
  inflight.set(path, task);
  try {
    return await task;
  } finally {
    if (inflight.get(path) === task) inflight.delete(path);
  }
}
async function* walk(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!allowedSegment(entry.name) || entry.isSymbolicLink()) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walk(join2(directory, entry.name), path);
    else if (entry.isFile() && path.endsWith(".md")) yield path;
  }
}
function beginReconcile(force = false) {
  if (_closed) return Promise.resolve();
  if (scan) return scan;
  coverage = "indexing";
  stats.reconciliations++;
  scan = (async () => {
    const seen = /* @__PURE__ */ new Set(), initial = db.prepare("SELECT path FROM notes").all();
    let n = 0, interrupted = false;
    try {
      for await (const path of walk(workerData.vault)) {
        seen.add(path);
        try {
          await updatePath(path, force);
        } catch {
        }
        if (++n % 24 === 0) await yieldTurn();
      }
    } catch (error) {
      interrupted = true;
      statements.problem.run("<inventory>", String(error.message));
    }
    if (!interrupted) {
      statements.clearProblem.run("<inventory>");
      for (const { path } of initial)
        if (!seen.has(path)) {
          try {
            await updatePath(path, true);
          } catch {
          }
        }
      lastReconciledAt = (/* @__PURE__ */ new Date()).toISOString();
    }
    coverage = interrupted ? "partial" : "ready";
    signalUiChange();
  })().finally(() => {
    scan = null;
  });
  return scan;
}
function flushDirty(limit = 32) {
  if (_closed) return Promise.resolve();
  const task = flushDirtyBatch(limit);
  flushes.add(task);
  void task.then(
    () => flushes.delete(task),
    () => flushes.delete(task)
  );
  return task;
}
async function flushDirtyBatch(limit) {
  const paths = [...dirty].slice(0, limit);
  for (let i = 0; i < paths.length; i++) {
    dirty.delete(paths[i]);
    try {
      await updatePath(paths[i]);
    } catch {
    }
    if (i % 16 === 15) await yieldTurn();
  }
  if (dirty.size) schedule();
  if (fullScanRequested && !scan) {
    fullScanRequested = false;
    void beginReconcile();
  }
}
function schedule() {
  if (_closed || timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushDirty();
  }, 150);
  timer.unref();
}
var watcher;
try {
  watcher = watch(workerData.vault, { recursive: true, persistent: false }, (_event, name) => {
    if (_closed) return;
    const path = name?.toString().replaceAll("\\", "/");
    if (path?.endsWith(".md")) {
      try {
        validateNote(path);
        dirty.add(path);
      } catch {
        return;
      }
    } else if (!path || path.split("/").every(allowedSegment)) fullScanRequested = true;
    schedule();
  });
  watcher.on("error", (error) => {
    if (_closed) return;
    watching = false;
    statements.problem.run("<watcher>", String(error.message));
  });
  watching = true;
} catch (error) {
  statements.problem.run("<watcher>", String(error.message));
}
var reconcileTimer = setInterval(() => {
  if (!scan) void beginReconcile();
}, workerData.reconcileMs || 12e4);
reconcileTimer.unref();
function closeWorker() {
  if (closePromise) return closePromise;
  _closed = true;
  if (timer) clearTimeout(timer);
  if (uiTimer) clearTimeout(uiTimer);
  clearInterval(reconcileTimer);
  watcher?.close();
  watching = false;
  fullScanRequested = false;
  closePromise = (async () => {
    await Promise.allSettled([...activeRequests, ...flushes, ...inflight.values(), scan]);
    dirty.clear();
    db.close();
  })();
  return closePromise;
}
function status() {
  revision = Number(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value);
  return {
    revision,
    coverage,
    noteCount: Number(statements.count.get().count),
    lastReconciledAt,
    watching,
    pendingChanges: dirty.size,
    jobs: Number(db.prepare("SELECT count(*) count FROM jobs").get().count),
    problems: db.prepare("SELECT * FROM problems ORDER BY path LIMIT 20").all(),
    stats: { ...stats },
    semantic: {
      vectors: Number(db.prepare("SELECT count(*) count FROM semantic_chunks").get().count),
      paths: Number(db.prepare("SELECT count(DISTINCT path) count FROM semantic_chunks").get().count)
    }
  };
}
function semanticStatus(fingerprint = null, project = null) {
  if (!fingerprint) return { vectors: 0, paths: 0, coverage: "unconfigured" };
  const scope = project || "";
  const row = db.prepare(`SELECT count(*) vectors,count(DISTINCT s.path) paths
    FROM semantic_chunks s JOIN notes n ON n.path=s.path AND n.hash=s.hash
    WHERE s.fingerprint=? AND (n.scope='shared' OR n.scope=?) AND n.kind NOT IN ('navigation','explainer')`).get(fingerprint, scope);
  return { vectors: Number(row.vectors), paths: Number(row.paths), fingerprint, project: scope };
}
function pending(project, limit = 20, kind = null) {
  return db.prepare(
    "SELECT * FROM jobs WHERE (scope='shared' OR scope=?) AND (? IS NULL OR kind=?) ORDER BY updated DESC LIMIT ?"
  ).all(project || "", kind, kind, limit);
}
async function read(path, project, options = {}) {
  if (!canRead(validateNote(path), project)) throw new Error("Note is outside shared/current-project scope");
  const row = await updatePath(path);
  if (!row) return { path, missing: true };
  const part = snippet(row.body, options);
  const reviewAt = row.body.split("\n").findIndex((line) => /^## Human review\s*$/i.test(line));
  const humanReview = reviewAt >= 0 ? snippet(row.body, { startLine: reviewAt + 1, maxChars: options.reviewMaxChars || 1600 }) : null;
  return {
    path,
    hash: row.hash,
    ...part,
    humanReview,
    pending: db.prepare("SELECT kind,revision FROM jobs WHERE path=?").all(path)
  };
}
async function search(args) {
  stats.searches++;
  if (coverage === "uninitialized") void beginReconcile();
  await flushDirty();
  const expression = buildKnowledgeSearchExpression(args.query);
  const limit = Math.max(1, Math.min(12, Math.floor(args.limit || 5)));
  const kindFilter = args.wikiOnly ? "AND n.kind='wiki'" : args.explainerOnly ? "AND n.kind='explainer'" : "AND n.kind!='explainer'";
  const rows = db.prepare(`SELECT n.path,n.title,n.hash,n.kind,n.body,bm25(search,6.0,1.0) rank
    FROM search CROSS JOIN notes n ON n.id=search.rowid
    WHERE search MATCH ? AND (n.scope='shared' OR n.scope=?) ${kindFilter}
    ORDER BY rank,n.path LIMIT ?`).all(expression, args.project || "", limit * 2);
  const hits = [];
  let staleCandidates = 0;
  for (const item of rows) {
    if (hits.length >= limit) break;
    let current;
    try {
      current = await updatePath(item.path);
    } catch {
      continue;
    }
    if (!current || current.hash !== item.hash) {
      staleCandidates++;
      continue;
    }
    const lower = current.body.normalize("NFKC").toLowerCase();
    const needle = String(args.query).normalize("NFKC").toLowerCase();
    let at = lower.indexOf(needle);
    if (at < 0)
      at = tokenizeKnowledgeText(args.query).map((t) => lower.indexOf(t)).find((i) => i >= 0) ?? 0;
    const startLine = Math.max(1, current.body.slice(0, at).split("\n").length - 2);
    const part = snippet(current.body, { startLine, maxChars: 1600 });
    hits.push({
      path: item.path,
      title: item.title,
      hash: current.hash,
      kind: item.kind,
      rank: item.rank,
      ...part
    });
  }
  return {
    query: args.query,
    hits,
    ...status(),
    pendingMaintenance: pending(args.project, 8),
    staleCandidates,
    complete: staleCandidates === 0 && coverage === "ready" && dirty.size === 0 && db.prepare("SELECT count(*) count FROM problems").get().count === 0,
    warning: coverage === "ready" ? null : "Index is still being reconciled; zero hits are not proof of absence."
  };
}
async function hydrateCandidates(args) {
  const candidates = Array.isArray(args.candidates) ? args.candidates.slice(0, 24) : Array.isArray(args.paths) ? [...new Set(args.paths)].slice(0, 24).map((path) => ({ path })) : [];
  const limit = Math.max(1, Math.min(12, Math.floor(args.limit || 5)));
  const hits = [];
  for (const candidate of candidates) {
    if (hits.length >= limit || typeof candidate?.path !== "string") break;
    let path;
    try {
      path = validateNote(candidate.path);
      if (!canRead(path, args.project)) continue;
    } catch {
      continue;
    }
    let current;
    try {
      current = await updatePath(path);
    } catch {
      continue;
    }
    if (!current || current.kind === "explainer" || candidate.hash && candidate.hash !== current.hash)
      continue;
    const startChar = Number.isInteger(candidate.startChar) ? candidate.startChar : -1;
    const startLine = startChar >= 0 && startChar <= current.body.length ? current.body.slice(0, startChar).split("\n").length : 1;
    const part = snippet(current.body, { startLine, maxChars: 1600 });
    hits.push({
      path,
      title: current.title,
      hash: current.hash,
      kind: current.kind,
      rank: null,
      ...Number.isInteger(candidate.chunkIndex) ? { chunkIndex: candidate.chunkIndex } : {},
      ...part
    });
  }
  return { hits };
}
async function semanticBatch(args) {
  const fingerprint = String(args.fingerprint || "");
  if (!fingerprint || fingerprint.length > 300) throw new Error("Invalid semantic fingerprint");
  const limit = Math.max(1, Math.min(16, Math.floor(args.limit || 8)));
  const chunkChars = Math.max(256, Math.min(8e3, Math.floor(args.chunkChars || 1200)));
  const scope = args.project || "";
  const rows = db.prepare(`SELECT path,title,body,hash,signature,scope,kind FROM notes
    WHERE (scope='shared' OR scope=?) AND kind NOT IN ('navigation','explainer') ORDER BY path`).all(scope);
  const items = [];
  for (const row of rows) {
    let current;
    try {
      if (!canRead(row.path, args.project)) continue;
      if (/(?:^|\/)(?:Runs|Explainers)\//i.test(row.path)) continue;
      current = await updatePath(row.path);
      if (!current || current.hash !== row.hash || current.signature !== row.signature) continue;
    } catch {
      continue;
    }
    const chunks = splitKnowledgeChunks(current.body, chunkChars);
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      const found = db.prepare(
        "SELECT 1 FROM semantic_chunks WHERE path=? AND chunk_index=? AND hash=? AND fingerprint=? LIMIT 1"
      ).get(row.path, index, row.hash, fingerprint);
      if (found) continue;
      if (items.length >= limit) {
        return { items, partial: true, nextCursor: null };
      }
      const startChar = index * chunkChars;
      items.push({
        path: row.path,
        chunkIndex: index,
        hash: current.hash,
        mtime: current.signature,
        text: chunk,
        startChar,
        endChar: startChar + chunk.length
      });
    }
  }
  return { items, partial: false, nextCursor: null };
}
function semanticStore(args) {
  const fingerprint = String(args.fingerprint || "");
  if (!fingerprint || fingerprint.length > 300 || !Array.isArray(args.items) || args.items.length > 32)
    throw new Error("Invalid semantic storage request");
  let dimension = null;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const item of args.items) {
      const row = statements.get.get(item.path);
      if (!row || row.hash !== item.hash || row.signature !== item.mtime || !Array.isArray(item.vector) || !Number.isInteger(item.chunkIndex) || item.chunkIndex < 0)
        throw new Error("Semantic batch is stale");
      const vector = item.vector;
      if (!vector.length || vector.length > 16384 || vector.some((n) => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e6))
        throw new Error("Invalid semantic vector");
      let norm = 0;
      for (const value of vector) {
        norm += value * value;
        if (!Number.isFinite(norm) || norm > 1e18) throw new Error("Invalid semantic vector norm");
      }
      if (!(norm > 0)) throw new Error("Invalid semantic vector norm");
      if (dimension === null) dimension = vector.length;
      if (vector.length !== dimension) throw new Error("Semantic batch dimensions do not match");
      const meta = db.prepare("SELECT dimension FROM semantic_meta WHERE fingerprint=?").get(fingerprint);
      if (meta && Number(meta.dimension) !== vector.length)
        throw new Error("Semantic fingerprint dimension mismatch");
      db.prepare(
        "INSERT OR REPLACE INTO semantic_chunks(path,chunk_index,hash,fingerprint,mtime,vector,dimension,start_char,end_char) VALUES(?,?,?,?,?,?,?,?,?)"
      ).run(
        item.path,
        item.chunkIndex,
        item.hash,
        fingerprint,
        item.mtime,
        JSON.stringify(vector),
        vector.length,
        Number.isInteger(item.startChar) ? item.startChar : null,
        Number.isInteger(item.endChar) ? item.endChar : null
      );
    }
    if (dimension !== null)
      db.prepare(
        "INSERT INTO semantic_meta(fingerprint,dimension) VALUES(?,?) ON CONFLICT(fingerprint) DO UPDATE SET dimension=excluded.dimension"
      ).run(fingerprint, dimension);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return status();
}
function semanticCandidates(args) {
  if (!Array.isArray(args.vector) || !args.vector.length || args.vector.some((n) => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e6))
    throw new Error("Invalid semantic query vector");
  const fingerprint = String(args.fingerprint || "");
  if (!fingerprint || fingerprint.length > 300) throw new Error("Invalid semantic fingerprint");
  const minSimilarity = args.minSimilarity === void 0 ? 0.45 : args.minSimilarity;
  if (typeof minSimilarity !== "number" || !Number.isFinite(minSimilarity) || minSimilarity < 0 || minSimilarity > 1)
    throw new Error("Invalid semantic similarity threshold");
  const query = args.vector, limit = Math.max(1, Math.min(12, Math.floor(args.limit || 5)));
  const rows = db.prepare(
    "SELECT s.path,s.hash,s.vector,s.dimension,s.chunk_index,s.start_char,s.end_char,n.title,n.kind FROM semantic_chunks s JOIN notes n ON n.path=s.path AND n.hash=s.hash WHERE s.fingerprint=? AND (n.scope='shared' OR n.scope=?) AND n.kind!='explainer' ORDER BY s.path LIMIT 5000"
  ).all(fingerprint, args.project || "");
  const totalEligible = Number(
    db.prepare(
      "SELECT COUNT(*) AS count FROM semantic_chunks s JOIN notes n ON n.path=s.path AND n.hash=s.hash WHERE s.fingerprint=? AND (n.scope='shared' OR n.scope=?) AND n.kind!='explainer'"
    ).get(fingerprint, args.project || "").count
  );
  const best = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (row.dimension !== query.length) continue;
    let vector;
    try {
      vector = JSON.parse(row.vector);
    } catch {
      continue;
    }
    if (!Array.isArray(vector) || vector.length !== query.length) continue;
    let dot = 0, qa = 0, va = 0;
    for (let i = 0; i < query.length; i++) {
      const q = query[i], v = vector[i];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        va = Number.NaN;
        break;
      }
      dot += q * v;
      qa += q * q;
      va += v * v;
    }
    const score = dot / Math.sqrt(qa * va);
    if (!Number.isFinite(score) || score < minSimilarity) continue;
    const current = best.get(row.path);
    if (!current || score > current.score)
      best.set(row.path, {
        path: row.path,
        title: row.title,
        hash: row.hash,
        kind: row.kind,
        score,
        chunkIndex: row.chunk_index,
        startChar: row.start_char,
        endChar: row.end_char
      });
  }
  const result = [...best.values()].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
  return {
    items: result,
    partial: totalEligible > rows.length,
    scanned: rows.length,
    totalEligible,
    nextCursor: null
  };
}
function resolveLinkTarget(target) {
  if (statements.get.get(target)) return target;
  if (target.includes("/")) return null;
  const rows = db.prepare("SELECT path FROM notes WHERE path LIKE ? LIMIT 2").all(`%/${target}`);
  return rows.length === 1 ? rows[0].path : null;
}
function noteTitle(path) {
  return db.prepare("SELECT title FROM notes WHERE path=?").get(path)?.title || path.split("/").at(-1).slice(0, -3);
}
async function noteLinks(args) {
  await flushDirty();
  const path = validateNote(String(args.path || ""));
  const outgoing = [];
  for (const { target } of db.prepare("SELECT target FROM links WHERE source=? ORDER BY target").all(path)) {
    const resolved = resolveLinkTarget(target);
    outgoing.push(
      resolved ? { path: resolved, title: noteTitle(resolved), exists: true } : { path: target, title: target.split("/").at(-1).slice(0, -3), exists: false }
    );
  }
  const name = path.split("/").at(-1);
  const targets = resolveLinkTarget(name) === path ? [path, name] : [path, path];
  const incoming = db.prepare("SELECT DISTINCT source FROM links WHERE target=? OR target=? ORDER BY source LIMIT 200").all(...targets).map(({ source }) => source).filter((source) => source !== path).map((source) => ({ path: source, title: noteTitle(source), exists: true }));
  return { path, title: noteTitle(path), outgoing, incoming, revision };
}
async function graphNeighbors(args) {
  await flushDirty();
  const project = args.project || "";
  const seeds = (Array.isArray(args.paths) ? args.paths : []).slice(0, 6).map(String);
  const per = Math.max(1, Math.min(12, Math.floor(args.perSeed || 8)));
  const noteRow = db.prepare("SELECT path,title,kind,hash,body,scope FROM notes WHERE path=?");
  const visible = (row) => row && (row.kind === "note" || row.kind === "wiki") && (row.scope === "shared" || row.scope === project);
  const degreeOf = (path) => {
    const name = path.split("/").at(-1);
    const out = db.prepare("SELECT COUNT(*) c FROM links WHERE source=?").get(path).c;
    const inc = db.prepare("SELECT COUNT(DISTINCT source) c FROM links WHERE target=? OR target=?").get(path, name).c;
    return out + inc;
  };
  const items = [];
  for (const seed of seeds) {
    let seedPath;
    try {
      seedPath = validateNote(seed);
    } catch {
      continue;
    }
    const seedRow = noteRow.get(seedPath);
    if (!visible(seedRow)) continue;
    const found = /* @__PURE__ */ new Map();
    for (const { target } of db.prepare("SELECT target FROM links WHERE source=? ORDER BY target LIMIT 64").all(seedPath)) {
      const resolved = resolveLinkTarget(target);
      if (resolved && resolved !== seedPath && !found.has(resolved)) found.set(resolved, { direction: "outgoing" });
    }
    const name = seedPath.split("/").at(-1);
    const targets = resolveLinkTarget(name) === seedPath ? [seedPath, name] : [seedPath, seedPath];
    for (const { source } of db.prepare("SELECT DISTINCT source FROM links WHERE target=? OR target=? ORDER BY source LIMIT 64").all(...targets))
      if (source !== seedPath && !found.has(source)) found.set(source, { direction: "backlink" });
    const rows = [];
    for (const [path, meta] of found) {
      const row = noteRow.get(path);
      if (!visible(row)) continue;
      rows.push({
        from: seedPath,
        path,
        title: row.title,
        kind: row.kind,
        hash: row.hash,
        direction: meta.direction,
        degree: degreeOf(path),
        ...meta.direction === "backlink" ? { context: backlinkContext(row.body, seedPath) } : {}
      });
    }
    rows.sort((a, b) => b.degree - a.degree || a.path.localeCompare(b.path));
    items.push(...rows.slice(0, per));
  }
  return { items, revision };
}
function noteIdentity(body) {
  if (typeof body !== "string") return null;
  const match = body.match(/^(?:---[\s\S]*?\n)?(?:doi|DOI|pmid|PMID|arxiv|ArXiv)\s*:\s*([^\s#]+)\s*$/m);
  if (!match?.[1]) return null;
  const field = match[0].split(":", 1)[0]?.toLowerCase();
  return `${field}:${match[1].replace(/[<>"']/g, "").trim()}`;
}
async function knowledgeGraph(args) {
  await flushDirty();
  const limit = Math.max(10, Math.min(400, Math.floor(args.limit || 200)));
  const allNotes = new Map(
    db.prepare("SELECT path,title,kind,scope,body FROM notes").all().map((row) => [row.path, row])
  );
  const notes = new Map([...allNotes].filter(([, row]) => row.kind === "note" || row.kind === "wiki"));
  const rawEdges = [];
  for (const { source, target } of db.prepare("SELECT source,target FROM links").all()) {
    if (!notes.has(source)) continue;
    const resolved = resolveLinkTarget(target);
    if (!resolved || resolved === source || !notes.has(resolved)) continue;
    rawEdges.push({ source, target: resolved, type: "link" });
  }
  const degree = /* @__PURE__ */ new Map();
  for (const edge of rawEdges) {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  }
  const legacyEdges = /* @__PURE__ */ new Map();
  for (const edge of rawEdges) {
    const key = edge.source < edge.target ? `${edge.source}\0${edge.target}` : `${edge.target}\0${edge.source}`;
    legacyEdges.set(key, [edge.source, edge.target]);
  }
  const legacyDegree = /* @__PURE__ */ new Map();
  for (const [source, target] of legacyEdges.values()) {
    legacyDegree.set(source, (legacyDegree.get(source) || 0) + 1);
    legacyDegree.set(target, (legacyDegree.get(target) || 0) + 1);
  }
  const legacyChosen = [...notes.keys()].sort((a, b) => (legacyDegree.get(b) || 0) - (legacyDegree.get(a) || 0) || a.localeCompare(b)).slice(0, limit);
  const legacyKeep = new Set(legacyChosen);
  const model = createSemanticModel(
    {
      nodes: [...allNotes.values()].map((row) => ({
        path: row.path,
        title: row.title,
        kind: row.kind,
        scope: row.scope,
        degree: degree.get(row.path) || 0,
        identity: noteIdentity(row.body)
      })),
      edges: rawEdges
    },
    { view: args.view === "all" ? "all" : "semantic", mergeMirrors: args.mergeMirrors !== false }
  );
  const chosen = [...model.nodes].sort((a, b) => b.degree - a.degree || a.path.localeCompare(b.path)).slice(0, limit);
  const keep = new Set(chosen.map((node) => node.path));
  const links = model.edges.filter(({ source, target }) => keep.has(source) && keep.has(target));
  const relations = (model.relations || []).filter(({ source, target }) => keep.has(source) && keep.has(target));
  return {
    nodes: legacyChosen.map((path) => ({ path, title: notes.get(path).title, kind: notes.get(path).kind, degree: legacyDegree.get(path) || 0 })),
    edges: [...legacyEdges.values()].filter(([source, target]) => legacyKeep.has(source) && legacyKeep.has(target)).map(([source, target]) => ({ source, target })),
    totalNotes: notes.size,
    revision,
    semantic: {
      nodes: chosen.map((node) => ({ ...node })),
      edges: links,
      totalNotes: model.nodes.length,
      view: args.view === "all" ? "all" : "semantic",
      mergeMirrors: args.mergeMirrors !== false,
      relations,
      duplicates: (model.duplicates || []).filter(({ canonical, duplicate }) => keep.has(canonical) || keep.has(duplicate)),
      communities: Object.fromEntries(Object.entries(model.communities || {}).filter(([path]) => keep.has(path))),
      layout: Object.fromEntries(Object.entries(model.layout || {}).filter(([path]) => keep.has(path))),
      health: {
        isolated: chosen.filter((node) => node.degree === 0).length,
        duplicates: model.duplicates?.length || 0,
        infrastructure: chosen.filter((node) => node.isInfrastructure).length
      }
    }
  };
}
async function dispatch(op, args) {
  if (op === "status") {
    if (args.flushPending) await flushDirty();
    return { ...status(), semanticScoped: semanticStatus(args.fingerprint, args.project) };
  }
  if (op === "read") return read(args.path, args.project, args);
  if (op === "search") return search(args);
  if (op === "noteLinks") return noteLinks(args);
  if (op === "graph") return knowledgeGraph(args);
  if (op === "graphNeighbors") return graphNeighbors(args);
  if (op === "hydrateCandidates") return hydrateCandidates(args);
  if (op === "semanticBatch") return semanticBatch(args);
  if (op === "semanticStore") return semanticStore(args);
  if (op === "semanticCandidates") return semanticCandidates(args);
  if (op === "warm") {
    void beginReconcile();
    return status();
  }
  if (op === "reconcile") {
    const pendingScan = Boolean(scan);
    fullScanRequested = false;
    await beginReconcile(!!args.force);
    if (pendingScan) await beginReconcile(!!args.force);
    await flushDirty();
    if (scan) await scan;
    return status();
  }
  if (op === "changed") {
    for (const path of args.paths.slice(0, 100)) {
      const previous = statements.get.get(path);
      let signature = null;
      try {
        signature = (await inspectNote(workerData.vault, path)).signature;
      } catch {
      }
      if (previous?.signature === signature && signature) continue;
      await updatePath(path, true);
      dirty.delete(path);
    }
    return status();
  }
  if (op === "enqueueNavigation") {
    const project = args.project;
    if (project && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project)) throw new Error("Invalid project scope");
    if (project) job("navigation", `Projects/${project}/Index.md`, project);
    job("navigation", "Library/Index.md", "shared");
    return status();
  }
  if (op === "uiJobs") {
    const offset = Math.max(0, Math.min(1e5, Math.floor(args.offset || 0))), limit = Math.max(1, Math.min(50, Math.floor(args.limit || 20)));
    const scope = args.project || "";
    const where = "(scope='shared' OR scope=?)";
    const total = Number(db.prepare(`SELECT count(*) n FROM jobs WHERE ${where}`).get(scope).n);
    const items = db.prepare(`SELECT * FROM jobs WHERE ${where} ORDER BY updated DESC,key LIMIT ? OFFSET ?`).all(scope, limit, offset);
    return { items, total, offset, nextOffset: offset + items.length < total ? offset + items.length : null };
  }
  if (op === "jobs") return { ...status(), items: pending(args.project, 100, args.kind || null) };
  if (op === "completeJob") {
    db.prepare("DELETE FROM jobs WHERE key=? AND revision=?").run(args.key, args.revision);
    return status();
  }
  if (op === "navigation") {
    const scope = args.project || "shared";
    const filter = args.targetPath === "Wiki/Index.md" ? "AND kind='wiki' AND path LIKE 'Wiki/%'" : args.targetPath === "Library/Index.md" ? "AND path LIKE 'Library/%'" : "AND kind!='navigation'";
    return db.prepare(`SELECT path,title,kind FROM notes WHERE scope=? ${filter} ORDER BY path LIMIT 61`).all(scope);
  }
  throw new Error("Unknown knowledge operation");
}
parentPort.on("message", async ({ id, op, args = {} }) => {
  if (op === "close") {
    try {
      await closeWorker();
      parentPort.postMessage({ id, result: { closed: true } });
      parentPort.close();
    } catch (error) {
      parentPort.postMessage({ id, error: String(error.message) });
    }
    return;
  }
  if (_closed) {
    parentPort.postMessage({ id, error: "Knowledge worker is closing" });
    return;
  }
  const task = dispatch(op, args);
  activeRequests.add(task);
  try {
    const result = await task;
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error.message) });
  } finally {
    activeRequests.delete(task);
  }
});
parentPort.postMessage({ ready: true });
