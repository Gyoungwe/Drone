import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadWorkspaceConfig } from "../extensions/workspace-config.mjs";
import { claimBindingRefs, validateClaimBindings } from "./claim-bindings.mjs";
import { verifyLiteratureReceipt } from "./literature-receipt.mjs";
import { sourceStatus } from "./source-archive.mjs";

export const RESEARCH_STAGES = Object.freeze([
	"created",
	"local_query_recorded",
	"external_search_recorded",
	"sources_inspected",
	"sources_archived",
	"sources_reused",
	"claims_bound",
	"answerable",
]);

// Current-turn, host-observed receipts only; model tool arguments cannot populate this ledger.
const receiptLedger = new Map();
const receiptQueues = new Map();
const runKey = (cwd, runDir) => resolve(cwd, runDir);
function ledger(cwd, runDir) {
	const key = runKey(cwd, runDir);
	if (!receiptLedger.has(key)) {
		if (receiptLedger.size >= 128) receiptLedger.delete(receiptLedger.keys().next().value);
		receiptLedger.set(key, { reads: new Map(), verified: new Map() });
	}
	return receiptLedger.get(key);
}
export async function flushResearchReceipts({ cwd = process.cwd(), runDir } = {}) {
	await receiptQueues.get(runKey(cwd, runDir));
}
export function resetResearchReceipts({ cwd = process.cwd(), runDir } = {}) {
	if (runDir) receiptLedger.delete(runKey(cwd, runDir));
}
async function reusableSources(cwd, runDir) {
	const config = await loadWorkspaceConfig(cwd);
	if (!config.obsidianVault) return [];
	const root = await realpath(config.obsidianVault);
	const state = ledger(cwd, runDir),
		result = [];
	for (const [path, proof] of state.verified) {
		const read = state.reads.get(path);
		if (
			!read ||
			read.hash !== proof.obsidian?.hash ||
			read.vault !== root ||
			read.revision !== (config.knowledgeBindingRevision || 0) ||
			proof.obsidian?.vault !== root
		)
			continue;
		const current = await verifyLiteratureReceipt({
			doi: proof.doi,
			zotero_key: proof.zoteroKey,
			note_path: path,
			vault: root,
		});
		if (current.status !== "both-verified" || current.obsidian.hash !== read.hash) continue;
		result.push({
			path,
			hash: read.hash,
			doi: current.doi,
			zotero_key: current.zoteroKey,
			startLine: read.startLine,
			endLine: read.endLine,
			basis: "current-turn-literature-note-read-and-identity-check",
			fulltext_status: current.zotero.fulltextStatus,
			originalFulltextReadThisTurn: false,
			evidence_profile: {
				identity: "both-verified",
				acquisition: current.zotero.fulltextStatus,
				reading: {
					kind: "literature-note",
					scope: "current-turn",
					startLine: read.startLine,
					endLine: read.endLine,
				},
				claimSupport: "not-assessed",
			},
		});
	}
	return result;
}
async function validateReuse(cwd, runDir, gate) {
	if (!gate.reuse_count) return;
	const fresh = await reusableSources(cwd, runDir);
	if (
		gate.reused_sources.length !== gate.reuse_count ||
		gate.reused_sources.some(
			(old) =>
				!fresh.some(
					(now) =>
						now.path === old.path &&
						now.hash === old.hash &&
						now.doi === old.doi &&
						now.zotero_key === old.zotero_key,
				),
		)
	)
		throw new Error(
			"Reused source changed or current-turn receipt is missing; re-read and verify the existing note, do not re-import it",
		);
}

function safeSlug(value, label) {
	const text = String(value ?? "").trim();
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)) throw new Error(`${label} must be lowercase kebab-case`);
	return text;
}
export function topicIdFromResultSlug(value) {
	const slug = safeSlug(value || "research-question", "result_slug");
	const stable = slug.replace(/-20\d{6}(?:\d{6})?$/, "").replace(/-run-\d+$/, "");
	return stable || slug;
}

