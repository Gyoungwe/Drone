import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { stableJson } from "@drone/compute";
import type {
	AnalysisArtifactVersion,
	AnalysisContext,
	CapabilityEvidenceCard,
	CausalEnvelope,
	EvidenceCheckpointSummary,
	EvidenceOverview,
} from "@drone/shared";
import { childCausalEnvelope } from "@drone/shared";
import { newEventId, newRunAttemptId } from "../causality";
import { JsonStore } from "../json-store";
import type { StorageRegistry } from "../storage/registry";
import type { AnalysisOrchestrationService } from "./analysis-orchestration";

/** Bounded, portable JSON capsule. No code from a capsule is executed on import. */
export const CAPSULE_LIMIT = 64 * 1024 * 1024;
export type EvidenceAudience = "public" | "restricted" | "private";
export interface FrozenFile {
	readonly artifact: AnalysisArtifactVersion;
	readonly kind: "input" | "output" | "code" | "environment" | "review";
}
export interface EvidenceCheckpoint {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly analysis: AnalysisContext;
	readonly files: readonly FrozenFile[];
	readonly environmentFingerprint?: string;
	readonly createdAt: string;
	readonly lineage?: CausalEnvelope;
}
export interface EvidenceCapsule {
	readonly format: "drone-evidence-capsule";
	readonly version: 1;
	readonly checkpoint: EvidenceCheckpoint;
	/** Content addressed bytes; JSON serialization is canonical and deterministic. */
	readonly blobs: Readonly<Record<string, string>>;
	readonly publication?: {
		readonly audience: EvidenceAudience;
		readonly omittedPaths: readonly string[];
	};
}
export interface EvidenceReplayReceipt {
	readonly id: string;
	readonly checkpointId: string;
	readonly status: "reproduced" | "failed";
	readonly detail: string;
	readonly outputChecks: readonly { path: string; matched: boolean }[];
	readonly environmentMatched: boolean;
	readonly completedAt: string;
	readonly lineage?: CausalEnvelope;
}
interface EvidenceLedger {
	version: 1;
	checkpoints: Record<string, EvidenceCheckpoint>;
	branches: Record<
		string,
		{ checkpointId: string; workspace: string; status: "preparing" | "ready" | "failed" }
	>;
	replays: Record<string, EvidenceReplayReceipt>;
}
export interface EvidenceReplayRunner {
	/** Host must perform normal execution authorization/preflight before invoking a runner. */
	run(input: {
		checkpoint: EvidenceCheckpoint;
		inputDir: string;
		outputDir: string;
	}): Promise<{ environmentFingerprint: string }>;
}
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown) => `${stableJson(value)}\n`;
export function checkpointId(value: Omit<EvidenceCheckpoint, "id">): string {
	const { lineage: _lineage, analysis, ...content } = value;
	const provenance = analysis.provenance;
	const { lineage: _provenanceLineage, ...provenanceContent } = provenance ?? {};
	const contentAnalysis = provenance ? { ...analysis, provenance: provenanceContent } : analysis;
	return digest(canonical({ ...content, analysis: contentAnalysis }));
}
function safePath(path: string): void {
	if (
		!path ||
		path.includes("\\") ||
		path.includes(":") ||
		[...path].some((character) => character.charCodeAt(0) < 32) ||
		path.split("/").some((p) => !p || p === "." || p === "..")
	)
		throw new Error("Unsafe evidence path");
	const sensitive = path
		.split("/")
		.some((part) =>
			/^(?:\.env(?:\.|$)|auth\.json$|credentials(?:\.|$)|secrets?(?:\.|$)|tokens?(?:\.|$)|password(?:\.|$)|\.ssh$|\.git$)/i.test(
				part,
			),
		);
	if (sensitive) throw new Error("Evidence path points to credentials or private state");
}
function safeBranch(id: string): void {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(id)) throw new Error("Unsafe branch id");
}
/** Refuse symlinks at every path component, including the leaf, before bounded reads. */
async function readWithin(root: string, path: string): Promise<Buffer> {
	safePath(path);
	const base = await realpath(root);
	let file = base;
	for (const part of path.split("/")) {
		file = join(file, part);
		if ((await lstat(file)).isSymbolicLink()) throw new Error("Evidence symlinks are not supported");
	}
	const actual = await realpath(file);
	if (!actual.startsWith(`${base}${sep}`)) throw new Error("Evidence path escaped its root");
	const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size > CAPSULE_LIMIT)
			throw new Error("Evidence file exceeds capsule limit or is not a regular file");
		const data = Buffer.alloc(stat.size + 1);
		let bytes = 0;
		while (bytes < data.length) {
			const read = await handle.read(data, bytes, data.length - bytes, bytes);
			if (!read.bytesRead) break;
			bytes += read.bytesRead;
		}
		if (bytes !== stat.size) throw new Error("Evidence file changed while reading");
		return data.subarray(0, bytes);
	} finally {
		await handle.close();
	}
}
function validateCheckpoint(checkpoint: EvidenceCheckpoint): void {
	const { id, ...body } = checkpoint;
	if (checkpoint.schemaVersion !== 1 || id !== checkpointId(body))
		throw new Error("Checkpoint manifest checksum mismatch");
	if (
		checkpoint.analysis?.version !== 1 ||
		!checkpoint.analysis.id ||
		!checkpoint.analysis.assay ||
		!["exploratory", "inferential"].includes(checkpoint.analysis.mode)
	)
		throw new Error("Invalid analysis snapshot");
	if (!Array.isArray(checkpoint.files) || !checkpoint.files.length || checkpoint.files.length > 10000)
		throw new Error("Invalid evidence files");
	const paths = new Set<string>();
	const versions = new Set<string>();
	let size = 0;
	for (const file of checkpoint.files) {
		const a = file.artifact;
		safePath(a.path);
		const portable = a.path.toLowerCase();
		if (
			paths.has(portable) ||
			[...paths].some((p) => p.startsWith(`${portable}/`) || portable.startsWith(`${p}/`))
		)
			throw new Error("Duplicate or conflicting evidence path");
		paths.add(portable);
		if (
			!a.artifactId ||
			!a.versionId ||
			versions.has(a.versionId) ||
			!/^[a-f0-9]{64}$/.test(a.sha256) ||
			!Number.isSafeInteger(a.bytes) ||
			a.bytes < 0 ||
			!Array.isArray(a.parentVersionIds)
		)
			throw new Error("Invalid artifact version");
		versions.add(a.versionId);
		if (a.accessLevel !== undefined && !["public", "restricted", "private"].includes(a.accessLevel))
			throw new Error("Invalid artifact access level");
		if (!["input", "output", "code", "environment", "review"].includes(file.kind))
			throw new Error("Invalid evidence kind");
		size += a.bytes;
	}
	if (size > CAPSULE_LIMIT)
		throw new Error("Evidence exceeds capsule limit; use a smaller explicit checkpoint");
}
function audienceRank(audience: EvidenceAudience): number {
	return audience === "public" ? 0 : audience === "restricted" ? 1 : 2;
}
function validateCapsule(capsule: EvidenceCapsule): void {
	if (capsule.format !== "drone-evidence-capsule" || capsule.version !== 1)
		throw new Error("Unsupported capsule version");
	validateCheckpoint(capsule.checkpoint);
	const audience = capsule.publication?.audience ?? "private";
	if (capsule.publication && !["public", "restricted", "private"].includes(audience))
		throw new Error("Invalid capsule publication audience");
	const omittedPaths = capsule.checkpoint.files
		.filter((file) => audienceRank(file.artifact.accessLevel ?? "private") > audienceRank(audience))
		.map((file) => file.artifact.path)
		.sort();
	if (
		capsule.publication &&
		stableJson([...capsule.publication.omittedPaths].sort()) !== stableJson(omittedPaths)
	)
		throw new Error("Capsule publication omission list mismatch");
	const expected = new Set(
		capsule.checkpoint.files
			.filter((file) => audienceRank(file.artifact.accessLevel ?? "private") <= audienceRank(audience))
			.map((f) => f.artifact.sha256),
	);
	if (
		!capsule.blobs ||
		Object.keys(capsule.blobs).some(
			(hash) => !capsule.checkpoint.files.some((f) => f.artifact.sha256 === hash),
		)
	)
		throw new Error("Unexpected capsule blobs");
	for (const file of capsule.checkpoint.files) {
		const encoded = capsule.blobs[file.artifact.sha256];
		if (typeof encoded !== "string") {
			if (expected.has(file.artifact.sha256)) throw new Error("Missing capsule blob");
			continue;
		}
		if (encoded.length > CAPSULE_LIMIT * 2) throw new Error("Missing or oversized capsule blob");
		const data = Buffer.from(encoded, "base64");
		if (
			data.toString("base64") !== encoded ||
			data.length !== file.artifact.bytes ||
			digest(data) !== file.artifact.sha256
		)
			throw new Error("Capsule blob checksum mismatch");
	}
	if (Object.keys(capsule.blobs).length !== expected.size) throw new Error("Unexpected capsule blobs");
	if (capsule.publication && [...expected].some((hash) => !capsule.blobs[hash]))
		throw new Error("Published capsule omitted an eligible blob");
}

