// @ts-nocheck
// packages/extensions/src/workspace-config.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { access, mkdir as mkdir3, readFile as readFile3, realpath as realpath3, rename as rename3, writeFile as writeFile3 } from "node:fs/promises";
import { dirname as dirname2, isAbsolute as isAbsolute3, join as join3, relative as relative2, resolve as resolve3, sep as sep2 } from "node:path";
import { pathToFileURL } from "node:url";

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

// packages/knowledge/src/flow-cards.ts
var OK = /* @__PURE__ */ new Set([
  "verified",
  "saved",
  "reused",
  "both-verified",
  "attachment-indexed-not-read",
  "applied",
  "written",
  "note-written",
  "summary-written",
  "explainer-archived",
  "setup-complete",
  "\u5DF2\u4FDD\u5B58",
  "archived",
  "found",
  "ready"
]);
var ERROR = /* @__PURE__ */ new Set([
  "failed",
  "identity-mismatch",
  "missing",
  "blocked",
  "cancelled",
  "not-found",
  "error"
]);
var MUTED = /* @__PURE__ */ new Set(["unknown", "unavailable", "pending"]);
var clip = (value, max) => typeof value === "string" && value ? value.slice(0, max) : null;
function statusTone(status) {
  const value = String(status || "");
  if (OK.has(value)) return "ok";
  if (ERROR.has(value)) return "error";
  if (MUTED.has(value)) return "muted";
  return "warn";
}
function cardLink(kind, target, label, i18n) {
  if (!["external", "resource", "note", "path"].includes(kind) || typeof target !== "string" || !target)
    return null;
  return {
    label: clip(label, 60) || kind,
    ...i18n ? { i18n } : {},
    kind,
    target: target.slice(0, 4096)
  };
}
function flowCard(input) {
  const { key, kind, title, subtitle, status, tone, detail, path, fields, links, source, provisionalTitle } = input;
  const state = clip(String(status ?? ""), 32) || "unknown";
  const safeKind = clip(kind, 40) || "artifact";
  return {
    key: clip(String(key ?? ""), 512) || `${kind}:${title}`,
    kind: safeKind,
    title: clip(String(title ?? ""), 200) || kind || "artifact",
    provisionalTitle: provisionalTitle === true,
    subtitle: clip(subtitle, 300),
    status: state,
    tone: tone || statusTone(state),
    detail: clip(detail, 400),
    path: clip(path, 4096),
    fields: (fields || []).filter(Boolean).slice(0, 12),
    links: (links || []).filter(Boolean).slice(0, 6),
    source: clip(source, 80),
    at: Date.now()
  };
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
var TOOL_MANIFEST_EVENT = "drone:tool-manifest/v1";
function registerTool(pi, definition) {
  void pi.events?.emit?.(TOOL_MANIFEST_EVENT, {
    version: 1,
    name: definition.name,
    meta: definition.drone || {}
  });
  if (process.env.PI_SUBAGENT_CHILD === "1" && definition.drone?.subagent === "exclude") return;
  pi.registerTool(definition);
}
var initializeVault = (path, project = null, profile = DEFAULT_VAULT_PROFILE) => initializeVaultLayout(path, { project, profile });
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
function storedPath(cwd, value) {
  if (value == null) return null;
  const absolute = resolve3(cwd, value);
  const rel = relative2(resolve3(cwd), absolute);
  return rel && !isAbsolute3(rel) && !rel.startsWith(`..${sep2}`) && rel !== ".." ? `./${rel.replaceAll(sep2, "/")}` : absolute;
}
async function saveWorkspaceConfig(cwd = process.cwd(), patch = {}) {
  const projectRoot = resolve3(cwd);
  if (knowledgeDirectory() && ["obsidianVault", "knowledgeProfile", "knowledgeDepositMode", "subagentMcpPolicy"].some(
    (key) => key in patch
  )) {
    throw new Error(
      "Vault policies are application-wide; use /obsidian-setup rather than a project override"
    );
  }
  const current = await loadWorkspaceConfig(projectRoot);
  const merged = {
    ...current,
    ...patch,
    resultsRoot: resolveConfiguredPath(projectRoot, patch.resultsRoot ?? current.resultsRoot),
    obsidianVault: resolveConfiguredPath(projectRoot, patch.obsidianVault ?? current.obsidianVault)
  };
  validatePatch({ ...merged, resultsRoot: String(merged.resultsRoot) });
  const payload = {
    resultsRoot: storedPath(projectRoot, merged.resultsRoot),
    obsidianVault: storedPath(projectRoot, merged.obsidianVault),
    maxConcurrentSubagents: merged.maxConcurrentSubagents,
    timezone: merged.timezone,
    knowledgeProfile: merged.knowledgeProfile,
    knowledgeDepositMode: merged.knowledgeDepositMode,
    subagentMcpPolicy: merged.subagentMcpPolicy
  };
  if (knowledgeDirectory()) {
    delete payload.obsidianVault;
    delete payload.knowledgeProfile;
    delete payload.knowledgeDepositMode;
    delete payload.subagentMcpPolicy;
    payload.knowledgeProjectId = projectIdentity(
      projectRoot,
      patch.knowledgeProjectId || merged.knowledgeProjectId
    );
  }
  const target = configPath(projectRoot);
  await mkdir3(dirname2(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile3(temporary, `${JSON.stringify(payload, null, 2)}
`, "utf8");
  await rename3(temporary, target);
  return {
    ...merged,
    resultsRoot: resolve3(merged.resultsRoot),
    obsidianVault: merged.obsidianVault && resolve3(merged.obsidianVault)
  };
}
function safeSegment(value, label) {
  const segment = String(value ?? "").trim();
  if (!segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) {
    throw new Error(`invalid ${label}`);
  }
  return segment;
}
function isWithin(root, target) {
  const rel = relative2(resolve3(root), resolve3(target));
  return rel === "" || !rel.startsWith(`..${sep2}`) && rel !== ".." && !isAbsolute3(rel);
}
function updateManagedBlock(original, body) {
  const start = "<!-- pi-agent:managed:start -->";
  const end = "<!-- pi-agent:managed:end -->";
  const replacement = `${start}
${String(body).trim()}
${end}`;
  const pattern = new RegExp(
    `${start.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}.*?${end.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}`,
    "s"
  );
  return pattern.test(original) ? original.replace(pattern, replacement) : `${original.trimEnd()}

${replacement}
`;
}
async function atomicText(path, text) {
  await mkdir3(dirname2(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile3(temporary, text, "utf8");
  await rename3(temporary, path);
}
async function writeSummary(runDir, summary, status) {
  const runPath = resolve3(runDir);
  const resultRoot = dirname2(runPath);
  const historyRoot = join3(resultRoot, "summary-history");
  await mkdir3(historyRoot, { recursive: true });
  const content = `${String(summary).trim()}
`;
  await atomicText(join3(runPath, "SUMMARY.md"), content);
  await atomicText(join3(resultRoot, "SUMMARY.md"), content);
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replaceAll(/[-:]/g, "").replace(".000", "").replace("Z", "Z");
  const history = join3(historyRoot, `${stamp}.md`);
  await atomicText(history, content);
  const metadataPath = join3(runPath, "metadata.json");
  let metadata = {};
  try {
    metadata = JSON.parse(await readFile3(metadataPath, "utf8"));
  } catch {
  }
  metadata.summary_status = status === "pending" ? "pending" : "written";
  metadata.summary_updated_at = (/* @__PURE__ */ new Date()).toISOString();
  await atomicText(metadataPath, `${JSON.stringify(metadata, null, 2)}
`);
  return { run: join3(runPath, "SUMMARY.md"), latest: join3(resultRoot, "SUMMARY.md"), history };
}
async function syncRunNote(vault, project, resultSlug, runDir, summary) {
  const safeProject = safeSegment(project || "default", "project");
  const safeSlug = safeSegment(resultSlug || "research-question", "result_slug");
  const runPath = resolve3(runDir);
  const metadataPath = join3(runPath, "metadata.json");
  let metadata = {};
  try {
    metadata = JSON.parse(await readFile3(metadataPath, "utf8"));
  } catch {
  }
  const runId = safeSegment(metadata.run_id || runPath.split(sep2).at(-1), "run_id");
  const note = await containedFile(vault, join3("Projects", safeProject, "Runs", `${safeSlug}-${runId}.md`));
  if (!knowledgeDirectory()) await initializeVault(vault, safeProject);
  const frontmatter = [
    "---",
    `id: pi-${randomUUID3()}`,
    `run_id: ${JSON.stringify(runId)}`,
    "type: run",
    `project: ${JSON.stringify(safeProject)}`,
    `result_slug: ${JSON.stringify(safeSlug)}`,
    `topic_id: ${JSON.stringify(metadata.topic_id || safeSlug.replace(/-20\d{6}(?:\d{6})?$/, ""))}`,
    `result_path: ${JSON.stringify(runPath)}`,
    `status: ${JSON.stringify(metadata.status || "unknown")}`,
    `created_at: ${JSON.stringify(metadata.started_at || "")}`,
    "---"
  ].join("\n");
  const resultUri = pathToFileURL(runPath).href;
  const summaryUri = pathToFileURL(join3(runPath, "SUMMARY.md")).href;
  let original = "";
  try {
    original = await readFile3(note, "utf8");
  } catch {
  }
  if (!original) {
    original = `${frontmatter}

# ${safeSlug} \xB7 ${runId}

## Agent-generated summary
${"<!-- pi-agent:managed:start -->"}
${String(summary).trim()}
<!-- pi-agent:managed:end -->

## Result files
- [Open result directory](${resultUri})
- [Open SUMMARY.md](${summaryUri})

## Human review

`;
    await atomicText(note, original);
  } else {
    await atomicText(note, updateManagedBlock(original, summary));
  }
  return note;
}
function runSummaryCard(event) {
  const d = event.result?.details || {};
  return flowCard({
    key: d.run || event.toolCallId,
    kind: "summary",
    title: "Run summary",
    status: d.partial ? "partial" : d.run ? "summary-written" : "failed",
    path: d.run,
    detail: d.obsidian_error || d.index_error || (d.obsidian_note ? "Vault run note saved." : "No Vault run note."),
    links: [
      d.run ? cardLink("path", d.run, "\u6253\u5F00", "flow.link.open") : null,
      d.obsidian_note ? cardLink("note", d.obsidian_note, "\u6253\u5F00\u7B14\u8BB0", "flow.link.openNote") : null
    ],
    source: event.toolName
  });
}
function registerWorkspaceConfig(pi, options = {}) {
  const baseCwd = options.cwd ? resolve3(options.cwd) : process.cwd();
  registerTool(pi, {
    name: "research_workspace_status",
    label: "Research workspace status",
    drone: { readOnly: true, capabilities: ["research"] },
    description: "Show result and Obsidian workspace configuration.",
    parameters: { type: "object", properties: {} },
    async execute(_id, _params, _signal, _update, ctx) {
      const config = await loadWorkspaceConfig(ctx?.cwd || baseCwd);
      return { content: [{ type: "text", text: JSON.stringify(config, null, 2) }], details: config };
    }
  });
  registerTool(pi, {
    name: "research_init_vault",
    label: "Initialize Obsidian vault",
    drone: { capabilities: ["research", "knowledge"], subagent: "exclude" },
    description: "Create the new Obsidian knowledge vault structure without overwriting files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        project: { type: "string" },
        profile: { type: "string", enum: ["project", "literature", "hybrid"] }
      },
      required: ["path"]
    },
    async execute(_id, params) {
      if (knowledgeDirectory())
        throw new Error("Use /obsidian-setup for confirmed application-wide initialization");
      const profile = params.profile || (await loadWorkspaceConfig(baseCwd)).knowledgeProfile;
      const result = await initializeVaultLayout(params.path, {
        project: params.project || null,
        profile,
        excluded: [baseCwd, (await loadWorkspaceConfig(baseCwd)).resultsRoot]
      });
      const config = await saveWorkspaceConfig(baseCwd, {
        obsidianVault: result.vault,
        knowledgeProfile: profile
      });
      return {
        content: [{ type: "text", text: `Initialized Obsidian vault at ${result.vault}` }],
        details: { result, config }
      };
    }
  });
  registerTool(pi, {
    name: "research_summarize_run",
    label: "Summarize research run",
    drone: {
      capabilities: ["research"],
      subagent: "exclude",
      activity: { text: "\u6B63\u5728\u6574\u7406\u672C\u8F6E\u7814\u7A76\u603B\u7ED3\u2026", phase: "synthesis" },
      flow: "summary",
      flowCards: runSummaryCard
    },
    description: "Write one parent-session summary to the run result and configured Obsidian vault. Before calling, extract the material evidence-backed observations into claims so later topic-memory updates can compare new knowledge with prior knowledge. Each claim must name the subject, predicate, source note/hash and whether it is an observation, interpretation, or hypothesis; never invent claims from an unverified summary.",
    parameters: {
      type: "object",
      properties: {
        run_dir: { type: "string" },
        summary_markdown: { type: "string" },
        project: { type: "string" },
        result_slug: { type: "string" },
        claims: {
          type: "array",
          description: "Structured evidence-backed claims for topic-memory conflict detection. Include only claims supported by sources actually read this turn; preserve different organisms, tissues, stages and methods as separate conditions. Omit this field only when the run contains no substantive claims.",
          maxItems: 24,
          items: {
            type: "object",
            properties: {
              claim: { type: "string", maxLength: 1200 },
              subject: { type: "string", maxLength: 180 },
              predicate: { type: "string", maxLength: 180 },
              value: { type: "string", maxLength: 600 },
              organism: { type: "string", maxLength: 180 },
              tissue: { type: "string", maxLength: 180 },
              stage: { type: "string", maxLength: 180 },
              method: { type: "string", maxLength: 180 },
              sourcePath: { type: "string", maxLength: 240 },
              sourceHash: { type: "string", minLength: 64, maxLength: 64 },
              location: { type: "string", maxLength: 120 },
              relation: { type: "string", enum: ["observation", "interpretation", "hypothesis"] }
            },
            required: ["claim", "subject", "predicate", "sourcePath", "sourceHash", "relation"]
          }
        }
      },
      required: ["run_dir", "summary_markdown"]
    },
    async execute(_id, params, _signal, _update, ctx) {
      const cwd = ctx?.cwd || baseCwd;
      const config = await loadWorkspaceConfig(cwd);
      const runDir = resolve3(cwd, params.run_dir);
      if (!isWithin(config.resultsRoot, runDir))
        throw new Error("run_dir must be inside the configured results root");
      if (!isWithin(await realpath3(config.resultsRoot), await realpath3(runDir)))
        throw new Error("run_dir escapes results root through a link");
      const relativeRun = relative2(config.resultsRoot, runDir);
      if (!relativeRun || relativeRun.startsWith(`..${sep2}`) || relativeRun.split(sep2).length !== 2 || !relativeRun.split(sep2)[1].startsWith("run-")) {
        throw new Error("run_dir must point to a run directory directly inside a result slug");
      }
      if (!await access(join3(runDir, "metadata.json")).then(
        () => true,
        () => false
      )) {
        throw new Error("run_dir is missing metadata.json");
      }
      const metadata = JSON.parse(await readFile3(join3(runDir, "metadata.json"), "utf8"));
      const gate = metadata.evidence_gate;
      if (gate?.stage !== "answerable" || gate.status !== "ok" || gate.answerable !== true || !Array.isArray(gate.claim_bindings) || gate.claim_bindings.length === 0) {
        throw new Error(
          "Evidence gate is closed: research_loop must complete retrieval, inspection, archiving and structured claim binding before summarization"
        );
      }
      const outputs = await writeSummary(runDir, params.summary_markdown, "succeeded");
      let note = null, indexes = null, obsidianError = null, indexError = null;
      if (config.obsidianVault) {
        const project = params.project || metadata.project;
        try {
          note = await syncRunNote(
            config.obsidianVault,
            project,
            params.result_slug || metadata.result_slug,
            runDir,
            params.summary_markdown
          );
        } catch (error) {
          obsidianError = String(error.message).slice(0, 600);
        }
        if (note) {
          try {
            indexes = await refreshProjectIndexes(config.obsidianVault, {
              project,
              profile: config.knowledgeProfile
            });
          } catch (error) {
            indexError = String(error.message).slice(0, 600);
          }
        }
      }
      const result = {
        ...outputs,
        claims: Array.isArray(params.claims) ? params.claims : [],
        obsidian_note: note,
        indexes,
        summary_saved: true,
        partial: Boolean(obsidianError || indexError),
        obsidian_error: obsidianError,
        index_error: indexError
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    }
  });
  pi.registerCommand("research-workspace", {
    description: "Show the configured result and Obsidian workspace",
    handler: async (_args, ctx) => {
      const config = await loadWorkspaceConfig(ctx.cwd);
      ctx.ui.notify(
        `Results: ${config.resultsRoot}; Obsidian: ${config.obsidianVault || "not configured"}`,
        "info"
      );
    }
  });
}
var workspace_config_default = registerWorkspaceConfig;
export {
  DEFAULT_WORKSPACE_CONFIG,
  workspace_config_default as default,
  initializeVault,
  loadWorkspaceConfig,
  registerWorkspaceConfig,
  saveWorkspaceConfig
};