function within(root, target) {
	const rel = relative(resolve(root), resolve(target));
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

async function readJson(path) {
	const value = JSON.parse(await readFile(path, "utf8"));
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`Invalid JSON object: ${path}`);
	return value;
}

async function atomicJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	const temp = `${path}.${randomUUID()}.tmp`;
	await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	await rename(temp, path);
}

function gateOf(metadata) {
	const gate =
		metadata.evidence_gate && typeof metadata.evidence_gate === "object" ? metadata.evidence_gate : {};
	return {
		stage: RESEARCH_STAGES.includes(gate.stage) ? gate.stage : "created",
		status: gate.status === "failed" ? "failed" : "ok",
		answerable: gate.answerable === true,
		events: Array.isArray(gate.events) ? gate.events : [],
		claim_refs: Array.isArray(gate.claim_refs) ? gate.claim_refs : [],
		claim_bindings: Array.isArray(gate.claim_bindings) ? gate.claim_bindings : [],
		warnings:
			gate.claim_refs?.length && !gate.claim_bindings?.length
				? ["legacy-unstructured-claims: support not assessed"]
				: [],
		source_refs: Array.isArray(gate.source_refs) ? gate.source_refs : [],
		archive_count: Number(gate.archive_count) || 0,
		reuse_count: Number(gate.reuse_count) || 0,
		reused_sources: Array.isArray(gate.reused_sources) ? gate.reused_sources : [],
		scientificallyVerified: false,
	};
}

function advance(gate, stage, details = {}) {
	const current = RESEARCH_STAGES.indexOf(gate.stage);
	const target = RESEARCH_STAGES.indexOf(stage);
	if (target < 0) throw new Error(`Unknown research stage: ${stage}`);
	if (target < current)
		return {
			...gate,
			events: [...gate.events, { type: stage, at: new Date().toISOString(), repeated: true, ...details }],
		};
	return {
		...gate,
		stage,
		events: [...gate.events, { type: stage, at: new Date().toISOString(), ...details }],
	};
}

async function resolveRun(cwd, runDir) {
	const config = await loadWorkspaceConfig(cwd);
	if (!runDir) throw new Error("run_dir is required for this action");
	const path = resolve(cwd, runDir);
	if (!within(config.resultsRoot, path))
		throw new Error("run_dir must stay inside the configured results root");
	const rel = relative(config.resultsRoot, path).split(sep);
	if (rel.length !== 2 || !rel[1].startsWith("run-"))
		throw new Error("run_dir must be directly inside a result slug");
	await access(join(path, "metadata.json"));
	return { config, path, metadataPath: join(path, "metadata.json") };
}

export async function startResearchRun({ cwd = process.cwd(), project, resultSlug, query } = {}) {
	const config = await loadWorkspaceConfig(cwd);
	project = safeSlug(project || "research-workbench", "project");
	resultSlug = safeSlug(resultSlug || "research-question", "result_slug");
	if (typeof query !== "string" || !query.trim()) throw new Error("query is required");
	const stamp = new Date()
		.toISOString()
		.replace(/[-:.TZ]/g, "")
		.slice(0, 14);
	const runId = `run-${stamp}-${randomUUID().slice(0, 8)}`;
	const runDir = join(config.resultsRoot, resultSlug, runId);
	const now = new Date().toISOString();
	const metadata = {
		run_id: runId,
		project,
		result_slug: resultSlug,
		topic_id: topicIdFromResultSlug(resultSlug),
		query: query.trim(),
		status: "running",
		started_at: now,
		evidence_gate: {
			stage: "created",
			status: "ok",
			answerable: false,
			events: [{ type: "created", at: now }],
			claim_refs: [],
			source_refs: [],
			archive_count: 0,
		},
	};
	await mkdir(runDir, { recursive: true });
	await atomicJson(join(runDir, "metadata.json"), metadata);
	return { run_dir: runDir, metadata };
}

