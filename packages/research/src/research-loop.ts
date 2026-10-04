import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { claimBindingRefs, validateClaimBindings } from "./claim-bindings";

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

export interface ResearchLoopWorkspace {
	resultsRoot: string;
	obsidianVault?: string | null;
	knowledgeBindingRevision?: number | null;
}
export interface ResearchLoopPorts {
	workspace(cwd: string): Promise<ResearchLoopWorkspace>;
	verifyLiteratureReceipt(input: Record<string, unknown>): Promise<any>;
	sourceStatus(input: { cwd: string; run_dir: string; verify?: boolean }): Promise<any>;
	exclusive?<T>(key: string, work: () => Promise<T>): Promise<T>;
}
/** Each host owns one loop instance. No ledger or queue is shared across hosts. */
export function createResearchLoop(ports: ResearchLoopPorts) {
	const loadWorkspaceConfig = ports.workspace;
	const verifyLiteratureReceipt = ports.verifyLiteratureReceipt;
	const sourceStatus = ports.sourceStatus;
	// Current-turn, host-observed receipts only; model tool arguments cannot populate this ledger.
	// The ledger and its serial queues belong to the active DroneRuntime so separate
	// Pi hosts cannot consume or mutate one another's evidence receipts.
	const runtimeState: any = {
		receiptLedger: new Map(),
		receiptQueues: new Map(),
		dispose() {
			this.receiptLedger.clear();
			this.receiptQueues.clear();
		},
	};
	const runKey = (cwd: any, runDir: any) => resolve(cwd, runDir);
	function ledger(cwd: any, runDir: any) {
		const key = runKey(cwd, runDir);
		if (!runtimeState.receiptLedger.has(key)) {
			if (runtimeState.receiptLedger.size >= 128)
				runtimeState.receiptLedger.delete(runtimeState.receiptLedger.keys().next().value);
			runtimeState.receiptLedger.set(key, { reads: new Map(), verified: new Map() });
		}
		return runtimeState.receiptLedger.get(key);
	}
	async function flushResearchReceipts({ cwd = process.cwd(), runDir }: any = {}) {
		await runtimeState.receiptQueues.get(runKey(cwd, runDir));
	}
	function resetResearchReceipts({ cwd = process.cwd(), runDir }: any = {}) {
		if (runDir) runtimeState.receiptLedger.delete(runKey(cwd, runDir));
	}
	async function reusableSources(cwd: any, runDir: any) {
		const config = await loadWorkspaceConfig(cwd);
		if (!config.obsidianVault) return [];
		const root = await realpath(config.obsidianVault);
		const state = ledger(cwd, runDir),
			result: any = [];
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
	async function validateReuse(cwd: any, runDir: any, gate: any) {
		if (!gate.reuse_count) return;
		const fresh = await reusableSources(cwd, runDir);
		if (
			gate.reused_sources.length !== gate.reuse_count ||
			gate.reused_sources.some(
				(old: any) =>
					!fresh.some(
						(now: any) =>
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
	async function validateStoredClaimBindings(cwd: any, runDir: any, gate: any) {
		if (!Array.isArray(gate.claim_bindings) || gate.claim_bindings.length === 0)
			throw new Error("Structured claim_bindings are required before answerable");
		return validateClaimBindings(
			gate.claim_bindings,
			await reusableSources(cwd, runDir),
			ledger(cwd, runDir).reads,
		);
	}

	function safeSlug(value: any, label: any) {
		const text = String(value ?? "").trim();
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)) throw new Error(`${label} must be lowercase kebab-case`);
		return text;
	}
	function topicIdFromResultSlug(value: any) {
		const slug = safeSlug(value || "research-question", "result_slug");
		const stable = slug.replace(/-20\d{6}(?:\d{6})?$/, "").replace(/-run-\d+$/, "");
		return stable || slug;
	}

	function within(root: any, target: any) {
		const rel = relative(resolve(root), resolve(target));
		return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
	}

	async function readJson(path: any) {
		const value = JSON.parse(await readFile(path, "utf8"));
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new Error(`Invalid JSON object: ${path}`);
		return value;
	}

	async function atomicJson(path: any, value: any) {
		await mkdir(dirname(path), { recursive: true });
		const temp = `${path}.${randomUUID()}.tmp`;
		await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
		await rename(temp, path);
	}

	function gateOf(metadata: any) {
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

	function advance(gate: any, stage: any, details: any = {}) {
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

	async function resolveRun(cwd: any, runDir: any) {
		const config = await loadWorkspaceConfig(cwd);
		if (!runDir) throw new Error("run_dir is required for this action");
		const path = resolve(cwd, runDir);
		if (!within(config.resultsRoot, path))
			throw new Error("run_dir must stay inside the configured results root");
		const rel = relative(config.resultsRoot, path).split(sep);
		if (rel.length !== 2 || !rel[1]?.startsWith("run-"))
			throw new Error("run_dir must be directly inside a result slug");
		await access(join(path, "metadata.json"));
		return { config, path, metadataPath: join(path, "metadata.json") };
	}

	async function startResearchRun({
		cwd = process.cwd(),
		project,
		resultSlug,
		query,
		requiresProvenance = false,
	}: any = {}) {
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
		const metadata: any = {
			run_id: runId,
			project,
			result_slug: resultSlug,
			topic_id: topicIdFromResultSlug(resultSlug),
			query: query.trim(),
			status: "running",
			revision: 0,
			requires_provenance: requiresProvenance === true,
			provenance: { status: requiresProvenance === true ? "pending" : "not-required" },
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

	async function updateResearchLoopUnlocked({
		cwd = process.cwd(),
		runDir,
		action,
		query,
		sourceRefs = [],
		claimRefs = [],
		claimBindings = [],
		outcome,
		notes,
		expectedRevision,
	}: any = {}): Promise<any> {
		const { path, metadataPath } = await resolveRun(cwd, runDir);
		const metadata = await readJson(metadataPath);
		const revision = Number.isInteger(metadata.revision) ? metadata.revision : 0;
		if (expectedRevision != null && Number(expectedRevision) !== revision)
			throw new Error(`research run changed; expected revision ${expectedRevision}, found ${revision}`);
		let gate = gateOf(metadata);
		const detail: any = {
			...(query ? { query: String(query).trim() } : {}),
			...(outcome ? { outcome } : {}),
			...(notes ? { notes } : {}),
		};
		const requireStage = (stage: any) => {
			if (RESEARCH_STAGES.indexOf(gate.stage) < RESEARCH_STAGES.indexOf(stage))
				throw new Error(`research loop must reach ${stage} before ${action}`);
		};
		if (action === "status") return { run_dir: path, metadata, evidence_gate: gate, revision };
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
			const archive = await sourceStatus({ cwd, run_dir: path, verify: true });
			if (archive.verification && archive.verification.ok !== true) {
				const failed = archive.verification.items?.filter((item: any) => item.ok !== true) || [];
				throw new Error(
					`Archived source verification failed: ${failed.map((item: any) => item.reason || item.path).join(", ") || "unknown"}`,
				);
			}
			const downloaded = (archive.manifest?.items || []).filter((item: any) => item.status === "downloaded");
			const reused = await reusableSources(cwd, runDir);
			if (!downloaded.length && !reused.length)
				throw new Error(
					"No available source: read an existing Library/Papers note this turn and verify its DOI/key with research_verify_literature, or archive an authorized new source. Do not repeat imports to clear this gate.",
				);
			gate = advance(
				{ ...gate, archive_count: downloaded.length, reuse_count: reused.length, reused_sources: reused },
				downloaded.length ? "sources_archived" : "sources_reused",
				{
					archived: downloaded.map((item: any) => ({ id: item.id, sha256: item.sha256, path: item.path })),
					reused_sources: reused,
					scientificallyVerified: false,
				},
			);
		} else if (action === "bind_claims") {
			if (gate.stage === "sources_inspected") {
				const available = await updateResearchLoopUnlocked({ cwd, runDir, action: "verify_archive" });
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
			} else if (gate.claim_bindings.length) {
				const checked = await validateStoredClaimBindings(cwd, runDir, gate);
				gate = { ...gate, claim_bindings: checked, claim_refs: claimBindingRefs(checked), warnings: [] };
				claimRefs = claimBindingRefs(checked);
			} else if (claimRefs.length) {
				throw new Error(
					"Structured claim_bindings are required; legacy claim_refs cannot make a run answerable",
				);
			}
			if (!Array.isArray(gate.claim_bindings) || gate.claim_bindings.length === 0)
				throw new Error("Structured claim_bindings must contain at least one validated claim");
			gate = advance({ ...gate, claim_refs: [...new Set(claimRefs.map(String))] }, "claims_bound", {
				claim_refs: claimRefs,
			});
		} else if (action === "finalize") {
			requireStage("claims_bound");
			await validateReuse(cwd, runDir, gate);
			const checked = await validateStoredClaimBindings(cwd, runDir, gate);
			const refs = claimBindingRefs(checked);
			if (gate.archive_count + gate.reuse_count < 1 || !refs.length)
				throw new Error("archive verification and structured claim bindings are required before answerable");
			if (metadata.requires_provenance === true) {
				const provenance = await readJson(join(path, "reproducibility-manifest.json"));
				if (provenance?.version !== 1)
					throw new Error("This run requires a reproducibility manifest before it can become answerable");
			}
			gate = advance(
				{ ...gate, claim_bindings: checked, claim_refs: refs, warnings: [], status: "ok", answerable: true },
				"answerable",
				detail,
			);
		} else if (action === "complete") {
			return completeResearchGate({ cwd, runDir, claimRefs, claimBindings });
		} else {
			throw new Error(`unknown research_loop action: ${action}`);
		}
		metadata.evidence_gate = gate;
		metadata.updated_at = new Date().toISOString();
		metadata.revision = revision + 1;
		await atomicJson(metadataPath, metadata);
		return { run_dir: path, evidence_gate: gate, revision: metadata.revision };
	}
	async function updateResearchLoop(input: any = {}): Promise<any> {
		const cwd = input.cwd || process.cwd();
		const key = runKey(cwd, input.runDir);
		const work = () => updateResearchLoopUnlocked(input);
		return ports.exclusive ? ports.exclusive(key, work) : work();
	}

	function isWikiPath(path: any) {
		return /(?:^|[\\/])Wiki[\\/]/i.test(String(path || ""));
	}

	async function ensureStage(cwd: any, runDir: any, stage: any, fill: any) {
		const current = await updateResearchLoop({ cwd, runDir, action: "status" });
		if (RESEARCH_STAGES.indexOf(current.evidence_gate.stage) >= RESEARCH_STAGES.indexOf(stage))
			return current;
		return fill();
	}

	/** Host-owned serial close: verify archive, bind claims from real refs if needed, finalize. */
	async function completeResearchGate({
		cwd = process.cwd(),
		runDir,
		claimRefs = [],
		claimBindings = [],
	}: any = {}): Promise<any> {
		let status: any = await updateResearchLoop({ cwd, runDir, action: "status" });
		let gate = status.evidence_gate;
		await validateReuse(cwd, runDir, gate);
		if (RESEARCH_STAGES.indexOf(gate.stage) < RESEARCH_STAGES.indexOf("sources_inspected"))
			throw new Error("research loop must inspect sources before complete");
		if (RESEARCH_STAGES.indexOf(gate.stage) < RESEARCH_STAGES.indexOf("sources_archived"))
			status = await updateResearchLoop({ cwd, runDir, action: "verify_archive" });
		gate = status.evidence_gate;
		if (!claimBindings.length && !gate.claim_bindings.length)
			throw new Error(
				"Provide structured claim_bindings; legacy claim_refs cannot make a research run answerable",
			);
		if (claimBindings.length || RESEARCH_STAGES.indexOf(gate.stage) < RESEARCH_STAGES.indexOf("claims_bound"))
			status = await updateResearchLoop({
				cwd,
				runDir,
				action: "bind_claims",
				claimRefs,
				claimBindings,
			});
		gate = status.evidence_gate;
		if (gate.stage !== "answerable") status = await updateResearchLoop({ cwd, runDir, action: "finalize" });
		return status;
	}

	/**
	 * Advance the gate from a successful tool receipt. Missing runs or out-of-order
	 * receipts are ignored; the host never throws into the tool pipeline.
	 */
	function observeResearchReceipt(options: any = {}) {
		if (!options.runDir) return Promise.resolve(null);
		const key = runKey(options.cwd || process.cwd(), options.runDir);
		const work = (runtimeState.receiptQueues.get(key) || Promise.resolve())
			.catch(() => {})
			.then(() => observeReceipt(options));
		runtimeState.receiptQueues.set(key, work);
		void work
			.finally(() => {
				if (runtimeState.receiptQueues.get(key) === work) runtimeState.receiptQueues.delete(key);
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
	}: any = {}) {
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
			if (toolName === "research_deposit_knowledge" && details.type === "claim" && details.note) return null;
			return null;
		} catch {
			return null;
		}
	}

	return {
		startResearchRun,
		updateResearchLoop,
		completeResearchGate,
		observeResearchReceipt,
		flushResearchReceipts,
		resetResearchReceipts,
		topicIdFromResultSlug,
		dispose: () => runtimeState.dispose(),
	};
}
