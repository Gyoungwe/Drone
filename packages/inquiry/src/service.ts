import { cleanupCandidates, validateArtifactLineage, validateFindingReferences } from "./lineage";
import type {
	ArtifactProvenance,
	ArtifactRecord,
	ArtifactRerunResult,
	AttemptRecord,
	FindingRecord,
	QuestionRecord,
} from "./models";
import { artifactProvenance } from "./provenance";
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
	private rerunHandler?: (provenance: ArtifactProvenance) => Promise<ArtifactRecord>;

	constructor(
		readonly storage: InquiryStorage,
		options: { readonly rerunHandler?: (provenance: ArtifactProvenance) => Promise<ArtifactRecord> } = {},
	) {
		this.rerunHandler = options.rerunHandler;
	}

	setRerunHandler(handler: (provenance: ArtifactProvenance) => Promise<ArtifactRecord>): void {
		this.rerunHandler = handler;
	}

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

	async artifactProvenance(artifactId: string): Promise<ArtifactProvenance | undefined> {
		if (
			typeof artifactId !== "string" ||
			!artifactId.trim() ||
			artifactId.length > 512 ||
			[...artifactId].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
		)
			return undefined;
		const snapshot = await this.storage.snapshot();
		return artifactProvenance(snapshot, artifactId);
	}

	async rerunArtifact(artifactId: string): Promise<ArtifactRerunResult> {
		const provenance = await this.artifactProvenance(artifactId);
		if (!provenance) throw new Error(`Artifact not found: ${artifactId}`);
		if (provenance.reproducibility !== "reproducible") throw new Error("Artifact is not reproducible");
		if (!this.rerunHandler) throw new Error("Artifact rerun is unavailable");
		const next = await this.rerunHandler(provenance);
		if (next.projectId !== this.storage.projectId)
			throw new Error("Rerun artifact belongs to another project");
		if (next.sha256 === provenance.artifact.sha256) {
			return {
				status: "reproduced",
				previousArtifactId: provenance.artifact.id,
				artifactId: next.id,
				previousSha256: provenance.artifact.sha256,
				sha256: next.sha256,
			};
		}
		const superseded: ArtifactRecord = {
			...provenance.artifact,
			status: "superseded",
			updatedAt: new Date().toISOString(),
		};
		await this.storage.artifacts.put(superseded);
		await this.recordArtifact(next);
		return {
			status: "superseded",
			previousArtifactId: provenance.artifact.id,
			artifactId: next.id,
			previousSha256: provenance.artifact.sha256,
			sha256: next.sha256,
			difference: "sha256 differs from the original artifact",
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
			cleanupCandidates: cleanupCandidates(snapshot),
		};
	}
}
