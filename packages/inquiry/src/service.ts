import { cleanupCandidates, validateArtifactLineage, validateFindingReferences } from "./lineage";
import {
	type ArtifactRecord,
	type ArtifactProvenance,
	type ArtifactRerunRecord,
	type ArtifactRerunResult,
	type AttemptRecord,
	type DecisionKind,
	type DecisionRecord,
	type FindingRecord,
	INQUIRY_SCHEMA_VERSION,
	LEGACY_INQUIRY_SCHEMA_VERSION,
	type QuestionRecord,
} from "./models";
import type { InquiryStorage } from "./storage";
import { artifactProvenance } from "./provenance";
import {
	type CleanupDryRun,
	cleanupDryRun,
	planWorkspacePromotion,
	promoteWorkspaceRun,
	type WorkspaceFilePort,
	type WorkspaceLayout,
	type WorkspacePromotionPlan,
	type WorkspacePromotionResult,
	type WorkspaceRun,
} from "./workspace";

/** Domain service used by hosts; all side effects are behind injected storage/files ports. */
export class InquiryService {
	private rerunHandler?: (
		provenance: ArtifactProvenance,
	) => Promise<{ readonly jobId: string } | ArtifactRecord>;

	constructor(
		readonly storage: InquiryStorage,
		options: { readonly rerunHandler?: (provenance: ArtifactProvenance) => Promise<{ readonly jobId: string } | ArtifactRecord> } = {},
	) {
		this.rerunHandler = options.rerunHandler;
	}

	setRerunHandler(handler: (provenance: ArtifactProvenance) => Promise<{ readonly jobId: string } | ArtifactRecord>): void {
		this.rerunHandler = handler;
	}

	async recordArtifact(record: ArtifactRecord): Promise<void> {
		const snapshot = await this.storage.snapshot();
		const errors = validateArtifactLineage(record, snapshot.artifacts);
		if (errors.length) throw new Error(`Invalid artifact record: ${errors.join("; ")}`);
		const existing = snapshot.artifacts.find((item) => item.id === record.id);
		const parents = snapshot.artifacts.filter((item) => record.parentIds.includes(item.id));
		const pending = [
			...new Set([
				...(existing?.pendingReviewDecisionIds ?? []),
				...parents.flatMap((item) => item.pendingReviewDecisionIds ?? []),
				...snapshot.decisions
					.filter(
						(item) =>
							item.status === "revoked" &&
							item.affectedArtifactIds.includes(record.id) &&
							!existing?.reviews?.some((review) => review.decisionId === item.id),
					)
					.map((item) => item.id),
			]),
		];
		await this.storage.artifacts.put({
			...record,
			...(existing?.reviews ? { reviews: existing.reviews } : {}),
			...(pending.length ? { status: "pending-review", pendingReviewDecisionIds: pending } : {}),
			...(!pending.length &&
			(existing?.status === "pending-review" || parents.some((item) => item.status === "pending-review"))
				? { status: "pending-review" }
				: {}),
		});
	}

	async recordFinding(record: FindingRecord): Promise<void> {
		const snapshot = await this.storage.snapshot();
		const errors = validateFindingReferences(record, snapshot);
		if (errors.length) throw new Error(`Invalid finding record: ${errors.join("; ")}`);
		await this.storage.findings.put(record);
	}

	async recordQuestion(record: QuestionRecord): Promise<void> {
		if (
			(record.schemaVersion !== INQUIRY_SCHEMA_VERSION &&
				record.schemaVersion !== LEGACY_INQUIRY_SCHEMA_VERSION) ||
			record.projectId !== this.storage.projectId ||
			!record.statement.trim()
		)
			throw new Error("Invalid question record");
		await this.storage.questions.put(record);
	}

	async recordAttempt(record: AttemptRecord): Promise<void> {
		if (
			(record.schemaVersion !== INQUIRY_SCHEMA_VERSION &&
				record.schemaVersion !== LEGACY_INQUIRY_SCHEMA_VERSION) ||
			record.projectId !== this.storage.projectId
		)
			throw new Error("Invalid attempt record");
		await this.storage.attempts.put(record);
	}

