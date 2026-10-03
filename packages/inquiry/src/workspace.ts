import { relative, resolve, sep } from "node:path";
import { type CleanupCandidate, cleanupCandidates, isSafeArtifactPath } from "./lineage";
import type { ArtifactRecord, AttemptRecord, FindingRecord, QuestionRecord } from "./models";
import type { InquiryStorage } from "./storage";

export interface WorkspaceLayout {
	readonly projectRoot: string;
	readonly inputsRoot: string;
	readonly runsRoot: string;
	readonly resultsRoot: string;
	readonly reportsRoot: string;
	readonly ledgerRoot: string;
	readonly indexPath: string;
}

export function workspaceLayout(projectRoot: string): WorkspaceLayout {
	const root = resolve(projectRoot);
	return {
		projectRoot: root,
		inputsRoot: resolve(root, "inputs"),
		runsRoot: resolve(root, "runs"),
		resultsRoot: resolve(root, "results"),
		reportsRoot: resolve(root, "reports"),
		ledgerRoot: resolve(root, ".drone"),
		indexPath: resolve(root, "results", "index.json"),
	};
}

export interface WorkspaceRun {
	readonly id: string;
	readonly taskId: string;
	readonly root: string;
	readonly state: "active" | "frozen";
	readonly createdAt: string;
	readonly frozenAt?: string;
}

export interface WorkspaceEntry {
	readonly artifactId: string;
	readonly sourcePath: string;
	readonly resultPath: string;
	readonly sha256: string;
	readonly bytes: number;
	readonly purpose: ArtifactRecord["purpose"];
}

export interface WorkspaceMove {
	readonly from: string;
	readonly to: string;
	readonly artifactId: string;
}

export interface WorkspacePromotionPlan {
	readonly runId: string;
	readonly moves: readonly WorkspaceMove[];
	readonly indexEntries: readonly WorkspaceEntry[];
}

export interface WorkspacePromotionResult extends WorkspacePromotionPlan {
	readonly promotedAt: string;
	readonly indexPath: string;
}

export interface WorkspaceFilePort {
	move(from: string, to: string): Promise<void>;
	writeIndex(path: string, entries: readonly WorkspaceEntry[]): Promise<void>;
}

export function validateWorkspaceRelativePath(path: string): boolean {
	return isSafeArtifactPath(path) && !path.split(/[\\/]/).includes(".drone");
}

function assertWithin(root: string, path: string): void {
	const resolved = resolve(root, path);
	const rel = relative(root, resolved);
	if (!rel || rel === ".." || rel.startsWith(`..${sep}`))
		throw new Error("Workspace path escapes project root");
}

/** Build a move-only plan. It never touches the file system. */
export function planWorkspacePromotion(input: {
	readonly layout: WorkspaceLayout;
	readonly run: WorkspaceRun;
	readonly artifacts: readonly ArtifactRecord[];
}): WorkspacePromotionPlan {
	if (input.run.state !== "frozen") throw new Error("Only frozen runs can be promoted");
	const selected = input.artifacts
		.filter((artifact) => artifact.runId === input.run.id && artifact.status === "valid")
		.sort((a, b) => a.id.localeCompare(b.id));
	const relativeResultPath = (artifact: ArtifactRecord): string => {
		const relativePath = artifact.path.replaceAll("\\", "/").replace(/^runs\/(?:[^/]+)\/(?:[^/]+)\/?/, "");
		return `results/${input.run.taskId}/${input.run.id}/${relativePath || artifact.id}`;
	};
	const moves = selected.map((artifact) => {
		if (!validateWorkspaceRelativePath(artifact.path))
			throw new Error(`Unsafe workspace artifact path: ${artifact.path}`);
		const sourcePath = resolve(input.layout.projectRoot, artifact.path);
		const resultPath = relativeResultPath(artifact);
		assertWithin(input.layout.projectRoot, sourcePath);
		assertWithin(input.layout.projectRoot, resultPath);
		return { from: sourcePath, to: resolve(input.layout.projectRoot, resultPath), artifactId: artifact.id };
	});
	const indexEntries = selected.map((artifact) => ({
		artifactId: artifact.id,
		sourcePath: artifact.path,
		resultPath: relativeResultPath(artifact),
		sha256: artifact.sha256,
		bytes: artifact.bytes,
		purpose: artifact.purpose,
	}));
	return { runId: input.run.id, moves, indexEntries };
}

/** Execute a previously reviewed plan. The adapter only moves and writes an index. */
export async function promoteWorkspaceRun(input: {
	readonly plan: WorkspacePromotionPlan;
	readonly layout: WorkspaceLayout;
	readonly files: WorkspaceFilePort;
}): Promise<WorkspacePromotionResult> {
	for (const move of input.plan.moves) await input.files.move(move.from, move.to);
	await input.files.writeIndex(input.layout.indexPath, input.plan.indexEntries);
	return { ...input.plan, promotedAt: new Date().toISOString(), indexPath: input.layout.indexPath };
}

export interface CleanupDryRun {
	readonly candidates: readonly CleanupCandidate[];
	readonly generatedAt: string;
	readonly destructive: false;
}

/** Produce a reviewable cleanup proposal; this function deliberately cannot delete. */
export async function cleanupDryRun(
	storage: InquiryStorage,
	options: { readonly staleBefore?: string } = {},
): Promise<CleanupDryRun> {
	const snapshot = await storage.snapshot();
	return {
		candidates: cleanupCandidates(snapshot, options),
		generatedAt: new Date().toISOString(),
		destructive: false,
	};
}

export function workspaceIndexForSnapshot(snapshot: {
	readonly artifacts: readonly ArtifactRecord[];
	readonly findings: readonly FindingRecord[];
	readonly questions: readonly QuestionRecord[];
	readonly attempts: readonly AttemptRecord[];
}): readonly WorkspaceEntry[] {
	const referenced = new Set(
		snapshot.artifacts.filter((artifact) => artifact.status === "valid").map((artifact) => artifact.id),
	);
	return snapshot.artifacts
		.filter((artifact) => referenced.has(artifact.id) && artifact.purpose === "deliverable")
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((artifact) => ({
			artifactId: artifact.id,
			sourcePath: artifact.path,
			resultPath: artifact.path.startsWith("results/") ? artifact.path : `results/${artifact.path}`,
			sha256: artifact.sha256,
			bytes: artifact.bytes,
			purpose: artifact.purpose,
		}));
}

export type WorkspaceAttempt = AttemptRecord;
