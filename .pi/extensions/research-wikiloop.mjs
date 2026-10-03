// @ts-nocheck
// packages/extensions/src/research-wikiloop.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { appendFile, mkdir as mkdir4, readdir as readdir2, readFile as readFile4, realpath as realpath4, rename as rename4, writeFile as writeFile4 } from "node:fs/promises";
import { basename as basename3, dirname as dirname3, join as join4, relative as relative3, resolve as resolve4, sep as sep3 } from "node:path";

// packages/knowledge/src/config.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
function createKnowledgeConfigState() {
  return { local: new AsyncLocalStorage(), queues: /* @__PURE__ */ new Map() };
}
function errorCode(error) {
  return error && typeof error === "object" && "code" in error ? error.code : void 0;
}
function knowledgeDirectory() {
  const value = process.env.DRONE_KNOWLEDGE_DIR;
  if (!value) return null;
  if (!isAbsolute(value)) throw new Error("DRONE_KNOWLEDGE_DIR must be absolute");
  return resolve(value);
}
function projectIdentity(cwd, configured) {
  if (typeof configured === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(configured)) return configured;
  const path = resolve(cwd);
  const stem = basename(path).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
  return `${stem}-${createHash("sha256").update(path).digest("hex").slice(0, 10)}`;
}
function validateBinding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 || !isAbsolute(String(value.vault || "")) || !/^[a-f0-9]{24}$/.test(String(value.vaultId || "")) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || !["project", "literature", "hybrid"].includes(String(value.profile)) || !["run-only", "verified", "rich"].includes(String(value.depositMode)) || !["none", "read-local"].includes(String(value.subagentPolicy)) || typeof value.updatedAt !== "string")
    throw new Error("Invalid application knowledge binding; no project fallback was used");
}
async function readKnowledgeBindingWithState(state, { fresh = false } = {}) {
  if (!fresh && state.local.getStore()) return state.local.getStore() ?? null;
  const directory = knowledgeDirectory();
  if (!directory) return null;
  let value;
  try {
    value = JSON.parse((await readFile(join(directory, "binding.json"), "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw new Error(
      `Knowledge binding cannot be read: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  validateBinding(value);
  return value;
}
async function readKnowledgeBinding(options = {}) {
  return readKnowledgeBindingWithState(defaultState, options);
}
var defaultState = createKnowledgeConfigState();

// packages/extensions/src/internal/runtime.ts
import { AsyncLocalStorage as AsyncLocalStorage2 } from "node:async_hooks";
var VERSION = 1;
var RUNTIME_EVENT = "drone:runtime/v1";
var RUNTIME_REQUEST_EVENT = "drone:runtime/request/v1";
var contexts = new AsyncLocalStorage2();
var hostRuntimes = /* @__PURE__ */ new WeakMap();
var hostCleanups = /* @__PURE__ */ new WeakMap();
var processRuntime;
var KeyedScheduler = class {
  tails = /* @__PURE__ */ new Map();
  disposed = false;
  async run(key, task) {
    if (this.disposed) throw new Error("Extension runtime scheduler has been disposed");
    const previous = this.tails.get(key) ?? Promise.resolve();
    let unlock;
    const gate = new Promise((resolve5) => {
      unlock = resolve5;
    });
    const tail = previous.then(() => gate);
    this.tails.set(key, tail);
    await previous;
    try {
      return await task();
    } finally {
      unlock();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
  dispose() {
    this.disposed = true;
    this.tails.clear();
  }
};
function createStandaloneRuntime() {
  const scheduler = new KeyedScheduler();
  let disposed = false;
  return {
    knowledge: {},
    tasks: {},
    tools: {},
    scheduler,
    registerDisposable(resource) {
      if (disposed) void (resource.dispose?.() ?? resource.close?.());
      return () => {
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scheduler.dispose();
    }
  };
}
function validRuntime(value) {
  return Boolean(
    value && typeof value === "object" && typeof value.scheduler?.run === "function"
  );
}
function bindExtensionRuntime(pi) {
  if (!pi || typeof pi !== "object" && typeof pi !== "function") return standaloneRuntime();
  const existing = hostRuntimes.get(pi);
  if (existing) return existing;
  let runtime = createStandaloneRuntime();
  hostRuntimes.set(pi, runtime);
  const events = pi.events;
  if (!events?.on || !events.emit) return runtime;
  const receive = (payload) => {
    if (!payload || typeof payload !== "object") return;
    const value = payload.runtime;
    if (payload.version !== VERSION || !validRuntime(value)) return;
    const previous = runtime;
    runtime = value;
    hostRuntimes.set(pi, runtime);
    if (previous !== runtime && typeof previous.dispose === "function") void previous.dispose();
  };
  const maybeCleanup = events.on(RUNTIME_EVENT, receive);
  hostCleanups.set(pi, () => {
    if (typeof maybeCleanup === "function") maybeCleanup();
    if (hostRuntimes.get(pi) === runtime) hostRuntimes.delete(pi);
    if (typeof runtime.dispose === "function") void runtime.dispose();
    hostCleanups.delete(pi);
  });
  void events.emit(RUNTIME_REQUEST_EVENT, { version: VERSION });
  return runtime;
}
function withExtensionRuntime(pi, operation) {
  const runtime = hostRuntimes.get(pi) ?? bindExtensionRuntime(pi);
  return contexts.run(runtime, operation);
}
function runExtensionExclusive(pi, key, task) {
  return Promise.resolve(
    withExtensionRuntime(pi, () => {
      const runtime = contexts.getStore() ?? standaloneRuntime();
      return runtime.scheduler.run(key, task);
    })
  );
}
function standaloneRuntime() {
  if (!processRuntime) processRuntime = createStandaloneRuntime();
  return processRuntime;
}

// packages/extensions/src/internal/vault.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import {
  link,
  lstat,
  mkdir as mkdir2,
  readdir,
  readFile as readFile2,
  realpath as realpath2,
  rename as rename2,
  stat,
  unlink,
  writeFile as writeFile2
} from "node:fs/promises";
import { basename as basename2, dirname, isAbsolute as isAbsolute2, join as join2, relative, resolve as resolve2, sep } from "node:path";
var VAULT_PROFILES = {
  project: {
    id: "project",
    projectTypes: [
      "Questions",
      "Concepts",
      "Entities",
      "Papers",
      "Sources",
      "Evidence",
      "Claims",
      "Decisions",
      "Runs",
      "Artifacts",
      "Wiki"
    ],
    libraryTypes: ["Papers", "Methods", "Software", "Explainers"]
  },
  literature: {
    id: "literature",
    projectTypes: ["Questions", "Papers", "Evidence", "Claims", "Runs", "Wiki"],
    libraryTypes: ["Papers", "Methods", "Concepts", "Software", "Entities", "Explainers"]
  },
  hybrid: {
    id: "hybrid",
    projectTypes: [
      "Questions",
      "Concepts",
      "Entities",
      "Papers",
      "Sources",
      "Evidence",
      "Claims",
      "Decisions",
      "Runs",
      "Artifacts",
      "Wiki"
    ],
    libraryTypes: ["Papers", "Methods", "Concepts", "Software", "Entities", "Explainers"]
  }
};
var DEFAULT_VAULT_PROFILE = "hybrid";
var SUBAGENT_MCP_POLICIES = ["none", "read-local"];
function getVaultProfile(id = DEFAULT_VAULT_PROFILE) {
  if (typeof id !== "string" || !(id in VAULT_PROFILES)) throw new Error(`Unknown knowledge profile: ${id}`);
  return VAULT_PROFILES[id];
}
var LAYOUT = {
  version: 3,
  templates: {
    Project: "project",
    Question: "question",
    Source: "source",
    Claim: "claim",
    Evidence: "evidence",
    Run: "run"
  },
  noteTemplate: '---\nid: "pi-{{uuid}}"\ntype: {{type}}\nproject: "{{project_slug}}"\nstatus: draft\ncreated: "{{date}}"\nupdated: "{{date}}"\ntags: []\n---\n\n# {{title}}\n\n<!-- pi-agent:managed:start -->\n{{project_content}}\n<!-- pi-agent:managed:end -->\n\n## Human review\n'
};
var MANAGED_START = "<!-- pi-agent:managed:start -->";
var MANAGED_END = "<!-- pi-agent:managed:end -->";
function containsPath(root, target) {
  const rel = relative(resolve2(root), resolve2(target));
  return rel === "" || !isAbsolute2(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}
async function canonicalPath(path) {
  try {
    return await realpath2(path);
  } catch (error) {
    if (error.code !== "ENOENT" || dirname(path) === path) throw error;
    return join2(await canonicalPath(dirname(path)), basename2(path));
  }
}
async function containedFile(root, path) {
  const target = resolve2(root, path);
  if (!containsPath(root, target) || !containsPath(root, await canonicalPath(target)))
    throw new Error("Path must stay inside Vault");
  return target;
}
async function validateVaultPath(input, excluded = []) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Vault path is required");
  if (input.split(/[\\/]/).includes("..")) throw new Error("Vault path must not contain traversal");
  const path = await canonicalPath(resolve2(input.trim()));
  if (path === resolve2(path, "..") || /^[a-z]:[\\/]*$/i.test(input))
    throw new Error("Vault cannot be a filesystem root");
  for (const other of excluded.filter(Boolean)) {
    const forbidden = await canonicalPath(resolve2(other));
    if (containsPath(path, forbidden) || containsPath(forbidden, path))
      throw new Error("Vault must be independent from workspace, results and product code");
  }
  try {
    if (!(await stat(path)).isDirectory()) throw new Error("Vault must be a directory");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return path;
}
async function createOnly(path, content) {
  await mkdir2(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID2()}.tmp`;
  await writeFile2(temporary, content, { encoding: "utf8", flag: "wx" });
  try {
    await link(temporary, path);
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await lstat(path);
    if (!existing.isFile() || existing.isSymbolicLink())
      throw new Error(`Expected a regular Vault file: ${path}`);
    return false;
  } finally {
    await unlink(temporary).catch(() => {
    });
  }
}
async function initializeVaultLayout(input, options = {}) {
  const vault = await validateVaultPath(input, options.excluded ?? []);
  const project = options.project ?? null;
  if (project !== null && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project))
    throw new Error("Invalid project slug");
  const selected = getVaultProfile(options.profile);
  const directories = [
    "Projects",
    "Templates",
    "Indexes",
    "Attachments",
    ".obsidian",
    ...selected.libraryTypes.map((type) => `Library/${type}`),
    ...selected.projectTypes.map((type) => `Projects/_template/${type}`),
    ...project ? selected.projectTypes.map((type) => `Projects/${project}/${type}`) : []
  ];
  for (const directory of directories) await containedFile(vault, directory);
  const notes = Object.fromEntries(
    Object.entries(LAYOUT.templates).map(([name, type]) => [
      `Templates/${name}.md`,
      LAYOUT.noteTemplate.replace("{{type}}", type)
    ])
  );
  const index = (title) => `# ${title}

${MANAGED_START}
${MANAGED_END}

## Human review
`;
  Object.assign(notes, {
    "Home.md": "# Pi Research Vault\n\n- [[Projects/Index]]\n- [[Indexes/Knowledge]]\n- [[Library/Index]]\n\n## Human review\n",
    "Projects/Index.md": index("Projects"),
    "Indexes/Projects.md": index("Projects"),
    "Indexes/Knowledge.md": index("Knowledge"),
    "Library/Index.md": index("Library"),
    "Projects/_template/Index.md": notes["Templates/Project.md"],
    ".obsidian/app.json": `${JSON.stringify(
      { useMarkdownLinks: false, newLinkFormat: "absolute", attachmentFolderPath: "Attachments" },
      null,
      2
    )}
`,
    ".obsidian/community-plugins.json": "[]\n"
  });
  for (const file of Object.keys(notes)) await containedFile(vault, file);
  for (const directory of directories) await mkdir2(join2(vault, directory), { recursive: true });
  for (const [file, content] of Object.entries(notes)) await createOnly(join2(vault, file), content);
  return {
    vault,
    directories: directories.map((directory) => join2(vault, directory)),
    templateVersion: LAYOUT.version,
    profile: selected
  };
}
async function readText(path) {
  try {
    return await readFile2(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function writeManagedIndex(path, heading, body) {
  const original = await readText(path) ?? `${heading}

## Human review

`;
  const start = original.indexOf(MANAGED_START);
  const end = original.indexOf(MANAGED_END);
  const block = `${MANAGED_START}
${body.trim()}
${MANAGED_END}`;
  let updated;
  if (start !== -1 || end !== -1) {
    if (start === -1 || end < start) throw new Error(`Invalid managed index markers: ${path}`);
    updated = original.slice(0, start) + block + original.slice(end + MANAGED_END.length);
  } else {
    const review = original.search(/^## Human review\s*$/m);
    updated = review < 0 ? `${original}${original.endsWith("\n") ? "\n" : "\n\n"}${block}
` : `${original.slice(0, review)}${block}

${original.slice(review)}`;
  }
  if (updated === original) return;
  await mkdir2(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID2()}.tmp`;
  await writeFile2(temporary, updated, "utf8");
  await rename2(temporary, path);
}
async function childEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function noteLinks(vault, directory) {
  const links = [];
  for (const entry of await childEntries(directory)) {
    const file = join2(directory, entry.name);
    if (entry.isDirectory()) links.push(...await noteLinks(vault, file));
    else if (entry.isFile() && entry.name.endsWith(".md")) {
      const target = relative(vault, file).replaceAll(sep, "/").slice(0, -3);
      if (!/[\]|#\r\n]/.test(target)) links.push(`- [[${target}]]`);
    }
  }
  return links.sort((a, b) => a.localeCompare(b));
}
async function categorizedLinks(vault, root, types) {
  const sections = [];
  for (const type of types) {
    const directory = await containedFile(vault, `${root}/${type}`);
    const links = await noteLinks(vault, directory);
    sections.push(`## ${type}

${links.join("\n")}`.trimEnd());
  }
  return sections.join("\n\n");
}
function validateProject(project) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(project))
    throw new Error("project must be a non-reserved lowercase kebab-case slug");
  return project;
}
async function refreshProjectIndexes(vault, options = {}) {
  const project = options.project ?? null;
  if (project !== null) validateProject(project);
  const profile = getVaultProfile(options.profile);
  const projectRoot = await containedFile(vault, "Projects");
  const projects = (await childEntries(projectRoot)).filter((entry) => entry.isDirectory() && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)).map((entry) => entry.name).sort();
  const projectIndexes = [];
  for (const slug of projects) {
    const index = await containedFile(vault, `Projects/${slug}/Index.md`);
    if (project === null || project === slug || await readText(index) === null) {
      const body = await categorizedLinks(vault, `Projects/${slug}`, profile.projectTypes);
      await writeManagedIndex(
        index,
        `---
type: project
project: ${JSON.stringify(slug)}
---

# ${slug}

[[Home]] | [[Projects/Index]] | [[Library/Index]]`,
        body
      );
    }
    projectIndexes.push(index);
  }
  const links = projects.map((slug) => `- [[Projects/${slug}/Index]]`).join("\n");
  const projectsIndex = await containedFile(vault, "Projects/Index.md");
  const legacyIndex = await containedFile(vault, "Indexes/Projects.md");
  const libraryIndex = await containedFile(vault, "Library/Index.md");
  await writeManagedIndex(projectsIndex, "# Projects\n\n[[Home]]", links);
  await writeManagedIndex(legacyIndex, "# Projects", links);
  await writeManagedIndex(
    libraryIndex,
    "# Library\n\n[[Home]]",
    await categorizedLinks(vault, "Library", profile.libraryTypes)
  );
  const knowledgeIndex = await containedFile(vault, "Indexes/Knowledge.md");
  await writeManagedIndex(
    knowledgeIndex,
    "# Knowledge",
    [links, "[[Library/Index]]"].filter(Boolean).join("\n\n")
  );
  return { projectsIndex, legacyIndex, libraryIndex, knowledgeIndex, projectIndexes };
}

// packages/extensions/src/workspace-config.ts
import { access, mkdir as mkdir3, readFile as readFile3, realpath as realpath3, rename as rename3, writeFile as writeFile3 } from "node:fs/promises";
import { dirname as dirname2, isAbsolute as isAbsolute3, join as join3, relative as relative2, resolve as resolve3, sep as sep2 } from "node:path";
var DEFAULT_WORKSPACE_CONFIG = Object.freeze({
  resultsRoot: "./results",
  obsidianVault: null,
  // Keep the compatibility fields present in every returned shape. The
  // legacy Obsidian adapter reads these fields even when no desktop binding
  // has been established yet.
  vaultWritePolicy: null,
  mcpStatus: null,
  knowledgeScope: "project",
  knowledgeProjectId: null,
  knowledgeBindingRevision: 0,
  legacyProjectVault: null,
  maxConcurrentSubagents: 3,
  timezone: "Asia/Shanghai",
  knowledgeProfile: DEFAULT_VAULT_PROFILE,
  knowledgeDepositMode: "verified",
  subagentMcpPolicy: "read-local"
});
var CONFIG_NAME = ".pi/research-workspace.json";
function configPath(cwd) {
  return join3(cwd, CONFIG_NAME);
}
function resolveConfiguredPath(cwd, value) {
  if (value == null || value === "") return null;
  return resolve3(cwd, value);
}
function validatePatch(config) {
  const max = Number(config.maxConcurrentSubagents);
  if (!Number.isInteger(max) || max < 1 || max > 3) {
    throw new Error("maxConcurrentSubagents must be an integer between 1 and 3");
  }
  if (typeof config.timezone !== "string" || !config.timezone.trim()) {
    throw new Error("timezone must be a non-empty string");
  }
  if (typeof config.resultsRoot !== "string" || !config.resultsRoot.trim()) {
    throw new Error("resultsRoot must be a non-empty path");
  }
  getVaultProfile(config.knowledgeProfile);
  if (!["run-only", "verified", "rich"].includes(config.knowledgeDepositMode)) {
    throw new Error("knowledgeDepositMode must be run-only, verified, or rich");
  }
  if (!SUBAGENT_MCP_POLICIES.includes(config.subagentMcpPolicy)) {
    throw new Error("subagentMcpPolicy must be none or read-local");
  }
}
async function loadWorkspaceConfig(cwd = process.cwd()) {
  if (process.env.PI_RESEARCH_DESKTOP_CONFIG) {
    const desktop = JSON.parse(await readFile3(process.env.PI_RESEARCH_DESKTOP_CONFIG, "utf8"));
    return {
      ...DEFAULT_WORKSPACE_CONFIG,
      resultsRoot: desktop.resultsRoot,
      obsidianVault: desktop.vaultStatus === "bound" ? desktop.obsidianVault : null,
      vaultWritePolicy: desktop.vaultWritePolicy,
      mcpStatus: desktop.mcpStatus
    };
  }
  const projectRoot = resolve3(cwd);
  let raw = {};
  try {
    raw = JSON.parse(await readFile3(configPath(projectRoot), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") raw = {};
  }
  const merged = { ...DEFAULT_WORKSPACE_CONFIG, ...raw };
  if (knowledgeDirectory()) {
    const binding = await readKnowledgeBinding();
    return {
      ...DEFAULT_WORKSPACE_CONFIG,
      resultsRoot: resolveConfiguredPath(
        projectRoot,
        typeof raw.resultsRoot === "string" && raw.resultsRoot.trim() ? raw.resultsRoot : DEFAULT_WORKSPACE_CONFIG.resultsRoot
      ),
      obsidianVault: binding?.vault || null,
      knowledgeProfile: binding?.profile || "hybrid",
      knowledgeDepositMode: binding?.depositMode || "verified",
      subagentMcpPolicy: binding?.subagentPolicy || "none",
      knowledgeScope: "application",
      knowledgeProjectId: projectIdentity(projectRoot, raw.knowledgeProjectId),
      knowledgeBindingRevision: binding?.revision || 0,
      legacyProjectVault: raw.obsidianVault || null,
      maxConcurrentSubagents: [1, 2, 3].includes(raw.maxConcurrentSubagents) ? raw.maxConcurrentSubagents : DEFAULT_WORKSPACE_CONFIG.maxConcurrentSubagents
    };
  }
  try {
    validatePatch(merged);
  } catch {
    return {
      ...DEFAULT_WORKSPACE_CONFIG,
      resultsRoot: resolveConfiguredPath(projectRoot, DEFAULT_WORKSPACE_CONFIG.resultsRoot),
      obsidianVault: null
    };
  }
  return {
    ...merged,
    resultsRoot: resolveConfiguredPath(projectRoot, merged.resultsRoot),
    obsidianVault: resolveConfiguredPath(projectRoot, merged.obsidianVault)
  };
}

// packages/extensions/src/research-wikiloop.ts
var MAX_QUERY_TERMS = 64;
var MAX_PAGE_BYTES = 256 * 1024;
var MAX_TOP_K = 12;
var TOOL_MANIFEST_EVENT = "drone:tool-manifest/v1";
function registerTool(pi, definition) {
  void pi?.events?.emit?.(TOOL_MANIFEST_EVENT, {
    version: 1,
    name: definition.name,
    meta: definition.drone || {}
  });
  if (process.env.PI_SUBAGENT_CHILD === "1" && definition.drone?.subagent === "exclude") return;
  pi.registerTool(definition);
}
function validateSegment(value, label) {
  const text = String(value ?? "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)) throw new Error(`${label} must be lowercase kebab-case`);
  return text;
}
function normalize(text) {
  return String(text ?? "").normalize("NFKC").toLowerCase();
}
function queryTerms(query) {
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
async function readText2(path) {
  try {
    return await readFile4(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function walkMarkdown(root) {
  const out = [];
  let entries = [];
  try {
    entries = await readdir2(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return out;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = join4(root, entry.name);
    if (entry.isDirectory()) out.push(...await walkMarkdown(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(path);
  }
  return out;
}
function titleOf(path, text) {
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename3(path, ".md");
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
  const plain = text.replace(/^---[\s\S]*?---\s*/m, "").replace(/<!--[\s\S]*?-->/g, " ").replace(/\s+/g, " ").trim();
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
  return join4(vault, "Projects", project, "Wiki");
}
async function navigateResearchWiki({ cwd = process.cwd(), project, query, topK = 5 } = {}) {
  project = validateSegment(project, "project");
  if (typeof query !== "string" || !query.trim()) throw new Error("query is required");
  topK = Math.max(1, Math.min(MAX_TOP_K, Number(topK) || 5));
  const config = await loadWorkspaceConfig(cwd);
  if (!config.obsidianVault) return { configured: false, project, query, hits: [], total_pages: 0 };
  const root = wikiRoot(config.obsidianVault, project);
  const terms = queryTerms(query);
  const pages = [];
  for (const path of await walkMarkdown(root)) {
    const text = await readText2(path);
    if (!text) continue;
    const title = titleOf(path, text);
    const score = scorePage(query, terms, title, text);
    if (score > 0) pages.push({ path, title, score, excerpt: excerptFor(text, terms) });
  }
  pages.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return {
    configured: true,
    project,
    query,
    terms,
    total_pages: (await walkMarkdown(root)).length,
    hits: pages.slice(0, topK).map((hit, i) => ({ ...hit, rank: i + 1 }))
  };
}
function managedBody({ content, sourceRefs, relatedPages }) {
  const sources = sourceRefs.length ? sourceRefs.map((value) => `- ${value}`).join("\n") : "- Unverified: no source reference supplied";
  const related = relatedPages.length ? `

## Related Wiki pages
${relatedPages.map((value) => `- [[${value}]]`).join("\n")}` : "";
  return `${String(content).trim()}

## Evidence references
${sources}${related}`;
}
function updateManaged(original, replacement) {
  const start = original.indexOf(MANAGED_START);
  const end = original.indexOf(MANAGED_END);
  if (start < 0 && end < 0)
    return `${original.trimEnd()}

${MANAGED_START}
${replacement}
${MANAGED_END}
`;
  if (start < 0 || end < start) throw new Error("invalid managed block markers");
  return `${original.slice(0, start)}${MANAGED_START}
${replacement}
${MANAGED_END}${original.slice(end + MANAGED_END.length)}`;
}
async function atomicText(path, text) {
  await mkdir4(dirname3(path), { recursive: true });
  const temp = `${path}.${randomUUID3()}.tmp`;
  await writeFile4(temp, text, "utf8");
  await rename4(temp, path);
}
async function rankFor(result, path) {
  const target = await realpath4(path).catch(() => resolve4(path));
  for (const hit of result.hits) {
    const candidate = await realpath4(hit.path).catch(() => resolve4(hit.path));
    if (candidate === target) return hit.rank;
  }
  return null;
}
async function buildResearchWikiPage({
  cwd = process.cwd(),
  project,
  slug,
  title,
  content,
  sourceRefs = [],
  relatedPages = [],
  validationQuery
} = {}) {
  if (knowledgeDirectory())
    throw new Error(
      "Application Wiki changes require research_propose_wiki_update and user /obsidian-review; the legacy Wiki writer is disabled"
    );
  project = validateSegment(project, "project");
  slug = validateSegment(slug, "slug");
  if (typeof title !== "string" || !title.trim()) throw new Error("title is required");
  if (typeof content !== "string" || !content.trim()) throw new Error("content is required");
  if (Buffer.byteLength(content, "utf8") > MAX_PAGE_BYTES) throw new Error("content exceeds 256 KiB");
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0)
    throw new Error("source_refs must contain at least one traceable source");
  if (typeof validationQuery !== "string" || !validationQuery.trim())
    throw new Error("validation_query is required");
  const config = await loadWorkspaceConfig(cwd);
  if (!config.obsidianVault) throw new Error("Obsidian vault is not configured");
  const before = await navigateResearchWiki({ cwd, project, query: validationQuery, topK: MAX_TOP_K });
  const initialized = await initializeVaultLayout(config.obsidianVault, {
    project,
    profile: config.knowledgeProfile
  });
  const vault = initialized.vault;
  const root = wikiRoot(vault, project);
  const path = join4(root, `${slug}.md`);
  const existing = await readText2(path);
  const body = managedBody({
    content,
    sourceRefs: sourceRefs.map(String),
    relatedPages: relatedPages.map(String)
  });
  const initial = `---
id: pi-wiki-${project}-${slug}
type: wiki
project: ${JSON.stringify(project)}
status: active
---

# ${title.trim()}

${MANAGED_START}
${body}
${MANAGED_END}

## Human review

`;
  await atomicText(path, existing === null ? initial : updateManaged(existing, body));
  await refreshProjectIndexes(vault, { project, profile: config.knowledgeProfile });
  const after = await navigateResearchWiki({ cwd, project, query: validationQuery, topK: MAX_TOP_K });
  const beforeRank = await rankFor(before, path);
  const afterRank = await rankFor(after, path);
  const feedback = {
    at: (/* @__PURE__ */ new Date()).toISOString(),
    project,
    page: relative3(vault, path).split(sep3).join("/"),
    query: validationQuery,
    before_rank: beforeRank,
    after_rank: afterRank,
    retrievable: afterRank !== null,
    improved: afterRank !== null && (beforeRank === null || afterRank < beforeRank)
  };
  await appendFile(join4(root, ".feedback.jsonl"), `${JSON.stringify(feedback)}
`, "utf8");
  return { path, feedback, before: before.hits.slice(0, 5), after: after.hits.slice(0, 5) };
}
async function researchWikiStatus({ cwd = process.cwd(), project } = {}) {
  project = validateSegment(project, "project");
  const config = await loadWorkspaceConfig(cwd);
  if (!config.obsidianVault) return { configured: false, project, pages: 0, feedback_events: 0 };
  const root = wikiRoot(config.obsidianVault, project);
  const pages = await walkMarkdown(root);
  const feedback = await readText2(join4(root, ".feedback.jsonl"));
  return {
    configured: true,
    project,
    root,
    pages: pages.length,
    feedback_events: feedback ? feedback.trim().split("\n").filter(Boolean).length : 0
  };
}
function researchWikiLoop(pi) {
  if (process.env.PI_SUBAGENT_CHILD === "1") return;
  bindExtensionRuntime(pi);
  registerTool(pi, {
    name: "research_wiki_navigate",
    label: "Navigate research Wiki",
    drone: {
      readOnly: true,
      recoverySafe: true,
      capabilities: ["research", "knowledge"],
      activity: { text: "\u6B63\u5728\u68C0\u7D22\u7814\u7A76 Wiki\u2026", phase: "knowledge-search" }
    },
    description: "Search the project agent-native Wiki before broader retrieval. Returns ranked pages and excerpts for downstream research.",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string" },
        query: { type: "string" },
        top_k: { type: "integer", minimum: 1, maximum: 12 }
      },
      required: ["project", "query"]
    },
    async execute(_id, params, _signal, _update, ctx) {
      return runExtensionExclusive(pi, "research-wiki-navigate", async () => {
        const result = await navigateResearchWiki({
          cwd: ctx.cwd,
          project: params.project,
          query: params.query,
          topK: params.top_k
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      });
    }
  });
  registerTool(pi, {
    name: "research_wiki_build",
    label: "Build research Wiki",
    drone: {
      capabilities: ["research", "knowledge"],
      subagent: "exclude",
      activity: { text: "\u6B63\u5728\u6C89\u6DC0\u7814\u7A76\u77E5\u8BC6\u2026", phase: "deposit" }
    },
    description: "Publish or revise one parent-reviewed Wiki page, then rerun the original query and report whether the page became retrievable. Requires traceable evidence references.",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string" },
        slug: { type: "string" },
        title: { type: "string" },
        content_markdown: { type: "string" },
        source_refs: { type: "array", items: { type: "string" }, minItems: 1 },
        related_pages: { type: "array", items: { type: "string" } },
        validation_query: { type: "string" }
      },
      required: ["project", "slug", "title", "content_markdown", "source_refs", "validation_query"]
    },
    async execute(_id, params, _signal, _update, ctx) {
      return runExtensionExclusive(pi, "research-wiki-build", async () => {
        const result = await buildResearchWikiPage({
          cwd: ctx.cwd,
          project: params.project,
          slug: params.slug,
          title: params.title,
          content: params.content_markdown,
          sourceRefs: params.source_refs,
          relatedPages: params.related_pages || [],
          validationQuery: params.validation_query
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      });
    }
  });
  registerTool(pi, {
    name: "research_wiki_status",
    label: "Research Wiki status",
    drone: { readOnly: true, capabilities: ["research", "knowledge"] },
    description: "Show project Wiki page count and downstream navigation feedback count.",
    parameters: { type: "object", properties: { project: { type: "string" } }, required: ["project"] },
    async execute(_id, params, _signal, _update, ctx) {
      return runExtensionExclusive(pi, "research-wiki-status", async () => {
        const result = await researchWikiStatus({ cwd: ctx.cwd, project: params.project });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      });
    }
  });
  pi.on?.("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}

Research Wiki loop: for substantive research, use research_wiki_navigate on the active project before broader local/Zotero/Web retrieval. Treat Wiki pages as navigation memory, never as final authority. After evidence is inspected and claims are supportable, the parent session may call research_wiki_build with traceable source_refs and the original research query. Inspect its retrieval feedback. If retrievable is false, improve the page title, links or concise evidence-bearing summary and retry at most twice. Never weaken evidence standards merely to improve Wiki retrieval. Child sessions never write the Wiki.`
  }));
}
export {
  buildResearchWikiPage,
  researchWikiLoop as default,
  navigateResearchWiki,
  queryTerms,
  researchWikiStatus
};