	async recordDecision(record: DecisionRecord): Promise<void> {
		if (
			record.schemaVersion !== INQUIRY_SCHEMA_VERSION ||
			record.projectId !== this.storage.projectId ||
			!record.id.trim() ||
			!record.summary.trim() ||
			!Array.isArray(record.basis) ||
			!Array.isArray(record.affectedArtifactIds)
		)
			throw new Error("Invalid decision record");
		const existing = await this.storage.decisions.get(record.id);
		// Receipt replay cannot reactivate a user's revoked decision.
		const next = existing
			? {
					...record,
					...existing,
					affectedArtifactIds: [...new Set([...existing.affectedArtifactIds, ...record.affectedArtifactIds])],
				}
			: record;
		await this.storage.decisions.put(next);
		if (next.status === "revoked") await this.markPendingReview(next);
	}

	async listDecisions(projectId = this.storage.projectId): Promise<readonly DecisionRecord[]> {
		if (projectId !== this.storage.projectId)
			throw new Error("Decision project does not match inquiry project");
		return [...(await this.storage.decisions.list())].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	/**
	 * Revocation is deliberately a ledger-only operation. It never calls a
	 * compute, Zotero, task, or other external adapter. Affected artifacts and
	 * every descendant in the immutable parentIds graph become pending review.
	 */
	async revokeDecision(id: string, reason: string, now = new Date().toISOString()): Promise<DecisionRecord> {
		const decision = await this.storage.decisions.get(id);
		if (!decision) throw new Error(`Decision not found: ${id}`);
		if (decision.status === "revoked") return decision;

		const revoked: DecisionRecord = {
			...decision,
			status: "revoked",
			revokedAt: now,
			revokeReason: reason.trim() || "Revoked by user",
		};
		await this.markPendingReview(revoked);
		await this.storage.decisions.put(revoked);
		return revoked;
	}

	/** Associate a successful execution's later artifacts with its original receipt. */
	async associateDecisionArtifacts(id: string, artifactIds: readonly string[]): Promise<void> {
		const record = await this.storage.decisions.get(id);
		if (!record) throw new Error(`Decision not found: ${id}`);
		await this.recordDecision({
			...record,
			affectedArtifactIds: [...record.affectedArtifactIds, ...artifactIds],
		});
	}

	private async markPendingReview(decision: DecisionRecord): Promise<void> {
		const snapshot = await this.storage.snapshot();
		const affected = new Set(decision.affectedArtifactIds);
		let changed = true;
		while (changed) {
			changed = false;
			for (const artifact of snapshot.artifacts) {
				if (!affected.has(artifact.id) && artifact.parentIds.some((parentId) => affected.has(parentId))) {
					affected.add(artifact.id);
					changed = true;
				}
			}
		}
		for (const artifact of snapshot.artifacts) {
			if (!affected.has(artifact.id) || artifact.reviews?.some((review) => review.decisionId === decision.id))
				continue;
			await this.storage.artifacts.put({
				...artifact,
				status: "pending-review",
				pendingReviewDecisionIds: [...new Set([...(artifact.pendingReviewDecisionIds ?? []), decision.id])],
				updatedAt: decision.revokedAt ?? new Date().toISOString(),
			});
		}
	}

	/** Explicit human acknowledgement; each independent revocation must be reviewed. */
	async confirmDecision(id: string, reason: string, now = new Date().toISOString()): Promise<DecisionRecord> {
		const decision = await this.storage.decisions.get(id);
		if (decision?.status !== "revoked") throw new Error("Only revoked decisions can be reviewed");
		if (!reason.trim()) throw new Error("A human review reason is required");
		const snapshot = await this.storage.snapshot();
		for (const artifact of snapshot.artifacts) {
			if (!artifact.pendingReviewDecisionIds?.includes(id)) continue;
			const pending = artifact.pendingReviewDecisionIds.filter((item) => item !== id);
			await this.storage.artifacts.put({
				...artifact,
				status: pending.length ? "pending-review" : "valid",
				pendingReviewDecisionIds: pending,
				reviews: [
					...(artifact.reviews ?? []),
					{ decisionId: id, confirmedBy: "user", confirmedAt: now, reason },
				],
				updatedAt: now,
			});
		}
		return decision;
	}

	/** Compatibility alias for host adapters that used the earlier review name. */
	async reviewDecisionArtifacts(
		id: string,
		reason: string,
		now = new Date().toISOString(),
	): Promise<DecisionRecord> {
		return this.confirmDecision(id, reason, now);
	}

	async cleanupDryRun(options: { readonly staleBefore?: string } = {}): Promise<CleanupDryRun> {
		return cleanupDryRun(this.storage, options);
	}

	async planPromotion(input: {
		readonly layout: WorkspaceLayout;
		readonly run: WorkspaceRun;
	}): Promise<WorkspacePromotionPlan> {
		const snapshot = await this.storage.snapshot();
		return planWorkspacePromotion({ layout: input.layout, run: input.run, artifacts: snapshot.artifacts });
	}

	async promote(input: {
		readonly plan: WorkspacePromotionPlan;
		readonly layout: WorkspaceLayout;
		readonly files: WorkspaceFilePort;
	}): Promise<WorkspacePromotionResult> {
		return promoteWorkspaceRun(input);
	}

	async snapshot() {
		return this.storage.snapshot();
	}

	async artifactProvenance(artifactId: string): Promise<ArtifactProvenance | undefined> {
		if (
			typeof artifactId !== "string" ||
			!artifactId.trim() ||
			artifactId.length > 512 ||
			[...artifactId].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
		)
			return undefined;
		return artifactProvenance(await this.storage.snapshot(), artifactId);
	}

	async rerunArtifact(artifactId: string): Promise<ArtifactRerunResult> {
		const provenance = await this.artifactProvenance(artifactId);
		if (!provenance) throw new Error(`Artifact not found: ${artifactId}`);
		if (provenance.reproducibility !== "reproducible") throw new Error("Artifact is not reproducible");
		if (!this.rerunHandler) throw new Error("Artifact rerun is unavailable");
		const existing = [...(await this.storage.reruns.list())]
			.filter((item) => item.sourceArtifactId === provenance.artifact.id)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
		if (existing && (existing.status === "submitted" || existing.status === "running")) return this.rerunResult(existing);
		const submitted = await this.rerunHandler(provenance);
		const now = new Date().toISOString();
		if ("id" in submitted && !("jobId" in submitted)) {
			const rerun: ArtifactRerunRecord = {
				id: `rerun:${provenance.artifact.id}:${submitted.id}`,
				schemaVersion: 2,
				projectId: this.storage.projectId,
				sourceArtifactId: provenance.artifact.id,
				artifact: provenance.artifact,
				jobId: submitted.id,
				status: "running",
				previousSha256: provenance.artifact.sha256,
				submittedAt: now,
				updatedAt: now,
			};
			await this.storage.reruns.put(rerun);
			return (await this.completeRerun(rerun.id, { artifact: submitted })) as ArtifactRerunResult;
		}
		if (!submitted || typeof submitted.jobId !== "string" || !submitted.jobId.trim()) throw new Error("Rerun submission did not return a job id");
		const rerun: ArtifactRerunRecord = {
			id: `rerun:${provenance.artifact.id}:${submitted.jobId}`,
			schemaVersion: 2,
			projectId: this.storage.projectId,
			sourceArtifactId: provenance.artifact.id,
			artifact: provenance.artifact,
			jobId: submitted.jobId,
			status: "submitted",
			previousSha256: provenance.artifact.sha256,
			submittedAt: now,
			updatedAt: now,
		};
		await this.storage.reruns.put(rerun);
		return this.rerunResult(rerun);
	}

	async pendingReruns(): Promise<readonly ArtifactRerunRecord[]> {
		return (await this.storage.reruns.list()).filter((item) => item.status === "submitted" || item.status === "running");
	}

	async markRerunRunning(rerunId: string): Promise<ArtifactRerunRecord | undefined> {
		const rerun = await this.storage.reruns.get(rerunId);
		if (rerun?.status !== "submitted") return rerun;
		const next = { ...rerun, status: "running" as const, updatedAt: new Date().toISOString() };
		await this.storage.reruns.put(next);
		return next;
	}

	async completeRerun(rerunId: string, outcome: { readonly artifact: ArtifactRecord } | { readonly error: string }): Promise<ArtifactRerunResult | undefined> {
		const rerun = await this.storage.reruns.get(rerunId);
		if (!rerun) return undefined;
		if (!["submitted", "running"].includes(rerun.status)) return this.rerunResult(rerun);
		if ("error" in outcome) {
			const failed = { ...rerun, status: "failed" as const, error: outcome.error.slice(0, 4096), updatedAt: new Date().toISOString() };
			await this.storage.reruns.put(failed);
			return this.rerunResult(failed);
		}
		const next = outcome.artifact;
		if (next.projectId !== this.storage.projectId) throw new Error("Rerun artifact belongs to another project");
		if (next.sha256 === rerun.previousSha256) {
			const reproduced = { ...rerun, status: "reproduced" as const, resultArtifactId: next.id, sha256: next.sha256, updatedAt: new Date().toISOString() };
			await this.storage.reruns.put(reproduced);
			return this.rerunResult(reproduced);
		}
		const superseded: ArtifactRecord = { ...rerun.artifact, status: "superseded", updatedAt: new Date().toISOString() };
		await this.storage.artifacts.put(superseded);
		await this.recordArtifact(next);
		const completed = { ...rerun, status: "superseded" as const, resultArtifactId: next.id, sha256: next.sha256, difference: "sha256 differs from the original artifact", updatedAt: new Date().toISOString() };
		await this.storage.reruns.put(completed);
		return this.rerunResult(completed);
	}

	private rerunResult(rerun: ArtifactRerunRecord): ArtifactRerunResult {
		return {
			status: rerun.status,
			jobId: rerun.jobId,
			previousArtifactId: rerun.sourceArtifactId,
			previousSha256: rerun.previousSha256,
			...(rerun.resultArtifactId ? { artifactId: rerun.resultArtifactId } : {}),
			...(rerun.sha256 ? { sha256: rerun.sha256 } : {}),
			...(rerun.difference ? { difference: rerun.difference } : {}),
			...(rerun.error ? { error: rerun.error } : {}),
		};
	}

	/** Read-only projection used by panel and LAN adapters. */
	async readOnlyState() {
		const snapshot = await this.storage.snapshot();
		return {
			projectId: snapshot.projectId,
			revision: snapshot.revision,
			artifacts: snapshot.artifacts,
			findings: snapshot.findings,
			questions: snapshot.questions,
			decisions: [...snapshot.decisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
			reruns: snapshot.reruns ?? [],
			cleanupCandidates: cleanupCandidates(snapshot),
		};
	}
}

export function decisionRecord(input: {
	readonly id: string;
	readonly projectId: string;
	readonly kind: DecisionKind;
	readonly summary: string;
	readonly basis?: readonly string[];
	readonly affectedArtifactIds?: readonly string[];
	readonly createdAt?: string;
}): DecisionRecord {
	return {
		id: input.id,
		schemaVersion: INQUIRY_SCHEMA_VERSION,
		projectId: input.projectId,
		kind: input.kind,
		summary: input.summary,
		basis: [...new Set(input.basis ?? [])],
		affectedArtifactIds: [...new Set(input.affectedArtifactIds ?? [])],
		status: "active",
		createdAt: input.createdAt ?? new Date().toISOString(),
	};
}
