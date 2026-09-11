import { knowledgeDirectory, readKnowledgeBinding, projectIdentity } from '../lib/knowledge/config.mjs';
import { readFile, writeFile, mkdir, rename, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initializeVaultLayout, containedFile } from "../lib/vault-layout.mjs";
import { DEFAULT_VAULT_PROFILE, getVaultProfile, SUBAGENT_MCP_POLICIES } from "../lib/vault-profiles.mjs";
const initializeVault = (path, project = null, profile = DEFAULT_VAULT_PROFILE) => initializeVaultLayout(path, { project, profile });

export const DEFAULT_WORKSPACE_CONFIG = Object.freeze({
  resultsRoot: "./results",
  obsidianVault: null,
  maxConcurrentSubagents: 3,
  timezone: "Asia/Shanghai",
  knowledgeProfile: DEFAULT_VAULT_PROFILE,
  knowledgeDepositMode: "verified",
  subagentMcpPolicy: "read-local",
});

const CONFIG_NAME = ".pi/research-workspace.json";

function configPath(cwd) {
  return join(cwd, CONFIG_NAME);
}

function resolveConfiguredPath(cwd, value) {
  if (value == null || value === "") return null;
  return resolve(cwd, value);
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

export async function loadWorkspaceConfig(cwd = process.cwd()) {
  if (process.env.PI_RESEARCH_DESKTOP_CONFIG) {
    const desktop = JSON.parse(await readFile(process.env.PI_RESEARCH_DESKTOP_CONFIG, "utf8"));
    return { ...DEFAULT_WORKSPACE_CONFIG, resultsRoot: desktop.resultsRoot, obsidianVault: desktop.vaultStatus === "bound" ? desktop.obsidianVault : null, vaultWritePolicy: desktop.vaultWritePolicy, mcpStatus: desktop.mcpStatus };
  }
  const projectRoot = resolve(cwd);
  let raw = {};
  try {
    raw = JSON.parse(await readFile(configPath(projectRoot), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") raw = {};
  }
  const merged = { ...DEFAULT_WORKSPACE_CONFIG, ...raw };
  if (knowledgeDirectory()) {
    const binding = await readKnowledgeBinding();
    return { ...DEFAULT_WORKSPACE_CONFIG,
      resultsRoot: resolveConfiguredPath(projectRoot, typeof raw.resultsRoot === "string" && raw.resultsRoot.trim() ? raw.resultsRoot : DEFAULT_WORKSPACE_CONFIG.resultsRoot),
      obsidianVault: binding?.vault || null,
      knowledgeProfile: binding?.profile || "hybrid", knowledgeDepositMode: binding?.depositMode || "verified",
      subagentMcpPolicy: binding?.subagentPolicy || "none", knowledgeScope: "application",
      knowledgeProjectId: projectIdentity(projectRoot, raw.knowledgeProjectId), knowledgeBindingRevision: binding?.revision || 0,
      legacyProjectVault: raw.obsidianVault || null,
      maxConcurrentSubagents: [1,2,3].includes(raw.maxConcurrentSubagents) ? raw.maxConcurrentSubagents : DEFAULT_WORKSPACE_CONFIG.maxConcurrentSubagents,
    };
  }
  try {
    validatePatch(merged);
  } catch {
    return {
      ...DEFAULT_WORKSPACE_CONFIG,
      resultsRoot: resolveConfiguredPath(projectRoot, DEFAULT_WORKSPACE_CONFIG.resultsRoot),
      obsidianVault: null,
    };
  }
  return {
    ...merged,
    resultsRoot: resolveConfiguredPath(projectRoot, merged.resultsRoot),
    obsidianVault: resolveConfiguredPath(projectRoot, merged.obsidianVault),
  };
}

function storedPath(cwd, value) {
  if (value == null) return null;
  const absolute = resolve(cwd, value);
  const rel = relative(resolve(cwd), absolute);
  return rel && !isAbsolute(rel) && !rel.startsWith(".." + sep) && rel !== ".." ? `./${rel.replaceAll(sep, "/")}` : absolute;
}

export async function saveWorkspaceConfig(cwd = process.cwd(), patch = {}) {
  const projectRoot = resolve(cwd);
  if (knowledgeDirectory() && ["obsidianVault","knowledgeProfile","knowledgeDepositMode","subagentMcpPolicy"].some(key => key in patch)) {
    throw new Error("Vault policies are application-wide; use /obsidian-setup rather than a project override");
  }
  const current = await loadWorkspaceConfig(projectRoot);
  const merged = {
    ...current,
    ...patch,
    resultsRoot: resolveConfiguredPath(projectRoot, patch.resultsRoot ?? current.resultsRoot),
    obsidianVault: resolveConfiguredPath(projectRoot, patch.obsidianVault ?? current.obsidianVault),
  };
  validatePatch({ ...merged, resultsRoot: String(merged.resultsRoot) });
  const payload = {
    resultsRoot: storedPath(projectRoot, merged.resultsRoot),
    obsidianVault: storedPath(projectRoot, merged.obsidianVault),
    maxConcurrentSubagents: merged.maxConcurrentSubagents,
    timezone: merged.timezone,
    knowledgeProfile: merged.knowledgeProfile,
    knowledgeDepositMode: merged.knowledgeDepositMode,
    subagentMcpPolicy: merged.subagentMcpPolicy,
  };
  if (knowledgeDirectory()) {
    delete payload.obsidianVault; delete payload.knowledgeProfile; delete payload.knowledgeDepositMode; delete payload.subagentMcpPolicy;
    payload.knowledgeProjectId = projectIdentity(projectRoot, patch.knowledgeProjectId || merged.knowledgeProjectId);
  }
  const target = configPath(projectRoot);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temporary, target);
  return { ...merged, resultsRoot: resolve(merged.resultsRoot), obsidianVault: merged.obsidianVault && resolve(merged.obsidianVault) };
}

function safeSegment(value, label) {
  const segment = String(value ?? "").trim();
  if (!segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) {
    throw new Error(`invalid ${label}`);
  }
  return segment;
}

export { initializeVault };

function isWithin(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}

function updateManagedBlock(original, body) {
  const start = "<!-- pi-agent:managed:start -->";
  const end = "<!-- pi-agent:managed:end -->";
  const replacement = `${start}\n${String(body).trim()}\n${end}`;
  const pattern = new RegExp(`${start.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}.*?${end.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}`, "s");
  return pattern.test(original) ? original.replace(pattern, replacement) : `${original.trimEnd()}\n\n${replacement}\n`;
}

async function atomicText(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, path);
}

async function writeSummary(runDir, summary, status) {
  const runPath = resolve(runDir);
  const resultRoot = dirname(runPath);
  const historyRoot = join(resultRoot, "summary-history");
  await mkdir(historyRoot, { recursive: true });
  const content = `${String(summary).trim()}\n`;
  await atomicText(join(runPath, "SUMMARY.md"), content);
  await atomicText(join(resultRoot, "SUMMARY.md"), content);
  const stamp = new Date().toISOString().replaceAll(/[-:]/g, "").replace(".000", "").replace("Z", "Z");
  const history = join(historyRoot, `${stamp}.md`);
  await atomicText(history, content);
  const metadataPath = join(runPath, "metadata.json");
  let metadata = {};
  try { metadata = JSON.parse(await readFile(metadataPath, "utf8")); } catch { /* metadata may be absent for a manually created run */ }
  metadata.summary_status = status === "pending" ? "pending" : "written";
  metadata.summary_updated_at = new Date().toISOString();
  await atomicText(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return { run: join(runPath, "SUMMARY.md"), latest: join(resultRoot, "SUMMARY.md"), history };
}

async function syncRunNote(vault, project, resultSlug, runDir, summary) {
  const safeProject = safeSegment(project || "default", "project");
  const safeSlug = safeSegment(resultSlug || "research-question", "result_slug");
  const runPath = resolve(runDir);
  const metadataPath = join(runPath, "metadata.json");
  let metadata = {};
  try { metadata = JSON.parse(await readFile(metadataPath, "utf8")); } catch { /* handled by frontmatter defaults */ }
  const runId = safeSegment(metadata.run_id || runPath.split(sep).at(-1), "run_id");
  const note = await containedFile(vault, join("Projects", safeProject, "Runs", `${safeSlug}-${runId}.md`));
  await initializeVault(vault, safeProject);
  const frontmatter = [
    "---",
    `id: pi-${randomUUID()}`,
    `run_id: ${JSON.stringify(runId)}`,
    "type: run",
    `project: ${JSON.stringify(safeProject)}`,
    `result_slug: ${JSON.stringify(safeSlug)}`,
    `result_path: ${JSON.stringify(runPath)}`,
    `status: ${JSON.stringify(metadata.status || "unknown")}`,
    `created_at: ${JSON.stringify(metadata.started_at || "")}`,
    "---",
  ].join("\n");
  const resultUri = pathToFileURL(runPath).href;
  const summaryUri = pathToFileURL(join(runPath, "SUMMARY.md")).href;
  let original = "";
  try { original = await readFile(note, "utf8"); } catch { /* new note */ }
  if (!original) {
    original = `${frontmatter}\n\n# ${safeSlug} · ${runId}\n\n## Agent-generated summary\n${"<!-- pi-agent:managed:start -->"}\n${String(summary).trim()}\n<!-- pi-agent:managed:end -->\n\n## Result files\n- [Open result directory](${resultUri})\n- [Open SUMMARY.md](${summaryUri})\n\n## Human review\n\n`;
    await atomicText(note, original);
  } else {
    await atomicText(note, updateManagedBlock(original, summary));
  }
  return note;
}

export function registerWorkspaceConfig(pi, options = {}) {
  const baseCwd = options.cwd ? resolve(options.cwd) : process.cwd();
  pi.registerTool({
    name: "research_workspace_status",
    label: "Research workspace status",
    description: "Show result and Obsidian workspace configuration.",
    parameters: { type: "object", properties: {} },
    async execute() {
      const config = await loadWorkspaceConfig(baseCwd);
      return { content: [{ type: "text", text: JSON.stringify(config, null, 2) }], details: config };
    },
  });
  pi.registerTool({
    name: "research_init_vault",
    label: "Initialize Obsidian vault",
    description: "Create the new Obsidian knowledge vault structure without overwriting files.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, project: { type: "string" }, profile: { type: "string", enum: ["project", "literature", "hybrid"] } },
      required: ["path"],
    },
    async execute(_id, params) {
      if (knowledgeDirectory()) throw new Error("Use /obsidian-setup for confirmed application-wide initialization");
      const profile = params.profile || (await loadWorkspaceConfig(baseCwd)).knowledgeProfile;
      const result = await initializeVaultLayout(params.path, { project: params.project || null, profile, excluded: [baseCwd, (await loadWorkspaceConfig(baseCwd)).resultsRoot] });
      const config = await saveWorkspaceConfig(baseCwd, { obsidianVault: result.vault, knowledgeProfile: profile });
      return { content: [{ type: "text", text: `Initialized Obsidian vault at ${result.vault}` }], details: { result, config } };
    },
  });
  pi.registerTool({
    name: "research_summarize_run",
    label: "Summarize research run",
    description: "Write one parent-session summary to the run result and configured Obsidian vault.",
    parameters: {
      type: "object",
      properties: { run_dir: { type: "string" }, summary_markdown: { type: "string" }, project: { type: "string" }, result_slug: { type: "string" } },
      required: ["run_dir", "summary_markdown"],
    },
    async execute(_id, params) {
      const cwd = baseCwd;
      const config = await loadWorkspaceConfig(cwd);
      const runDir = resolve(cwd, params.run_dir);
      if (!isWithin(config.resultsRoot, runDir)) throw new Error("run_dir must be inside the configured results root");
      const relativeRun = relative(config.resultsRoot, runDir);
      if (!relativeRun || relativeRun.startsWith(".." + sep) || relativeRun.split(sep).length !== 2 || !relativeRun.split(sep)[1].startsWith("run-")) {
        throw new Error("run_dir must point to a run directory directly inside a result slug");
      }
      if (!await access(join(runDir, "metadata.json")).then(() => true, () => false)) {
        throw new Error("run_dir is missing metadata.json");
      }
      const metadata = JSON.parse(await readFile(join(runDir, "metadata.json"), "utf8"));
      const gate = metadata.evidence_gate;
      if (!gate || gate.stage !== "answerable" || gate.status !== "ok" || gate.answerable !== true || !Array.isArray(gate.claim_refs) || gate.claim_refs.length === 0) {
        throw new Error("Evidence gate is closed: research_loop must complete retrieval, inspection, archiving and claim binding before summarization");
      }
      const outputs = await writeSummary(runDir, params.summary_markdown, "succeeded");
      let note = null;
      let indexes = null;
      if (config.obsidianVault) {
        const project = params.project || metadata.project;
        note = await syncRunNote(config.obsidianVault, project, params.result_slug || metadata.result_slug, runDir, params.summary_markdown);
        // Keep the dependency lazy: this module owns config persistence while the
        // workbench library imports it for vault setup.
        const { refreshProjectIndexes } = await import('../lib/obsidian-workbench.mjs');
        indexes = await refreshProjectIndexes({ cwd, project });
      }
      return { content: [{ type: "text", text: JSON.stringify({ ...outputs, obsidian_note: note, indexes }, null, 2) }], details: { ...outputs, obsidian_note: note, indexes } };
    },
  });
  pi.registerCommand("research-workspace", {
    description: "Show the configured result and Obsidian workspace",
    handler: async (_args, ctx) => {
      const config = await loadWorkspaceConfig(baseCwd);
      ctx.ui.notify(`Results: ${config.resultsRoot}; Obsidian: ${config.obsidianVault || "not configured"}`, "info");
    },
  });
}

export default registerWorkspaceConfig;