export async function updateResearchLoop({
	cwd = process.cwd(),
	runDir,
	action,
	query,
	sourceRefs = [],
	claimRefs = [],
	claimBindings = [],
	outcome,
	notes,
} = {}) {
	const { path, metadataPath } = await resolveRun(cwd, runDir);
	const metadata = await readJson(metadataPath);
	let gate = gateOf(metadata);
	const detail = {
		...(query ? { query: String(query).trim() } : {}),
		...(outcome ? { outcome } : {}),
		...(notes ? { notes } : {}),
	};
	const requireStage = (stage) => {
		if (RESEARCH_STAGES.indexOf(gate.stage) < RESEARCH_STAGES.indexOf(stage))
			throw new Error(`research loop must reach ${stage} before ${action}`);
	};
	if (action === "status") return { run_dir: path, metadata, evidence_gate: gate };
	if (action === "record_local") {
		if (!query?.trim()) throw new Error("query is required");
		gate = advance(gate, "local_query_recorded", detail);
	} else if (action === "record_external") {
		requireStage("local_query_recorded");
		if (!query?.trim() && !notes?.trim())
			throw new Error("record the external query or why external search was skipped");
		gate = advance(gate, "external_search_recorded", detail);
	} else if (action === "inspect_sources") {
		requireStage("external_search_recorded");
		if (!Array.isArray(sourceRefs) || sourceRefs.length === 0)
			throw new Error("source_refs must list inspected original sources");
		gate = advance(
			{ ...gate, source_refs: [...new Set([...gate.source_refs, ...sourceRefs.map(String)])] },
			"sources_inspected",
			{ ...detail, source_refs: sourceRefs },
		);
	} else if (action === "verify_archive") {
		requireStage("sources_inspected");
		const archive = await sourceStatus({ cwd, run_dir: path });
		const downloaded = (archive.manifest?.items || []).filter((item) => item.status === "downloaded");
		const reused = await reusableSources(cwd, runDir);
		if (!downloaded.length && !reused.length)
			throw new Error(
				"No available source: read an existing Library/Papers note this turn and verify its DOI/key with research_verify_literature, or archive an authorized new source. Do not repeat imports to clear this gate.",
			);
		gate = advance(
			{ ...gate, archive_count: downloaded.length, reuse_count: reused.length, reused_sources: reused },
			downloaded.length ? "sources_archived" : "sources_reused",
			{
				archived: downloaded.map((item) => ({ id: item.id, sha256: item.sha256, path: item.path })),
				reused_sources: reused,
				scientificallyVerified: false,
			},
		);
	} else if (action === "bind_claims") {
		if (gate.stage === "sources_inspected") {
			const available = await updateResearchLoop({ cwd, runDir, action: "verify_archive" });
			gate = available.evidence_gate;
		}
		requireStage("sources_archived");
		await validateReuse(cwd, runDir, gate);
		if (claimBindings.length) {
			const checked = validateClaimBindings(
				claimBindings,
				await reusableSources(cwd, runDir),
				ledger(cwd, runDir).reads,
			);
			gate = { ...gate, claim_bindings: checked, warnings: [] };
			claimRefs = claimBindingRefs(checked);
		} else if (gate.claim_bindings.length && claimRefs.length) {
			gate = { ...gate, claim_bindings: [] };
		}
		if (!Array.isArray(claimRefs) || claimRefs.length === 0)
			throw new Error("claim_refs must contain at least one traceable claim binding");
		gate = advance({ ...gate, claim_refs: [...new Set(claimRefs.map(String))] }, "claims_bound", {
			claim_refs: claimRefs,
		});
	} else if (action === "finalize") {
		requireStage("claims_bound");
		await validateReuse(cwd, runDir, gate);
		if (gate.archive_count + gate.reuse_count < 1 || gate.claim_refs.length < 1)
			throw new Error("archive verification and claim binding are required before answerable");
		gate = advance({ ...gate, status: "ok", answerable: true }, "answerable", detail);
	} else if (action === "complete") {
		return completeResearchGate({ cwd, runDir, claimRefs, claimBindings });
	} else {
		throw new Error(`unknown research_loop action: ${action}`);
	}
	metadata.evidence_gate = gate;
	metadata.updated_at = new Date().toISOString();
	await atomicJson(metadataPath, metadata);
	return { run_dir: path, evidence_gate: gate };
}

