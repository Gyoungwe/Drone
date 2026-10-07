// Self-contained research WikiSkill policy extension; no production dependency on .pi/lib.
// @ts-nocheck
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, appendFile, cp, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveWorkspaceProject, runProject, sessionEntriesOf } from "@drone/knowledge/project-identity";
import { loadWorkspaceConfig } from "./workspace-config";

const ALLOWED_SKILLS = new Set(["research-workflow", "research-vault"]);
const MAX_SKILL_BYTES = 64 * 1024;
const WIKISKILL_BENCHMARKS = Object.freeze({
	"research-workflow": [
		{
			id: "local-first",
			prompt:
				"For a substantive literature question, state the retrieval order when paired local knowledge and web search are available, and when web search should be used.",
			mustInclude: ["local", "web"],
		},
		{
			id: "child-write-boundary",
			prompt:
				"A research subagent found useful evidence. State whether it may write the main Obsidian Vault and which session owns knowledge writes.",
			mustInclude: ["parent", "write"],
		},
		{
			id: "browser-failure",
			prompt:
				"A source retrieval returns browser_required. State whether this counts as verified evidence or successful retrieval.",
			mustInclude: ["not", "success"],
		},
		{
			id: "answer-gate",
			prompt: "State what must happen before a substantive research run can be summarized as answerable.",
			mustInclude: ["evidence", "claim"],
		},
		{
			id: "wiki-authority",
			prompt:
				"An agent-maintained research Wiki page contains a scientific claim. State how it may be used and what must support the final claim.",
			mustInclude: ["source", "not"],
		},
	],
	"research-vault": [
		{
			id: "managed-block",
			prompt:
				"When updating an existing Obsidian research note, state which part the agent may overwrite and what it must preserve.",
			mustInclude: ["managed", "preserve"],
		},
		{
			id: "human-review",
			prompt: "State how agent writes should treat the Human review section of a research note.",
			mustInclude: ["human", "preserve"],
		},
		{
			id: "traceability",
			prompt:
				"What identifiers or links must a persisted research object retain before a Vault update is complete?",
			mustInclude: ["source", "identifier"],
		},
		{
			id: "large-artifacts",
			prompt: "Where should large research artifacts live relative to the Obsidian Vault?",
			mustInclude: ["result"],
		},
	],
});

function safeSlug(value, label) {
	const text = String(value ?? "").trim();
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)) throw new Error(`${label} must be lowercase kebab-case`);
	return text;
}
function within(root, target) {
	const rel = relative(resolve(root), resolve(target));
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
async function readText(path, fallback = null) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return fallback;
		throw error;
	}
}
async function readJson(path, fallback = null) {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT" && fallback !== null) return fallback;
		throw error;
	}
}
async function atomicText(path, text) {
	await mkdir(dirname(path), { recursive: true });
	const temp = `${path}.${randomUUID()}.tmp`;
	await writeFile(temp, text, "utf8");
	await rename(temp, path);
}
async function atomicJson(path, value) {
	return atomicText(path, `${JSON.stringify(value, null, 2)}\n`);
}
function sha(text) {
	return createHash("sha256").update(text).digest("hex");
}
/** Default WikiSkill namespace: the shared project resolver, including a daily-space session choice. */
async function sessionProject(ctx) {
	return (await resolveWorkspaceProject({ cwd: ctx.cwd, sessionEntries: sessionEntriesOf(ctx) })).project;
}
function evolutionRoot(resultsRoot, project) {
	return join(resultsRoot, ".wikiskill", project);
}
function skillPath(cwd, skill) {
	return join(cwd, ".pi", "skills", skill, "SKILL.md");
}

const SOURCE_CATEGORIES = Object.freeze(["papers", "supplementary", "software", "manuals"]);

function validateRunDir(resultsRoot, candidate) {
	const runDir = resolve(candidate);
	const rel = relative(resolve(resultsRoot), runDir);
	const parts = rel.split(sep);
	if (!rel || !within(resultsRoot, runDir) || parts.length !== 2 || !parts[1].startsWith("run-")) {
		throw new Error("run_dir must point to a run directory directly inside the configured results root");
	}
	return runDir;
}

