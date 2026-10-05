import { cleanupCandidates, validateArtifactLineage, validateFindingReferences } from "./lineage";
import type {
	ArtifactProvenance,
	ArtifactRecord,
	ArtifactRerunRecord,
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
	private rerunHandler?: (
		provenance: ArtifactProvenance,
	) => Promise<{ readonly jobId: string } | ArtifactRecord>;

	constructor(
		readonly storage: InquiryStorage,
		options: {
			readonly rerunHandler?: (
				provenance: ArtifactProvenance,
			) => Promise<{ readonly jobId: string } | ArtifactRecord>;
		} = {},
	) {
		this.rerunHandler = options.rerunHandler;
	}

	setRerunHandler(
		handler: (provenance: ArtifactProvenance) => Promise<{ readonly jobId: string } | ArtifactRecord>,
	): void {
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
		const existing = [...(await this.storage.reruns.list())]
			.filter((item) => item.sourceArtifactId === provenance.artifact.id)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
		if (existing && (existing.status === "submitted" || existing.status === "running"))
			return this.rerunResult(existing);
		const submitted = await this.rerunHandler(provenance);
		if ("id" in submitted && !("jobId" in submitted)) {
			const now = new Date().toISOString();
			const rerun: ArtifactRerunRecord = {
				id: `rerun:${provenance.artifact.id}:${submitted.id}`,
				schemaVersion: 1,
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
		if (!submitted || typeof submitted.jobId !== "string" || !submitted.jobId.trim())
			throw new Error("Rerun submission did not return a job id");
		const now = new Date().toISOString();
		const rerun: ArtifactRerunRecord = {
			id: `rerun:${provenance.artifact.id}:${submitted.jobId}`,
			schemaVersion: 1,
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
		return (await this.storage.reruns.list()).filter(
			(item) => item.status === "submitted" || item.status === "running",
		);
	}

	async markRerunRunning(rerunId: string): Promise<ArtifactRerunRecord | undefined> {
		const rerun = await this.storage.reruns.get(rerunId);
		if (rerun?.status !== "submitted") return rerun;
		const next = { ...rerun, status: "running" as const, updatedAt: new Date().toISOString() };
		await this.storage.reruns.put(next);
		return next;
	}

	async completeRerun(
		rerunId: string,
		outcome: { readonly artifact: ArtifactRecord } | { readonly error: string },
	): Promise<ArtifactRerunResult | undefined> {
		const rerun = await this.storage.reruns.get(rerunId);
		if (!rerun) return undefined;
		if (!["submitted", "running"].includes(rerun.status)) return this.rerunResult(rerun);
		if ("error" in outcome) {
			const failed: ArtifactRerunRecord = {
				...rerun,
				status: "failed",
				error: outcome.error.slice(0, 4096),
				updatedAt: new Date().toISOString(),
			};
			await this.storage.reruns.put(failed);
			return this.rerunResult(failed);
		}
		const next = outcome.artifact;
		if (next.projectId !== this.storage.projectId)
			throw new Error("Rerun artifact belongs to another project");
		if (next.sha256 === rerun.previousSha256) {
			const reproduced: ArtifactRerunRecord = {
				...rerun,
				status: "reproduced",
				resultArtifactId: next.id,
				sha256: next.sha256,
				updatedAt: new Date().toISOString(),
			};
			await this.storage.reruns.put(reproduced);
			return this.rerunResult(reproduced);
		}
		const superseded: ArtifactRecord = {
			...rerun.artifact,
			status: "superseded",
			updatedAt: new Date().toISOString(),
		};
		await this.storage.artifacts.put(superseded);
		await this.recordArtifact(next);
		const completed: ArtifactRerunRecord = {
			...rerun,
			status: "superseded",
			resultArtifactId: next.id,
			sha256: next.sha256,
			difference: "sha256 differs from the original artifact",
			updatedAt: new Date().toISOString(),
		};
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
			cleanupCandidates: cleanupCandidates(snapshot),
		};
	}
}
