// @ts-nocheck
// packages/extensions/src/research-wikiskill.ts
import { spawn } from "node:child_process";
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";
import { access as access2, appendFile, cp, mkdir as mkdir3, readdir, readFile as readFile3, rename as rename3, writeFile as writeFile3 } from "node:fs/promises";
import { basename as basename2, dirname as dirname2, isAbsolute as isAbsolute3, join as join3, relative as relative2, resolve as resolve3, sep as sep2 } from "node:path";

// packages/extensions/src/workspace-config.ts
import { access, mkdir as mkdir2, readFile as readFile2, realpath as realpath2, rename as rename2, writeFile as writeFile2 } from "node:fs/promises";
import { dirname, isAbsolute as isAbsolute2, join as join2, relative, resolve as resolve2, sep } from "node:path";

// ../Drone/packages/knowledge/src/config.ts
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

// packages/extensions/src/internal/vault.ts
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

// packages/extensions/src/workspace-config.ts
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
  return join2(cwd, CONFIG_NAME);
}
function resolveConfiguredPath(cwd, value) {
  if (value == null || value === "") return null;
  return resolve2(cwd, value);
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
    const desktop = JSON.parse(await readFile2(process.env.PI_RESEARCH_DESKTOP_CONFIG, "utf8"));
    return {
      ...DEFAULT_WORKSPACE_CONFIG,
      resultsRoot: desktop.resultsRoot,
      obsidianVault: desktop.vaultStatus === "bound" ? desktop.obsidianVault : null,
      vaultWritePolicy: desktop.vaultWritePolicy,
      mcpStatus: desktop.mcpStatus
    };
  }
  const projectRoot = resolve2(cwd);
  let raw = {};
  try {
    raw = JSON.parse(await readFile2(configPath(projectRoot), "utf8"));
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

// packages/extensions/src/research-wikiskill.ts
var ALLOWED_SKILLS = /* @__PURE__ */ new Set(["research-workflow", "research-vault"]);
var MAX_SKILL_BYTES = 64 * 1024;
var WIKISKILL_BENCHMARKS = Object.freeze({
  "research-workflow": [
    {
      id: "local-first",
      prompt: "For a substantive literature question, state the retrieval order when paired local knowledge and web search are available, and when web search should be used.",
      mustInclude: ["local", "web"]
    },
    {
      id: "child-write-boundary",
      prompt: "A research subagent found useful evidence. State whether it may write the main Obsidian Vault and which session owns knowledge writes.",
      mustInclude: ["parent", "write"]
    },
    {
      id: "browser-failure",
      prompt: "A source retrieval returns browser_required. State whether this counts as verified evidence or successful retrieval.",
      mustInclude: ["not", "success"]
    },
    {
      id: "answer-gate",
      prompt: "State what must happen before a substantive research run can be summarized as answerable.",
      mustInclude: ["evidence", "claim"]
    },
    {
      id: "wiki-authority",
      prompt: "An agent-maintained research Wiki page contains a scientific claim. State how it may be used and what must support the final claim.",
      mustInclude: ["source", "not"]
    }
  ],
  "research-vault": [
    {
      id: "managed-block",
      prompt: "When updating an existing Obsidian research note, state which part the agent may overwrite and what it must preserve.",
      mustInclude: ["managed", "preserve"]
    },
    {
      id: "human-review",
      prompt: "State how agent writes should treat the Human review section of a research note.",
      mustInclude: ["human", "preserve"]
    },
    {
      id: "traceability",
      prompt: "What identifiers or links must a persisted research object retain before a Vault update is complete?",
      mustInclude: ["source", "identifier"]
    },
    {
      id: "large-artifacts",
      prompt: "Where should large research artifacts live relative to the Obsidian Vault?",
      mustInclude: ["result"]
    }
  ]
});
function safeSlug(value, label) {
  const text = String(value ?? "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)) throw new Error(`${label} must be lowercase kebab-case`);
  return text;
}
function within(root, target) {
  const rel = relative2(resolve3(root), resolve3(target));
  return rel === "" || !isAbsolute3(rel) && rel !== ".." && !rel.startsWith(`..${sep2}`);
}
async function readText(path, fallback = null) {
  try {
    return await readFile3(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}
async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile3(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== null) return fallback;
    throw error;
  }
}
async function atomicText(path, text) {
  await mkdir3(dirname2(path), { recursive: true });
  const temp = `${path}.${randomUUID2()}.tmp`;
  await writeFile3(temp, text, "utf8");
  await rename3(temp, path);
}
async function atomicJson(path, value) {
  return atomicText(path, `${JSON.stringify(value, null, 2)}
`);
}
function sha(text) {
  return createHash2("sha256").update(text).digest("hex");
}
function evolutionRoot(resultsRoot, project) {
  return join3(resultsRoot, ".wikiskill", project);
}
function skillPath(cwd, skill) {
  return join3(cwd, ".pi", "skills", skill, "SKILL.md");
}
var SOURCE_CATEGORIES = Object.freeze(["papers", "supplementary", "software", "manuals"]);
function validateRunDir(resultsRoot, candidate) {
  const runDir = resolve3(candidate);
  const rel = relative2(resolve3(resultsRoot), runDir);
  const parts = rel.split(sep2);
  if (!rel || !within(resultsRoot, runDir) || parts.length !== 2 || !parts[1].startsWith("run-")) {
    throw new Error("run_dir must point to a run directory directly inside the configured results root");
  }
  return runDir;
}
async function readSourceManifest(file, runDir) {
  try {
    const parsed = JSON.parse(await readFile3(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items))
      throw new Error("invalid manifest");
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, run_dir: runDir, updated_at: null, items: [] };
    throw error;
  }
}
async function sourceStatus({ cwd = process.cwd(), run_dir } = {}) {
  const config = await loadWorkspaceConfig(cwd);
  const runDir = run_dir ? validateRunDir(config.resultsRoot, resolve3(cwd, run_dir)) : null;
  if (!runDir) return { results_root: config.resultsRoot, categories: SOURCE_CATEGORIES, run_dir: null };
  const manifestPath = join3(runDir, "sources", "download-manifest.json");
  const failuresPath = join3(runDir, "sources", "download-failures.md");
  const manifest = await readSourceManifest(manifestPath, runDir);
  let failures = "";
  try {
    failures = await readFile3(failuresPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const manifestExists = await access2(manifestPath).then(
    () => true,
    () => false
  );
  const failuresExists = await access2(failuresPath).then(
    () => true,
    () => false
  );
  return {
    run_dir: runDir,
    manifest_path: manifestExists ? manifestPath : null,
    failures_path: failuresExists ? failuresPath : null,
    manifest,
    failure_count: manifest.failures?.length ?? Math.max(0, (failures.match(/^## /gm) || []).length)
  };
}
async function ensureEvolution(root) {
  await mkdir3(join3(root, "raw"), { recursive: true });
  await mkdir3(join3(root, "wiki", "patterns"), { recursive: true });
  await mkdir3(join3(root, "candidates"), { recursive: true });
  await mkdir3(join3(root, "history"), { recursive: true });
  for (const [name, content] of [
    ["wiki/index.md", "# WikiSkill patterns\n\n"],
    ["wiki/logs.md", "# WikiSkill evolution log\n\n"],
    ["wiki/skill-impact.md", "# WikiSkill skill impact\n\n"]
  ])
    if (await readText(join3(root, name)) === null) await atomicText(join3(root, name), content);
}
async function resolveRun(cwd, runDir) {
  const config = await loadWorkspaceConfig(cwd);
  const path = resolve3(cwd, runDir || "");
  if (!runDir || !within(config.resultsRoot, path))
    throw new Error("run_dir must stay inside the configured results root");
  const rel = relative2(config.resultsRoot, path).split(sep2);
  if (rel.length !== 2 || !rel[1].startsWith("run-"))
    throw new Error("run_dir must point to one research run");
  const metadata = await readJson(join3(path, "metadata.json"));
  return { config, path, metadata };
}
function renderPattern(pattern, occurrence) {
  const kind = ["failure", "success", "workaround", "policy"].includes(pattern.kind) ? pattern.kind : "workaround";
  return `# ${pattern.title.trim()}

- Pattern ID: \`${pattern.id}\`
- Kind: ${kind}
- Updated: ${occurrence.at}

## Problem

${pattern.problem.trim()}

## Reusable strategy

${pattern.strategy.trim()}

## Occurrences

- ${occurrence.at} \xB7 run \`${occurrence.run_id}\` \xB7 outcome: ${occurrence.outcome}
`;
}
async function recordWikiSkillExperience({
  cwd = process.cwd(),
  runDir,
  project,
  outcome,
  patterns = []
} = {}) {
  const { config, path, metadata } = await resolveRun(cwd, runDir);
  project = safeSlug(project || metadata.project || "research-workbench", "project");
  if (!["success", "failure", "mixed"].includes(outcome))
    throw new Error("outcome must be success, failure, or mixed");
  if (!Array.isArray(patterns) || patterns.length === 0)
    throw new Error("patterns must contain at least one reusable observation");
  const root = evolutionRoot(config.resultsRoot, project);
  await ensureEvolution(root);
  const summary = await readText(join3(path, "SUMMARY.md"), "");
  const sources = await sourceStatus({ cwd, run_dir: path });
  const raw = {
    id: randomUUID2(),
    recorded_at: (/* @__PURE__ */ new Date()).toISOString(),
    project,
    outcome,
    run: {
      run_id: metadata.run_id,
      run_dir: path,
      result_slug: metadata.result_slug,
      query: metadata.query,
      status: metadata.status,
      evidence_gate: metadata.evidence_gate
    },
    summary: summary.slice(0, 64 * 1024),
    observable_source_state: {
      downloaded: (sources.manifest?.items || []).filter((item) => item.status === "downloaded").length,
      failures: sources.failure_count || 0
    },
    note: "Observable run metadata only; hidden chain-of-thought is intentionally not persisted."
  };
  const rawPath = join3(root, "raw", `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${raw.id}.json`);
  await atomicJson(rawPath, raw);
  const occurrence = { at: raw.recorded_at, run_id: metadata.run_id, outcome, raw_path: rawPath };
  const touched = [];
  for (const item of patterns) {
    const pattern = { ...item, id: safeSlug(item.id, "pattern id") };
    if (!pattern.title?.trim() || !pattern.problem?.trim() || !pattern.strategy?.trim())
      throw new Error(`pattern ${pattern.id} requires title, problem and strategy`);
    const patternPath = join3(root, "wiki", "patterns", `${pattern.id}.md`);
    const existing = await readText(patternPath);
    if (existing === null) await atomicText(patternPath, renderPattern(pattern, occurrence));
    else
      await appendFile(
        patternPath,
        `
- ${occurrence.at} \xB7 run \`${occurrence.run_id}\` \xB7 outcome: ${occurrence.outcome}
`,
        "utf8"
      );
    touched.push({ id: pattern.id, path: patternPath });
  }
  const entries = (await readdir(join3(root, "wiki", "patterns"))).filter((name) => name.endsWith(".md")).sort().map((name) => `- [${basename2(name, ".md")}](patterns/${name})`).join("\n");
  await atomicText(join3(root, "wiki", "index.md"), `# WikiSkill patterns

${entries}
`);
  await appendFile(
    join3(root, "wiki", "logs.md"),
    `## ${raw.recorded_at}
- Run: ${metadata.run_id}
- Outcome: ${outcome}
- Raw: ${relative2(root, rawPath).replaceAll(sep2, "/")}
- Patterns: ${touched.map((x) => x.id).join(", ")}

`,
    "utf8"
  );
  return { root, raw_path: rawPath, patterns: touched };
}
function parseSkillName(markdown) {
  const match = String(markdown).match(/^---\s*\n[\s\S]*?^name:\s*([^\n]+)\n[\s\S]*?^---\s*$/m);
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") || null;
}
function safetyChecks(skill, markdown) {
  const text = String(markdown);
  const lower = text.toLowerCase();
  const errors = [];
  if (Buffer.byteLength(text, "utf8") > MAX_SKILL_BYTES) errors.push("candidate skill exceeds 64 KiB");
  if (parseSkillName(text) !== skill) errors.push("frontmatter name must match target skill");
  const required = skill === "research-workflow" ? ["local", "evidence", "parent", "archive", "claim", "unverified", "browser"] : ["managed", "source", "human", "verify"];
  for (const term of required)
    if (!lower.includes(term)) errors.push(`missing required safety concept: ${term}`);
  const forbidden = [
    /ignore\s+(?:the\s+)?evidence/i,
    /bypass\s+(?:the\s+)?evidence/i,
    /child\s+session[^\n]{0,80}write[^\n]{0,80}(?:vault|obsidian)/i
  ];
  for (const pattern of forbidden)
    if (pattern.test(text)) errors.push(`forbidden policy weakening: ${pattern}`);
  return { ok: errors.length === 0, errors };
}
async function proposeWikiSkill({
  cwd = process.cwd(),
  project,
  targetSkill,
  candidateMarkdown,
  patternIds = [],
  rationale = ""
} = {}) {
  project = safeSlug(project || "research-workbench", "project");
  targetSkill = safeSlug(targetSkill, "target_skill");
  if (!ALLOWED_SKILLS.has(targetSkill))
    throw new Error(`target_skill must be one of: ${[...ALLOWED_SKILLS].join(", ")}`);
  if (typeof candidateMarkdown !== "string" || !candidateMarkdown.trim())
    throw new Error("candidate_markdown is required");
  if (!Array.isArray(patternIds) || patternIds.length === 0)
    throw new Error("pattern_ids must identify the Wiki evidence motivating this proposal");
  const config = await loadWorkspaceConfig(cwd);
  const root = evolutionRoot(config.resultsRoot, project);
  await ensureEvolution(root);
  for (const id of patternIds)
    await access2(join3(root, "wiki", "patterns", `${safeSlug(id, "pattern id")}.md`));
  const active = await readText(skillPath(cwd, targetSkill));
  if (active === null) throw new Error(`active skill not found: ${targetSkill}`);
  const safety = safetyChecks(targetSkill, candidateMarkdown);
  const proposalId = `proposal-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${randomUUID2().slice(0, 8)}`;
  const dir = join3(root, "candidates", proposalId, targetSkill);
  await mkdir3(dir, { recursive: true });
  const candidatePath = join3(dir, "SKILL.md");
  await atomicText(candidatePath, `${candidateMarkdown.trimEnd()}
`);
  const proposal = {
    id: proposalId,
    created_at: (/* @__PURE__ */ new Date()).toISOString(),
    project,
    target_skill: targetSkill,
    pattern_ids: patternIds,
    rationale: String(rationale || ""),
    active_sha256: sha(active),
    candidate_sha256: sha(`${candidateMarkdown.trimEnd()}
`),
    candidate_path: candidatePath,
    safety
  };
  await atomicJson(join3(root, "candidates", proposalId, "proposal.json"), proposal);
  return { root, proposal };
}
async function runAgent({ cwd, skillFile, prompt, provider, model, timeoutMs = 9e4 } = {}) {
  const args = [
    "--approve",
    "--no-extensions",
    "--no-builtin-tools",
    "--no-skills",
    "--no-context-files",
    "--no-session",
    "--skill",
    skillFile,
    "--mode",
    "text",
    "--print"
  ];
  if (provider) args.push("--provider", provider);
  if (model) args.push("--model", model);
  args.push(`${prompt}

Answer concisely in English. Do not use tools.`);
  return await new Promise((resolvePromise) => {
    const child = spawn(process.env.PI_WIKISKILL_BIN || "pi", args, {
      cwd,
      env: { ...process.env, PI_SUBAGENT_CHILD: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 2e6) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 2e5) stderr = stderr.slice(-2e5);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ ok: false, output: stdout, error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        ok: code === 0,
        output: stdout.trim(),
        error: code === 0 ? null : stderr.trim() || `pi exited ${code}`
      });
    });
  });
}
function grade(output, task) {
  const text = String(output || "").toLowerCase();
  const required = (task.mustInclude || []).every((term) => text.includes(String(term).toLowerCase()));
  const forbidden = (task.mustNotInclude || []).some((term) => text.includes(String(term).toLowerCase()));
  return required && !forbidden ? 1 : 0;
}
async function evaluateSkill({ cwd, skillFile, tasks, provider, model, runner = runAgent } = {}) {
  const cases = [];
  for (const task of tasks) {
    const result = await runner({ cwd, skillFile, prompt: task.prompt, provider, model });
    cases.push({
      id: task.id,
      ok: result.ok,
      score: result.ok ? grade(result.output, task) : 0,
      output: result.output,
      error: result.error || null
    });
  }
  return { score: cases.reduce((sum, item) => sum + item.score, 0) / Math.max(1, cases.length), cases };
}
async function gateWikiSkillProposal({
  cwd = process.cwd(),
  project,
  proposalId,
  provider,
  model,
  runner = runAgent
} = {}) {
  project = safeSlug(project || "research-workbench", "project");
  const config = await loadWorkspaceConfig(cwd);
  const root = evolutionRoot(config.resultsRoot, project);
  await ensureEvolution(root);
  const proposal = await readJson(join3(root, "candidates", proposalId, "proposal.json"));
  if (!proposal.safety?.ok)
    throw new Error(`candidate safety gate failed: ${(proposal.safety?.errors || []).join("; ")}`);
  const skill = proposal.target_skill;
  const activePath = skillPath(cwd, skill);
  const active = await readText(activePath);
  if (active === null) throw new Error(`active skill not found: ${skill}`);
  if (sha(active) !== proposal.active_sha256)
    throw new Error("active skill changed after proposal; create a fresh proposal");
  const benchmarks = WIKISKILL_BENCHMARKS;
  const tasks = benchmarks[skill];
  const evalCwd = join3(root, "eval-sandbox");
  await mkdir3(evalCwd, { recursive: true });
  if (!Array.isArray(tasks) || tasks.length === 0) throw new Error(`no validation benchmark for ${skill}`);
  const statePath = join3(root, "state.json");
  const state = await readJson(statePath, { version: 1, best_scores: {}, baseline_cache: {} });
  const cacheKey = `${skill}:${proposal.active_sha256}:${provider || "default"}:${model || "default"}`;
  let baseline = state.baseline_cache?.[cacheKey];
  if (!baseline) {
    baseline = await evaluateSkill({ cwd: evalCwd, skillFile: activePath, tasks, provider, model, runner });
    state.baseline_cache = { ...state.baseline_cache || {}, [cacheKey]: baseline };
  }
  const candidate = await evaluateSkill({
    cwd: evalCwd,
    skillFile: proposal.candidate_path,
    tasks,
    provider,
    model,
    runner
  });
  const priorBest = Number(state.best_scores?.[skill]);
  const threshold = Number.isFinite(priorBest) ? Math.max(priorBest, baseline.score) : baseline.score;
  const allCasesRan = candidate.cases.every((item) => item.ok);
  const changed = proposal.candidate_sha256 !== proposal.active_sha256;
  const ceiling = threshold >= 1;
  const performancePass = ceiling ? candidate.score >= threshold : candidate.score > threshold;
  const accepted = allCasesRan && changed && performancePass;
  const at = (/* @__PURE__ */ new Date()).toISOString();
  if (accepted) {
    const backup = join3(
      root,
      "history",
      `${at.replace(/[:.]/g, "-")}-${skill}-${proposal.active_sha256.slice(0, 12)}.md`
    );
    await cp(activePath, backup);
    await atomicText(activePath, await readFile3(proposal.candidate_path, "utf8"));
    state.best_scores = { ...state.best_scores || {}, [skill]: candidate.score };
  }
  await atomicJson(statePath, state);
  const impact = {
    at,
    proposal_id: proposal.id,
    target_skill: skill,
    baseline_score: baseline.score,
    threshold,
    candidate_score: candidate.score,
    accepted,
    gate_mode: ceiling ? "non-regression-at-ceiling" : "strict-improvement",
    changed,
    provider: provider || null,
    model: model || null,
    pattern_ids: proposal.pattern_ids,
    candidate_sha256: proposal.candidate_sha256
  };
  await atomicJson(join3(root, "candidates", proposal.id, "validation.json"), { impact, baseline, candidate });
  await appendFile(
    join3(root, "wiki", "skill-impact.md"),
    `## ${at} \xB7 ${skill}
- Proposal: ${proposal.id}
- Patterns: ${proposal.pattern_ids.join(", ")}
- Baseline: ${baseline.score.toFixed(3)}
- Candidate: ${candidate.score.toFixed(3)}
- Threshold: ${threshold.toFixed(3)}
- Gate: ${ceiling ? "non-regression at benchmark ceiling" : "strict improvement"}
- Outcome: ${accepted ? "Accepted" : "Rejected"}
- Candidate SHA-256: ${proposal.candidate_sha256}

`,
    "utf8"
  );
  return { root, impact, baseline, candidate };
}
async function wikiSkillStatus({ cwd = process.cwd(), project } = {}) {
  project = safeSlug(project || "research-workbench", "project");
  const config = await loadWorkspaceConfig(cwd);
  const root = evolutionRoot(config.resultsRoot, project);
  await ensureEvolution(root);
  const count = async (path) => (await readdir(path).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error))).length;
  const state = await readJson(join3(root, "state.json"), { version: 1, best_scores: {}, baseline_cache: {} });
  return {
    project,
    root,
    raw_events: await count(join3(root, "raw")),
    patterns: await count(join3(root, "wiki", "patterns")),
    proposals: await count(join3(root, "candidates")),
    best_scores: state.best_scores || {}
  };
}
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
function researchWikiSkill(pi) {
  if (process.env.PI_SUBAGENT_CHILD === "1") return;
  registerTool(pi, {
    name: "research_wikiskill_record",
    label: "Compile research experience",
    drone: {
      capabilities: ["research", "knowledge"],
      subagent: "exclude",
      activity: { text: "\u6B63\u5728\u603B\u7ED3\u7814\u7A76\u7ECF\u9A8C\u2026", phase: "synthesis" }
    },
    description: "Compile one completed observable research run into the persistent WikiSkill raw/wiki layers. This stores auditable metadata and reusable process patterns, never hidden reasoning and never scientific claims as authority.",
    parameters: {
      type: "object",
      properties: {
        run_dir: { type: "string" },
        project: { type: "string" },
        outcome: { type: "string", enum: ["success", "failure", "mixed"] },
        patterns: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              kind: { type: "string", enum: ["failure", "success", "workaround", "policy"] },
              problem: { type: "string" },
              strategy: { type: "string" }
            },
            required: ["id", "title", "problem", "strategy"]
          }
        }
      },
      required: ["run_dir", "outcome", "patterns"]
    },
    async execute(_id, params, _signal, _update, ctx) {
      const result = await recordWikiSkillExperience({
        cwd: ctx.cwd,
        runDir: params.run_dir,
        project: params.project,
        outcome: params.outcome,
        patterns: params.patterns
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    }
  });
  registerTool(pi, {
    name: "research_wikiskill_propose",
    label: "Propose research Skill evolution",
    drone: {
      capabilities: ["research", "knowledge"],
      subagent: "exclude",
      activity: { text: "\u6B63\u5728\u6539\u8FDB\u7814\u7A76\u7B56\u7565\u2026", phase: "skill-evolution" }
    },
    description: "Stage one atomic SKILL.md candidate motivated by persistent WikiSkill patterns. The candidate is not active until it passes isolated validation gating.",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string" },
        target_skill: { type: "string", enum: ["research-workflow", "research-vault"] },
        candidate_markdown: { type: "string" },
        pattern_ids: { type: "array", minItems: 1, items: { type: "string" } },
        rationale: { type: "string" }
      },
      required: ["target_skill", "candidate_markdown", "pattern_ids"]
    },
    async execute(_id, params, _signal, _update, ctx) {
      const result = await proposeWikiSkill({
        cwd: ctx.cwd,
        project: params.project,
        targetSkill: params.target_skill,
        candidateMarkdown: params.candidate_markdown,
        patternIds: params.pattern_ids,
        rationale: params.rationale
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    }
  });
  registerTool(pi, {
    name: "research_wikiskill_gate",
    label: "Validate and gate research Skill",
    drone: {
      capabilities: ["research", "knowledge"],
      subagent: "exclude",
      activity: { text: "\u6B63\u5728\u9A8C\u8BC1\u65B0\u7684\u7814\u7A76\u7B56\u7565\u2026", phase: "verification" }
    },
    description: "Evaluate the active and candidate Skill in isolated no-tool Pi runs. Accept only a candidate that passes safety checks and scores strictly above both the active baseline and prior best; otherwise keep the active Skill while retaining Wiki history.",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string" },
        proposal_id: { type: "string" },
        provider: { type: "string" },
        model: { type: "string" }
      },
      required: ["proposal_id"]
    },
    async execute(_id, params, _signal, _update, ctx) {
      const result = await gateWikiSkillProposal({
        cwd: ctx.cwd,
        project: params.project,
        proposalId: params.proposal_id,
        provider: params.provider,
        model: params.model
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    }
  });
  registerTool(pi, {
    name: "research_wikiskill_status",
    label: "Research WikiSkill status",
    drone: {
      readOnly: true,
      capabilities: ["research", "knowledge"],
      activity: { text: "\u6B63\u5728\u68C0\u67E5\u7814\u7A76\u7B56\u7565\u72B6\u6001\u2026", phase: "verification" }
    },
    description: "Show the persistent experience/raw/wiki/proposal counts and best accepted validation scores for a project.",
    parameters: { type: "object", properties: { project: { type: "string" } } },
    async execute(_id, params, _signal, _update, ctx) {
      const result = await wikiSkillStatus({ cwd: ctx.cwd, project: params.project });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    }
  });
  pi.on?.("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}

WikiSkill evolution policy: the scientific knowledge path and the Skill-evolution Wiki are separate. During normal research, use Zotero/Obsidian/Web plus the evidence gate for factual claims; never cite WikiSkill patterns as scientific evidence. After a completed parent research run, compile only reusable observable process experience with research_wikiskill_record. When a pattern recurs or reveals a concrete workflow defect, stage one atomic update to research-workflow or research-vault with research_wikiskill_propose, then run research_wikiskill_gate. Never activate a proposal manually. A rejected candidate is discarded from the active Skill but its Wiki pattern and impact history persist. Do not store hidden chain-of-thought.`
  }));
}
export {
  researchWikiSkill as default,
  evaluateSkill,
  gateWikiSkillProposal,
  proposeWikiSkill,
  recordWikiSkillExperience,
  safetyChecks,
  wikiSkillStatus
};