async function readSourceManifest(file, runDir) {
	try {
		const parsed = JSON.parse(await readFile(file, "utf8"));
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
	const runDir = run_dir ? validateRunDir(config.resultsRoot, resolve(cwd, run_dir)) : null;
	if (!runDir) return { results_root: config.resultsRoot, categories: SOURCE_CATEGORIES, run_dir: null };
	const manifestPath = join(runDir, "sources", "download-manifest.json");
	const failuresPath = join(runDir, "sources", "download-failures.md");
	const manifest = await readSourceManifest(manifestPath, runDir);
	let failures = "";
	try {
		failures = await readFile(failuresPath, "utf8");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const manifestExists = await access(manifestPath).then(
		() => true,
		() => false,
	);
	const failuresExists = await access(failuresPath).then(
		() => true,
		() => false,
	);
	return {
		run_dir: runDir,
		manifest_path: manifestExists ? manifestPath : null,
		failures_path: failuresExists ? failuresPath : null,
		manifest,
		failure_count: manifest.failures?.length ?? Math.max(0, (failures.match(/^## /gm) || []).length),
	};
}

async function ensureEvolution(root) {
	await mkdir(join(root, "raw"), { recursive: true });
	await mkdir(join(root, "wiki", "patterns"), { recursive: true });
	await mkdir(join(root, "candidates"), { recursive: true });
	await mkdir(join(root, "history"), { recursive: true });
	for (const [name, content] of [
		["wiki/index.md", "# WikiSkill patterns\n\n"],
		["wiki/logs.md", "# WikiSkill evolution log\n\n"],
		["wiki/skill-impact.md", "# WikiSkill skill impact\n\n"],
	])
		if ((await readText(join(root, name))) === null) await atomicText(join(root, name), content);
}

async function resolveRun(cwd, runDir) {
	const config = await loadWorkspaceConfig(cwd);
	const path = resolve(cwd, runDir || "");
	if (!runDir || !within(config.resultsRoot, path))
		throw new Error("run_dir must stay inside the configured results root");
	const rel = relative(config.resultsRoot, path).split(sep);
	if (rel.length !== 2 || !rel[1].startsWith("run-"))
		throw new Error("run_dir must point to one research run");
	const metadata = await readJson(join(path, "metadata.json"));
	return { config, path, metadata };
}

function renderPattern(pattern, occurrence) {
	const kind = ["failure", "success", "workaround", "policy"].includes(pattern.kind)
		? pattern.kind
		: "workaround";
	return `# ${pattern.title.trim()}\n\n- Pattern ID: \`${pattern.id}\`\n- Kind: ${kind}\n- Updated: ${occurrence.at}\n\n## Problem\n\n${pattern.problem.trim()}\n\n## Reusable strategy\n\n${pattern.strategy.trim()}\n\n## Occurrences\n\n- ${occurrence.at} · run \`${occurrence.run_id}\` · outcome: ${occurrence.outcome}\n`;
}

export async function recordWikiSkillExperience({
	cwd = process.cwd(),
	runDir,
	project,
	outcome,
	patterns = [],
} = {}) {
	const { config, path, metadata } = await resolveRun(cwd, runDir);
	project = safeSlug(
		project || runProject(metadata.project, await resolveWorkspaceProject({ cwd })),
		"project",
	);
	if (!["success", "failure", "mixed"].includes(outcome))
		throw new Error("outcome must be success, failure, or mixed");
	if (!Array.isArray(patterns) || patterns.length === 0)
		throw new Error("patterns must contain at least one reusable observation");
	const root = evolutionRoot(config.resultsRoot, project);
	await ensureEvolution(root);
	const summary = await readText(join(path, "SUMMARY.md"), "");
	const sources = await sourceStatus({ cwd, run_dir: path });
	const raw = {
		id: randomUUID(),
		recorded_at: new Date().toISOString(),
		project,
		outcome,
		run: {
			run_id: metadata.run_id,
			run_dir: path,
			result_slug: metadata.result_slug,
			query: metadata.query,
			status: metadata.status,
			evidence_gate: metadata.evidence_gate,
		},
		summary: summary.slice(0, 64 * 1024),
		observable_source_state: {
			downloaded: (sources.manifest?.items || []).filter((item) => item.status === "downloaded").length,
			failures: sources.failure_count || 0,
		},
		note: "Observable run metadata only; hidden chain-of-thought is intentionally not persisted.",
	};
	const rawPath = join(root, "raw", `${new Date().toISOString().replace(/[:.]/g, "-")}-${raw.id}.json`);
	await atomicJson(rawPath, raw);
	const occurrence = { at: raw.recorded_at, run_id: metadata.run_id, outcome, raw_path: rawPath };
	const touched = [];
	for (const item of patterns) {
		const pattern = { ...item, id: safeSlug(item.id, "pattern id") };
		if (!pattern.title?.trim() || !pattern.problem?.trim() || !pattern.strategy?.trim())
			throw new Error(`pattern ${pattern.id} requires title, problem and strategy`);
		const patternPath = join(root, "wiki", "patterns", `${pattern.id}.md`);
		const existing = await readText(patternPath);
		if (existing === null) await atomicText(patternPath, renderPattern(pattern, occurrence));
		else
			await appendFile(
				patternPath,
				`\n- ${occurrence.at} · run \`${occurrence.run_id}\` · outcome: ${occurrence.outcome}\n`,
				"utf8",
			);
		touched.push({ id: pattern.id, path: patternPath });
	}
	const entries = (await readdir(join(root, "wiki", "patterns")))
		.filter((name) => name.endsWith(".md"))
		.sort()
		.map((name) => `- [${basename(name, ".md")}](patterns/${name})`)
		.join("\n");
	await atomicText(join(root, "wiki", "index.md"), `# WikiSkill patterns\n\n${entries}\n`);
	await appendFile(
		join(root, "wiki", "logs.md"),
		`## ${raw.recorded_at}\n- Run: ${metadata.run_id}\n- Outcome: ${outcome}\n- Raw: ${relative(root, rawPath).replaceAll(sep, "/")}\n- Patterns: ${touched.map((x) => x.id).join(", ")}\n\n`,
		"utf8",
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
	const required =
		skill === "research-workflow"
			? ["local", "evidence", "parent", "archive", "claim", "unverified", "browser"]
			: ["managed", "source", "human", "verify"];
	for (const term of required)
		if (!lower.includes(term)) errors.push(`missing required safety concept: ${term}`);
	const forbidden = [
		/ignore\s+(?:the\s+)?evidence/i,
		/bypass\s+(?:the\s+)?evidence/i,
		/child\s+session[^\n]{0,80}write[^\n]{0,80}(?:vault|obsidian)/i,
	];
	for (const pattern of forbidden)
		if (pattern.test(text)) errors.push(`forbidden policy weakening: ${pattern}`);
	return { ok: errors.length === 0, errors };
}

export async function proposeWikiSkill({
	cwd = process.cwd(),
	project,
	targetSkill,
	candidateMarkdown,
	patternIds = [],
	rationale = "",
} = {}) {
	project = safeSlug(project || (await resolveWorkspaceProject({ cwd })).project, "project");
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
		await access(join(root, "wiki", "patterns", `${safeSlug(id, "pattern id")}.md`));
	const active = await readText(skillPath(cwd, targetSkill));
	if (active === null) throw new Error(`active skill not found: ${targetSkill}`);
	const safety = safetyChecks(targetSkill, candidateMarkdown);
	const proposalId = `proposal-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
	const dir = join(root, "candidates", proposalId, targetSkill);
	await mkdir(dir, { recursive: true });
	const candidatePath = join(dir, "SKILL.md");
	await atomicText(candidatePath, `${candidateMarkdown.trimEnd()}\n`);
	const proposal = {
		id: proposalId,
		created_at: new Date().toISOString(),
		project,
		target_skill: targetSkill,
		pattern_ids: patternIds,
		rationale: String(rationale || ""),
		active_sha256: sha(active),
		candidate_sha256: sha(`${candidateMarkdown.trimEnd()}\n`),
		candidate_path: candidatePath,
		safety,
	};
	await atomicJson(join(root, "candidates", proposalId, "proposal.json"), proposal);
	return { root, proposal };
}

async function runAgent({ cwd, skillFile, prompt, provider, model, timeoutMs = 90_000 } = {}) {
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
		"--print",
	];
	if (provider) args.push("--provider", provider);
	if (model) args.push("--model", model);
	args.push(`${prompt}\n\nAnswer concisely in English. Do not use tools.`);
	return await new Promise((resolvePromise) => {
		const child = spawn(process.env.PI_WIKISKILL_BIN || "pi", args, {
			cwd,
			env: { ...process.env, PI_SUBAGENT_CHILD: "1" },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "",
			stderr = "";
		const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
			if (stdout.length > 2_000_000) child.kill("SIGTERM");
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
			if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
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
				error: code === 0 ? null : stderr.trim() || `pi exited ${code}`,
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
			error: result.error || null,
		});
	}
	return { score: cases.reduce((sum, item) => sum + item.score, 0) / Math.max(1, cases.length), cases };
}

export async function gateWikiSkillProposal({
	cwd = process.cwd(),
	project,
	proposalId,
	provider,
	model,
	runner = runAgent,
} = {}) {
	project = safeSlug(project || (await resolveWorkspaceProject({ cwd })).project, "project");
	const config = await loadWorkspaceConfig(cwd);
	const root = evolutionRoot(config.resultsRoot, project);
	await ensureEvolution(root);
	const proposal = await readJson(join(root, "candidates", proposalId, "proposal.json"));
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
	const evalCwd = join(root, "eval-sandbox");
	await mkdir(evalCwd, { recursive: true });
	if (!Array.isArray(tasks) || tasks.length === 0) throw new Error(`no validation benchmark for ${skill}`);
	const statePath = join(root, "state.json");
	const state = await readJson(statePath, { version: 1, best_scores: {}, baseline_cache: {} });
	const cacheKey = `${skill}:${proposal.active_sha256}:${provider || "default"}:${model || "default"}`;
	let baseline = state.baseline_cache?.[cacheKey];
	if (!baseline) {
		baseline = await evaluateSkill({ cwd: evalCwd, skillFile: activePath, tasks, provider, model, runner });
		state.baseline_cache = { ...(state.baseline_cache || {}), [cacheKey]: baseline };
	}
	const candidate = await evaluateSkill({
		cwd: evalCwd,
		skillFile: proposal.candidate_path,
		tasks,
		provider,
		model,
		runner,
	});
	const priorBest = Number(state.best_scores?.[skill]);
	const threshold = Number.isFinite(priorBest) ? Math.max(priorBest, baseline.score) : baseline.score;
	const allCasesRan = candidate.cases.every((item) => item.ok);
	const changed = proposal.candidate_sha256 !== proposal.active_sha256;
	const ceiling = threshold >= 1;
	const performancePass = ceiling ? candidate.score >= threshold : candidate.score > threshold;
	const accepted = allCasesRan && changed && performancePass;
	const at = new Date().toISOString();
	if (accepted) {
		const backup = join(
			root,
			"history",
			`${at.replace(/[:.]/g, "-")}-${skill}-${proposal.active_sha256.slice(0, 12)}.md`,
		);
		await cp(activePath, backup);
		await atomicText(activePath, await readFile(proposal.candidate_path, "utf8"));
		state.best_scores = { ...(state.best_scores || {}), [skill]: candidate.score };
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
		candidate_sha256: proposal.candidate_sha256,
	};
	await atomicJson(join(root, "candidates", proposal.id, "validation.json"), { impact, baseline, candidate });
	await appendFile(
		join(root, "wiki", "skill-impact.md"),
		`## ${at} · ${skill}\n- Proposal: ${proposal.id}\n- Patterns: ${proposal.pattern_ids.join(", ")}\n- Baseline: ${baseline.score.toFixed(3)}\n- Candidate: ${candidate.score.toFixed(3)}\n- Threshold: ${threshold.toFixed(3)}\n- Gate: ${ceiling ? "non-regression at benchmark ceiling" : "strict improvement"}\n- Outcome: ${accepted ? "Accepted" : "Rejected"}\n- Candidate SHA-256: ${proposal.candidate_sha256}\n\n`,
		"utf8",
	);
	return { root, impact, baseline, candidate };
}

export async function wikiSkillStatus({ cwd = process.cwd(), project } = {}) {
	project = safeSlug(project || (await resolveWorkspaceProject({ cwd })).project, "project");
	const config = await loadWorkspaceConfig(cwd);
	const root = evolutionRoot(config.resultsRoot, project);
	await ensureEvolution(root);
	const count = async (path) =>
		(await readdir(path).catch((error) => (error.code === "ENOENT" ? [] : Promise.reject(error)))).length;
	const state = await readJson(join(root, "state.json"), { version: 1, best_scores: {}, baseline_cache: {} });
	return {
		project,
		root,
		raw_events: await count(join(root, "raw")),
		patterns: await count(join(root, "wiki", "patterns")),
		proposals: await count(join(root, "candidates")),
		best_scores: state.best_scores || {},
	};
}

export { evaluateSkill, safetyChecks };

const TOOL_MANIFEST_EVENT = "drone:tool-manifest/v1";
function registerTool(pi, definition) {
	void pi?.events?.emit?.(TOOL_MANIFEST_EVENT, {
		version: 1,
		name: definition.name,
		meta: definition.drone || {},
	});
	if (process.env.PI_SUBAGENT_CHILD === "1" && definition.drone?.subagent === "exclude") return;
	pi.registerTool(definition);
}

export default function researchWikiSkill(pi) {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;

	registerTool(pi, {
		name: "research_wikiskill_record",
		label: "Compile research experience",
		drone: {
			capabilities: ["research", "knowledge"],
			subagent: "exclude",
			activity: { text: "正在总结研究经验…", phase: "synthesis" },
		},
		description:
			"Compile one completed observable research run into the persistent WikiSkill raw/wiki layers. This stores auditable metadata and reusable process patterns, never hidden reasoning and never scientific claims as authority.",
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
							strategy: { type: "string" },
						},
						required: ["id", "title", "problem", "strategy"],
					},
				},
			},
			required: ["run_dir", "outcome", "patterns"],
		},
		async execute(_id, params, _signal, _update, ctx) {
			const result = await recordWikiSkillExperience({
				cwd: ctx.cwd,
				runDir: params.run_dir,
				project: params.project,
				outcome: params.outcome,
				patterns: params.patterns,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
		},
	});

	registerTool(pi, {
		name: "research_wikiskill_propose",
		label: "Propose research Skill evolution",
		drone: {
			capabilities: ["research", "knowledge"],
			subagent: "exclude",
			activity: { text: "正在改进研究策略…", phase: "skill-evolution" },
		},
		description:
			"Stage one atomic SKILL.md candidate motivated by persistent WikiSkill patterns. The candidate is not active until it passes isolated validation gating.",
		parameters: {
			type: "object",
			properties: {
				project: { type: "string" },
				target_skill: { type: "string", enum: ["research-workflow", "research-vault"] },
				candidate_markdown: { type: "string" },
				pattern_ids: { type: "array", minItems: 1, items: { type: "string" } },
				rationale: { type: "string" },
			},
			required: ["target_skill", "candidate_markdown", "pattern_ids"],
		},
		async execute(_id, params, _signal, _update, ctx) {
			const result = await proposeWikiSkill({
				cwd: ctx.cwd,
				project: params.project || (await sessionProject(ctx)),
				targetSkill: params.target_skill,
				candidateMarkdown: params.candidate_markdown,
				patternIds: params.pattern_ids,
				rationale: params.rationale,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
		},
	});

	registerTool(pi, {
		name: "research_wikiskill_gate",
		label: "Validate and gate research Skill",
		drone: {
			capabilities: ["research", "knowledge"],
			subagent: "exclude",
			activity: { text: "正在验证新的研究策略…", phase: "verification" },
		},
		description:
			"Evaluate the active and candidate Skill in isolated no-tool Pi runs. Accept only a candidate that passes safety checks and scores strictly above both the active baseline and prior best; otherwise keep the active Skill while retaining Wiki history.",
		parameters: {
			type: "object",
			properties: {
				project: { type: "string" },
				proposal_id: { type: "string" },
				provider: { type: "string" },
				model: { type: "string" },
			},
			required: ["proposal_id"],
		},
		async execute(_id, params, _signal, _update, ctx) {
			const result = await gateWikiSkillProposal({
				cwd: ctx.cwd,
				project: params.project || (await sessionProject(ctx)),
				proposalId: params.proposal_id,
				provider: params.provider,
				model: params.model,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
		},
	});

	registerTool(pi, {
		name: "research_wikiskill_status",
		label: "Research WikiSkill status",
		drone: {
			readOnly: true,
			capabilities: ["research", "knowledge"],
			activity: { text: "正在检查研究策略状态…", phase: "verification" },
		},
		description:
			"Show the persistent experience/raw/wiki/proposal counts and best accepted validation scores for a project.",
		parameters: { type: "object", properties: { project: { type: "string" } } },
		async execute(_id, params, _signal, _update, ctx) {
			const result = await wikiSkillStatus({
				cwd: ctx.cwd,
				project: params.project || (await sessionProject(ctx)),
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
		},
	});

	pi.on?.("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\n\nWikiSkill evolution policy: the scientific knowledge path and the Skill-evolution Wiki are separate. During normal research, use Zotero/Obsidian/Web plus the evidence gate for factual claims; never cite WikiSkill patterns as scientific evidence. After a completed parent research run, compile only reusable observable process experience with research_wikiskill_record. When a pattern recurs or reveals a concrete workflow defect, stage one atomic update to research-workflow or research-vault with research_wikiskill_propose, then run research_wikiskill_gate. Never activate a proposal manually. A rejected candidate is discarded from the active Skill but its Wiki pattern and impact history persist. Do not store hidden chain-of-thought.`,
	}));
}
