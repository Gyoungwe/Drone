import { cleanupCandidates, validateArtifactLineage, validateFindingReferences } from "./lineage";
import {
	type ArtifactRecord,
	type AttemptRecord,
	type DecisionKind,
	type DecisionRecord,
	type FindingRecord,
	INQUIRY_SCHEMA_VERSION,
	LEGACY_INQUIRY_SCHEMA_VERSION,
	type QuestionRecord,
} from "./models";
import type { InquiryStorage } from "./storage";
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
	constructor(readonly storage: InquiryStorage) {}

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
	async reviewDecisionArtifacts(
		id: string,
		reason: string,
		now = new Date().toISOString(),
	): Promise<DecisionRecord> {
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
				reviews: [...(artifact.reviews ?? []), { decisionId: id, reason, at: now }],
				updatedAt: now,
			});
		}
		return decision;
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