/** Host-owned snapshots; branches never inherit an execution binding or approval. */
export class AnalysisEvidenceService {
	private readonly store: JsonStore<EvidenceLedger>;
	private readonly root: string;
	constructor(
		private readonly options: {
			root: string;
			analysis: AnalysisOrchestrationService;
			storage: StorageRegistry;
			replayRunner?: EvidenceReplayRunner;
		},
	) {
		this.root = resolve(options.root);
		const entry = options.storage.registerDiscoveredRoot(
			"analysis-evidence",
			this.root,
			"analysis/evidence",
			"private",
		);
		this.store = new JsonStore({
			// Registered default root id; custom roots use the path-derived entry above.
			// "agent-analysis-evidence"
			path: join(this.root, "ledger.json"),
			storageId: entry.id,
			defaultValue: () => ({ version: 1, checkpoints: {}, branches: {}, replays: {} }),
			mode: 0o600,
		});
	}
	/** Small UI projection; persisted receipts remain the authority for reproduction. */
	async overview(): Promise<EvidenceOverview> {
		const [ledger, analyses] = await Promise.all([this.store.read(), this.options.analysis.list()]);
		const checkpoints = await Promise.all(
			Object.values(ledger.checkpoints)
				.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
				.map((c) => this.summary(c)),
		);
		const replays = Object.values(ledger.replays)
			.sort((a, b) => b.completedAt.localeCompare(a.completedAt))
			.map((r) => ({ ...r, outputChecks: [...r.outputChecks] }));
		return {
			analyses: analyses.map((a) => ({
				id: a.id,
				question: a.question,
				assay: a.assay,
				stage: a.stage,
				artifactCount: a.provenance?.artifacts.length ?? 0,
			})),
			capabilities: projectCapabilityEvidence(analyses, checkpoints, replays),
			checkpoints,
			branches: Object.entries(ledger.branches).map(([id, b]) => ({ id, ...b })),
			replays,
		};
	}
	async summary(checkpoint: EvidenceCheckpoint): Promise<EvidenceCheckpointSummary> {
		let blobsAvailable = false;
		if (
			checkpoint.environmentFingerprint &&
			checkpoint.files.some((f) => f.kind === "code") &&
			checkpoint.files.some((f) => f.kind === "output")
		) {
			const availability = await Promise.all(
				checkpoint.files.map(async (file) => {
					try {
						const bytes = await readWithin(join(this.root, "blobs"), file.artifact.sha256);
						return bytes.length === file.artifact.bytes && digest(bytes) === file.artifact.sha256;
					} catch {
						return false;
					}
				}),
			);
			blobsAvailable = availability.every(Boolean);
		}
		return {
			id: checkpoint.id,
			analysisId: checkpoint.analysis.id,
			assay: checkpoint.analysis.assay,
			createdAt: checkpoint.createdAt,
			files: checkpoint.files.map((f) => ({
				path: f.artifact.path,
				kind: f.kind,
				bytes: f.artifact.bytes,
				sha256: f.artifact.sha256,
			})),
			...(checkpoint.environmentFingerprint
				? { environmentFingerprint: checkpoint.environmentFingerprint }
				: {}),
			replayReady: blobsAvailable,
		};
	}
	/** Freeze only host-recorded revisions, never renderer-supplied checksums or metadata. */
	async freezeRecorded(analysisId: string, sourceRoot: string): Promise<EvidenceCheckpointSummary> {
		const analysis = await this.options.analysis.get(analysisId);
		if (!analysis?.provenance?.artifacts.length) throw new Error("No recorded artifacts to freeze");
		const checkpoint = await this.freeze({
			analysisId,
			sourceRoot,
			files: analysis.provenance.artifacts.map((artifact) => ({ artifact, kind: artifact.role })),
			environmentFingerprint: analysis.provenance.reproducibility.environmentFingerprint,
		});
		return this.summary(checkpoint);
	}