function isWikiPath(path) {
	return /(?:^|[\\/])Wiki[\\/]/i.test(String(path || ""));
}

async function ensureStage(cwd, runDir, stage, fill) {
	const current = await updateResearchLoop({ cwd, runDir, action: "status" });
	if (RESEARCH_STAGES.indexOf(current.evidence_gate.stage) >= RESEARCH_STAGES.indexOf(stage)) return current;
	return fill();
}

/** Host-owned serial close: verify archive, bind claims from real refs if needed, finalize. */
export async function completeResearchGate({
	cwd = process.cwd(),
	runDir,
	claimRefs = [],
	claimBindings = [],
} = {}) {
	let status = await updateResearchLoop({ cwd, runDir, action: "status" });
	let gate = status.evidence_gate;
	await validateReuse(cwd, runDir, gate);
	if (RESEARCH_STAGES.indexOf(gate.stage) < RESEARCH_STAGES.indexOf("sources_inspected"))
		throw new Error("research loop must inspect sources before complete");
	if (RESEARCH_STAGES.indexOf(gate.stage) < RESEARCH_STAGES.indexOf("sources_archived"))
		status = await updateResearchLoop({ cwd, runDir, action: "verify_archive" });
	gate = status.evidence_gate;
	if (!claimBindings.length && !claimRefs.length && !gate.claim_refs.length)
		throw new Error(
			"Provide explicit claim_refs; downloading or identity verification alone does not bind scientific claims",
		);
	const refs = (Array.isArray(claimRefs) && claimRefs.length ? claimRefs : null) || gate.claim_refs;
	if (!refs.length && !claimBindings.length)
		throw new Error("claim_refs must contain at least one traceable claim binding");
	if (claimBindings.length || RESEARCH_STAGES.indexOf(gate.stage) < RESEARCH_STAGES.indexOf("claims_bound"))
		status = await updateResearchLoop({ cwd, runDir, action: "bind_claims", claimRefs: refs, claimBindings });
	gate = status.evidence_gate;
	if (gate.stage !== "answerable") status = await updateResearchLoop({ cwd, runDir, action: "finalize" });
	return status;
}

/**
 * Advance the gate from a successful tool receipt. Missing runs or out-of-order
 * receipts are ignored; the host never throws into the tool pipeline.
 */
