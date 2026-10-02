import { cleanupCandidates, validateArtifactLineage, validateFindingReferences } from "./lineage";
import type { ArtifactRecord, AttemptRecord, FindingRecord, QuestionRecord } from "./models";
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
		await this.storage.artifacts.put(record);
	}

	async recordFinding(record: FindingRecord): Promise<void> {
		const snapshot = await this.storage.snapshot();
		const errors = validateFindingReferences(record, snapshot);
		if (errors.length) throw new Error(`Invalid finding record: ${errors.join("; ")}`);
		await this.storage.findings.put(record);
	}

	async recordQuestion(record: QuestionRecord): Promise<void> {
		if (record.schemaVersion !== 1 || record.projectId !== this.storage.projectId || !record.statement.trim())
			throw new Error("Invalid question record");
		await this.storage.questions.put(record);
	}

	async recordAttempt(record: AttemptRecord): Promise<void> {
		if (record.schemaVersion !== 1 || record.projectId !== this.storage.projectId)
			throw new Error("Invalid attempt record");
		await this.storage.attempts.put(record);
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
			cleanupCandidates: cleanupCandidates(snapshot),
		};
	}
}