	async getCheckpoint(id: string): Promise<EvidenceCheckpoint> {
		const item = (await this.store.read()).checkpoints[id];
		if (!item) throw new Error("Checkpoint not found");
		validateCheckpoint(item);
		return item;
	}
	async freeze(input: {
		analysisId: string;
		sourceRoot: string;
		files: readonly FrozenFile[];
		environmentFingerprint?: string;
	}): Promise<EvidenceCheckpoint> {
		const analysis = await this.options.analysis.get(input.analysisId);
		if (!analysis) throw new Error("Analysis not found");
		if (analysis.stage === "execution") throw new Error("Cannot checkpoint an executing analysis");
		const body = {
			schemaVersion: 1 as const,
			analysis,
			files: [...input.files].sort((a, b) => (a.artifact.path < b.artifact.path ? -1 : 1)),
			...(input.environmentFingerprint ? { environmentFingerprint: input.environmentFingerprint } : {}),
			createdAt: new Date().toISOString(),
			...(analysis.provenance?.lineage
				? {
						lineage: childCausalEnvelope(analysis.provenance.lineage, {
							eventId: newEventId(),
							runAttemptId: analysis.provenance.lineage.runAttemptId,
						}),
					}
				: {}),
		};
		const checkpoint = { ...body, id: checkpointId(body) };
		validateCheckpoint(checkpoint);
		// If the run already records a version, a caller cannot substitute different bytes for it.
		for (const file of checkpoint.files) {
			const known = analysis.provenance?.artifacts.find((a) => a.versionId === file.artifact.versionId);
			if (known && canonical(known) !== canonical(file.artifact))
				throw new Error("Artifact differs from recorded provenance");
			const bytes = await readWithin(input.sourceRoot, file.artifact.path);
			if (bytes.length !== file.artifact.bytes || digest(bytes) !== file.artifact.sha256)
				throw new Error("Artifact changed before freeze");
			await this.putBlob(file.artifact.sha256, bytes);
		}
		await this.store.update((ledger) => {
			ledger.checkpoints[checkpoint.id] = checkpoint;
		});
		return checkpoint;
	}
	private async putBlob(hash: string, bytes: Buffer): Promise<void> {
		const directory = join(this.root, "blobs");
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const path = join(directory, hash);
		try {
			await writeFile(path, bytes, { flag: "wx", mode: 0o400 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const current = await readWithin(directory, hash);
			if (digest(current) !== hash) throw new Error("Frozen blob is corrupted");
		}
	}
	private async buildCapsule(id: string, audience: EvidenceAudience = "private"): Promise<EvidenceCapsule> {
		const checkpoint = await this.getCheckpoint(id);
		const blobs: Record<string, string> = {};
		const omittedPaths: string[] = [];
		for (const file of checkpoint.files) {
			if (audienceRank(file.artifact.accessLevel ?? "private") > audienceRank(audience)) {
				omittedPaths.push(file.artifact.path);
				continue;
			}
			blobs[file.artifact.sha256] = (
				await readWithin(join(this.root, "blobs"), file.artifact.sha256)
			).toString("base64");
		}
		const capsule: EvidenceCapsule = {
			format: "drone-evidence-capsule",
			version: 1,
			checkpoint,
			blobs,
			...(audience === "private" ? {} : { publication: { audience, omittedPaths } }),
		};
		validateCapsule(capsule);
		return capsule;
	}
	async capsule(id: string): Promise<EvidenceCapsule> {
		return this.buildCapsule(id, "private");
	}
	/** Same checkpoint always produces the same bytes, including across restarts. Private local export. */
	async exportCapsule(
		id: string,
		audience: EvidenceAudience = "private",
	): Promise<{ path: string; sha256: string; audience: EvidenceAudience }> {
		const capsule = await this.buildCapsule(id, audience);
		const bytes = canonical(capsule);
		const path = join(this.root, "capsules", `${id}.${audience}.json`);
		await new JsonStore({
			// "agent-analysis-evidence" is registered for the default evidence root.
			path,
			storageId: this.store.storageId,
			defaultValue: () => capsule,
			serialize: stableJson,
			mode: 0o600,
		}).write(capsule);
		return { path, sha256: digest(bytes), audience };
	}
	async importCapsule(path: string): Promise<EvidenceCheckpoint> {
		const stat = await lstat(path);
		if (!stat.isFile() || stat.size > CAPSULE_LIMIT * 2) throw new Error("Invalid capsule file size");
		const capsule = JSON.parse(await readFile(path, "utf8")) as EvidenceCapsule;
		validateCapsule(capsule);
		// Public/restricted capsules are metadata-only for omitted files. They
		// remain useful for provenance, but cannot be replayed as if private bytes
		// were present. Keep that distinction in the persisted checkpoint.
		if (capsule.publication?.audience !== "private" && capsule.publication?.omittedPaths.length) {
			const omitted = new Set(capsule.publication.omittedPaths);
			if (
				capsule.checkpoint.files.some(
					(file) => omitted.has(file.artifact.path) && capsule.blobs[file.artifact.sha256] !== undefined,
				)
			)
				throw new Error("Published capsule contains a blob for an omitted private result");
		}
		for (const [hash, encoded] of Object.entries(capsule.blobs))
			await this.putBlob(hash, Buffer.from(encoded, "base64"));
		await this.store.update((ledger) => {
			ledger.checkpoints[capsule.checkpoint.id] = capsule.checkpoint;
		});
		return capsule.checkpoint;
	}
	private async materialize(
		capsule: EvidenceCapsule,
		root: string,
		files: readonly FrozenFile[],
	): Promise<void> {
		for (const file of files) {
			const path = join(root, file.artifact.path);
			await mkdir(dirname(path), { recursive: true, mode: 0o700 });
			// Copies, never hard links: editing a branch cannot mutate the frozen bytes.
			const encoded = capsule.blobs[file.artifact.sha256];
			if (typeof encoded !== "string") throw new Error("Frozen blob is missing");
			await writeFile(path, Buffer.from(encoded, "base64"), { flag: "wx", mode: 0o600 });
		}
	}
	async fork(
		checkpointId: string,
		branchId: string,
	): Promise<{ context: AnalysisContext; workspace: string }> {
		safeBranch(branchId);
		const capsule = await this.capsule(checkpointId);
		const workspace = join(this.root, "branches", branchId);
		const previous = await this.branch(branchId);
		await this.store.update((ledger) => {
			const existing = ledger.branches[branchId];
			if (existing && existing.status !== "failed")
				throw new Error("Branch already exists; use its persisted status");
			if (existing && existing.checkpointId !== checkpointId)
				throw new Error("Failed branch belongs to a different checkpoint");
			ledger.branches[branchId] = { checkpointId, workspace, status: "preparing" };
		});
		try {
			await mkdir(dirname(workspace), { recursive: true, mode: 0o700 });
			if (previous?.status === "failed") await rm(workspace, { recursive: true, force: true });
			await mkdir(workspace, { mode: 0o700 });
			await this.materialize(capsule, workspace, capsule.checkpoint.files);
			const existingContext = await this.options.analysis.get(branchId);
			const context = existingContext
				? existingContext
				: await this.options.analysis.forkCheckpoint(capsule.checkpoint.analysis, {
						id: branchId,
						checkpointId,
						workspace,
					});
			const branchOf = context.branchOf;
			if (
				!branchOf ||
				branchOf.analysisId !== capsule.checkpoint.analysis.id ||
				branchOf.checkpointId !== checkpointId ||
				branchOf.workspace !== workspace
			)
				throw new Error("Persisted branch context does not match the evidence checkpoint");
			await this.store.update((ledger) => {
				const branch = ledger.branches[branchId];
				if (!branch) throw new Error("Branch record disappeared");
				branch.status = "ready";
			});
			return { context, workspace };
		} catch (error) {
			await this.store.update((ledger) => {
				const branch = ledger.branches[branchId];
				if (branch) branch.status = "failed";
			});
			throw error;
		}
	}
	async branch(id: string) {
		return (await this.store.read()).branches[id];
	}
	async replay(id: string, runner = this.options.replayRunner): Promise<EvidenceReplayReceipt> {
		if (!runner) throw new Error("Replay runner is not configured for this host");
		const capsule = await this.capsule(id);
		const checkpoint = capsule.checkpoint;
		const outputs = checkpoint.files.filter((f) => f.kind === "output");
		if (
			!outputs.length ||
			!checkpoint.files.some((f) => f.kind === "code") ||
			!checkpoint.environmentFingerprint
		)
			throw new Error("Replay requires frozen code, expected outputs and an environment fingerprint");
		const parent = join(this.root, "replays");
		await mkdir(parent, { recursive: true, mode: 0o700 });
		const workspace = await mkdtemp(join(parent, "attempt-"));
		const inputDir = join(workspace, "inputs"),
			outputDir = join(workspace, "outputs");
		await mkdir(inputDir);
		await mkdir(outputDir);
		const checks: { path: string; matched: boolean }[] = [];
		let environmentMatched = false,
			detail = "Exact output bytes and environment matched";
		try {
			await this.materialize(
				capsule,
				inputDir,
				checkpoint.files.filter((f) => ["input", "code", "environment"].includes(f.kind)),
			);
			const result = await runner.run({ checkpoint: structuredClone(checkpoint), inputDir, outputDir });
			environmentMatched = result.environmentFingerprint === checkpoint.environmentFingerprint;
			for (const file of outputs) {
				let matched = false;
				try {
					const data = await readWithin(outputDir, file.artifact.path);
					matched = data.length === file.artifact.bytes && digest(data) === file.artifact.sha256;
				} catch {
					/* Missing or unsafe outputs fail verification. */
				}
				checks.push({ path: file.artifact.path, matched });
			}
			if (!environmentMatched || checks.some((c) => !c.matched))
				detail = "Output or environment differs from frozen evidence";
		} catch (error) {
			detail = `Replay failed: ${String(error).slice(0, 500)}`;
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
		const receipt: EvidenceReplayReceipt = {
			id: randomUUID(),
			checkpointId: id,
			status:
				environmentMatched && checks.length === outputs.length && checks.every((c) => c.matched)
					? "reproduced"
					: "failed",
			detail,
			outputChecks: checks,
			environmentMatched,
			completedAt: new Date().toISOString(),
			...(checkpoint.lineage
				? {
						lineage: childCausalEnvelope(checkpoint.lineage, {
							eventId: newEventId(),
							runAttemptId: newRunAttemptId(),
						}),
					}
				: {}),
		};
		await this.store.update((ledger) => {
			ledger.replays[receipt.id] = receipt;
		});
		return receipt;
	}
	async replayReceipts(checkpointId: string): Promise<readonly EvidenceReplayReceipt[]> {
		return Object.values((await this.store.read()).replays).filter((r) => r.checkpointId === checkpointId);
	}
}

/**
 * Build a read-only capability card without inventing a request or validation
 * capsule. Missing links stay absent so the Inspector can show the evidence
 * gap instead of upgrading an analysis run into a scientific claim.
 */
export function projectCapabilityEvidence(
	analyses: readonly AnalysisContext[],
	checkpoints: readonly EvidenceCheckpointSummary[],
	replays: EvidenceOverview["replays"],
): CapabilityEvidenceCard[] {
	return analyses.flatMap((analysis) => {
		const provenance = analysis.provenance;
		const explicitCheckpointId = provenance?.reproducibility.checkpointId;
		const checkpoint = explicitCheckpointId
			? checkpoints.find((value) => value.id === explicitCheckpointId)
			: checkpoints.find((value) => value.analysisId === analysis.id);
		const linkedReplays = checkpoint ? replays.filter((value) => value.checkpointId === checkpoint.id) : [];
		const evidenceState =
			provenance?.reproducibility.status === "verified"
				? "verified"
				: provenance?.reproducibility.status === "failed"
					? "blocked"
					: provenance
						? "observed"
						: "unknown";
		const gates = (analysis.readiness?.gates ?? []).map((gate) => ({
			id: gate.evidenceKey,
			status: gate.severity === "block" ? ("blocked" as const) : ("review" as const),
			detail: gate.message,
		}));
		return analysis.capabilities.map((capabilityId) => ({
			id: `${analysis.id}:${capabilityId}`,
			analysisId: analysis.id,
			capabilityId,
			...(analysis.adapter ? { versionRef: `${analysis.adapter.id}@${analysis.adapter.version}` } : {}),
			...(checkpoint ? { evidenceCapsuleRef: checkpoint.id } : {}),
			evidenceState,
			claimState: analysis.review?.approved ? ("inferred" as const) : ("unsupported" as const),
			capabilityState: analysis.adapter ? ("registered" as const) : ("candidate" as const),
			reuseLevel: "navigation-only" as const,
			freshness: provenance ? ("fresh" as const) : ("unknown" as const),
			scientificallyVerified: false,
			gates,
			runRefs: provenance ? [analysis.id] : [],
			artifactRefs: (provenance?.artifacts ?? []).map((artifact) => ({
				path: artifact.path,
				sha256: artifact.sha256,
			})),
			receiptRefs: linkedReplays.map((receipt) => receipt.id),
		}));
	});
}