export function observeResearchReceipt(options = {}) {
	if (!options.runDir) return Promise.resolve(null);
	const key = runKey(options.cwd || process.cwd(), options.runDir);
	const work = (receiptQueues.get(key) || Promise.resolve())
		.catch(() => {})
		.then(() => observeReceipt(options));
	receiptQueues.set(key, work);
	void work
		.finally(() => {
			if (receiptQueues.get(key) === work) receiptQueues.delete(key);
		})
		.catch(() => {});
	return work;
}
async function observeReceipt({
	cwd = process.cwd(),
	runDir,
	toolName,
	args = {},
	details = {},
	isError = false,
	readBinding,
} = {}) {
	if (isError || !runDir || !toolName) return null;
	try {
		if (toolName === "research_reconcile_literature")
			return observeReceipt({
				cwd,
				runDir,
				toolName: "research_verify_literature",
				args,
				details: details.receipt || {},
				isError,
			});
		const query = String(args.query || details.query || "").trim();
		if (toolName === "research_search_knowledge" && query && details.complete !== false)
			return await updateResearchLoop({ cwd, runDir, action: "record_local", query });
		if (["webfetch", "fetch_content", "web_search"].includes(toolName)) {
			const url = String(args.url || details.url || query).trim();
			if (!url) return null;
			await ensureStage(cwd, runDir, "local_query_recorded", () =>
				updateResearchLoop({ cwd, runDir, action: "record_local", query: url }),
			);
			return await updateResearchLoop({
				cwd,
				runDir,
				action: "record_external",
				query: url,
				notes: String(details.title || ""),
			});
		}
		if (toolName === "research_read_knowledge") {
			const path = String(args.path || details.path || "");
			if (!path || isWikiPath(path) || details.missing === true) return null;
			await ensureStage(cwd, runDir, "local_query_recorded", () =>
				updateResearchLoop({ cwd, runDir, action: "record_local", query: path }),
			);
			await ensureStage(cwd, runDir, "external_search_recorded", () =>
				updateResearchLoop({
					cwd,
					runDir,
					action: "record_external",
					notes: "Host: no extra web search before inspecting current sources.",
				}),
			);
			if (
				/^Library\/Papers\/.+\.md$/.test(path) &&
				/^[a-f0-9]{64}$/i.test(details.hash || "") &&
				typeof details.text === "string" &&
				details.text.trim() &&
				Number.isInteger(details.startLine) &&
				details.endLine >= details.startLine
			) {
				const config = await loadWorkspaceConfig(cwd);
				if (config.obsidianVault)
					ledger(cwd, runDir).reads.set(path, {
						hash: details.hash,
						text: details.text,
						vault: readBinding ? readBinding.vault : await realpath(config.obsidianVault),
						revision: readBinding ? readBinding.revision : config.knowledgeBindingRevision || 0,
						startLine: details.startLine,
						endLine: details.endLine,
					});
			}
			const inspected = await updateResearchLoop({
				cwd,
				runDir,
				action: "inspect_sources",
				sourceRefs: [path],
			});
			if ((await reusableSources(cwd, runDir)).length)
				return await updateResearchLoop({ cwd, runDir, action: "verify_archive" });
			return inspected;
		}
		if (
			toolName === "research_verify_literature" &&
			details.status === "both-verified" &&
			details.obsidian?.status === "verified" &&
			details.zotero?.status === "verified"
		) {
			const path = details.obsidian.path;
			if (!/^Library\/Papers\/.+\.md$/.test(path || "")) return null;
			ledger(cwd, runDir).verified.set(path, structuredClone(details));
			if ((await reusableSources(cwd, runDir)).length)
				return await updateResearchLoop({ cwd, runDir, action: "verify_archive" });
			return null;
		}
		if (toolName === "research_archive_source" && details.status === "downloaded") {
			const ref = String(details.path || details.url || args.url || "");
			if (!ref) return null;
			await ensureStage(cwd, runDir, "local_query_recorded", () =>
				updateResearchLoop({ cwd, runDir, action: "record_local", query: ref }),
			);
			await ensureStage(cwd, runDir, "external_search_recorded", () =>
				updateResearchLoop({
					cwd,
					runDir,
					action: "record_external",
					query: String(args.url || details.url || ref),
					notes: "Host recorded the archived source URL as the external lookup.",
				}),
			);
			await updateResearchLoop({ cwd, runDir, action: "inspect_sources", sourceRefs: [ref] });
			const archived = await updateResearchLoop({ cwd, runDir, action: "verify_archive" });
			// Download success is acquisition, never automatic scientific claim support.
			return archived;
		}
		if (toolName === "research_deposit_knowledge" && details.type === "claim" && details.note)
			return await updateResearchLoop({
				cwd,
				runDir,
				action: "bind_claims",
				claimRefs: [details.note],
			});
		return null;
	} catch {
		return null;
	}
}
