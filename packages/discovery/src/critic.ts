import type { AttemptRecord, FindingRecord, QuestionRecord } from "@drone/inquiry";
import type { InquiryDiscoveryPort } from "./inquiry-port";
import { assertValid, boundedInteger, nonEmptyText, safeId } from "./validation";

export const CRITIC_CHECKLIST = [
	"confounding",
	"batch-effect",
	"multiple-testing",
	"data-leakage",
	"circular-analysis",
	"overclaiming",
] as const;
export type CriticChecklistItem = (typeof CRITIC_CHECKLIST)[number];
export const CRITIC_ROLE = Object.freeze({
	id: "critic",
	readOnly: true,
	canWrite: false,
	canShell: false,
	canNetwork: false,
	canDelegate: false,
	checklist: CRITIC_CHECKLIST,
});
export interface CriticQuestion {
	readonly checklistItem: CriticChecklistItem;
	readonly question: string;
	readonly severity: "high" | "medium" | "low";
	readonly evidenceArtifactIds: readonly string[];
}
export interface CriticRequest {
	readonly findingId: string;
	readonly findingStatement: string;
	readonly artifactIds: readonly string[];
	readonly primaryProviderId: string;
	readonly checklist?: readonly CriticChecklistItem[];
}
export interface CriticProvider {
	readonly providerId: string;
	review(input: CriticRequest & { readonly role: typeof CRITIC_ROLE }): Promise<readonly CriticQuestion[]>;
}
export type CriticReviewStatus = "complete" | "blocked" | "needs-independent-provider";
export interface CriticReviewResult {
	readonly status: CriticReviewStatus;
	readonly providerId?: string;
	readonly questions: readonly CriticQuestion[];
	readonly reason?: string;
}
function validateQuestion(question: CriticQuestion): void {
	assertValid(CRITIC_CHECKLIST.includes(question.checklistItem), "invalid critic checklist item");
	assertValid(nonEmptyText(question.question, 10_000), "critic question is invalid");
	assertValid(["high", "medium", "low"].includes(question.severity), "critic severity is invalid");
	for (const id of question.evidenceArtifactIds)
		assertValid(safeId(id), "critic evidence artifact id is invalid");
}
export async function runCriticReview(
	request: CriticRequest,
	provider: CriticProvider | undefined,
	options: { readonly timeoutMs?: number; readonly maxQuestions?: number } = {},
): Promise<CriticReviewResult> {
	assertValid(safeId(request.findingId), "finding id is invalid");
	assertValid(nonEmptyText(request.findingStatement, 20_000), "finding statement is invalid");
	assertValid(safeId(request.primaryProviderId), "primary provider id is invalid");
	for (const id of request.artifactIds) assertValid(safeId(id), "artifact id is invalid");
	const checklist = request.checklist ?? CRITIC_CHECKLIST;
	assertValid(
		checklist.length > 0 && checklist.every((item) => CRITIC_CHECKLIST.includes(item)),
		"invalid critic checklist",
	);
	const timeoutMs = options.timeoutMs ?? 30_000;
	const maxQuestions = options.maxQuestions ?? 64;
	assertValid(boundedInteger(timeoutMs, 1, 600_000), "critic timeout is invalid");
	assertValid(boundedInteger(maxQuestions, 1, 256), "critic question limit is invalid");
	if (!provider || provider.providerId === request.primaryProviderId)
		return {
			status: "needs-independent-provider",
			questions: [],
			reason: "critic provider must be independent of the primary provider",
		};
	try {
		const questions = await Promise.race([
			provider.review({ ...request, checklist, role: CRITIC_ROLE }),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error("critic-timeout")), timeoutMs)),
		]);
		assertValid(
			Array.isArray(questions) && questions.length <= maxQuestions,
			"critic returned too many questions",
		);
		for (const question of questions) validateQuestion(question);
		return { status: "complete", providerId: provider.providerId, questions };
	} catch (error) {
		return {
			status: "blocked",
			questions: [],
			reason: error instanceof Error ? error.message : "critic-failure",
		};
	}
}
export async function recordCriticQuestions(
	port: InquiryDiscoveryPort,
	input: {
		readonly projectId: string;
		readonly findingId: string;
		readonly questions: readonly CriticQuestion[];
	},
): Promise<readonly QuestionRecord[]> {
	assertValid(safeId(input.projectId), "projectId is invalid");
	assertValid(safeId(input.findingId), "finding id is invalid");
	const now = new Date().toISOString();
	const records = input.questions.map((question, index): QuestionRecord => {
		validateQuestion(question);
		return {
			id: `critic:${input.findingId}:${index + 1}`,
			schemaVersion: 1,
			projectId: input.projectId,
			kind: "question",
			statement: `[${question.checklistItem}] ${question.question}`,
			competingExplanations: [],
			testsDone: [],
			testsPlanned: [],
			status: "open",
			proposer: "agent",
			priority: question.severity === "high" ? 1 : question.severity === "medium" ? 0.7 : 0.4,
			createdAt: now,
			updatedAt: now,
		};
	});
	for (const record of records) await port.recordQuestion(record);
	return records;
}
export type DiscoveryAnalysisIntent = "exploratory" | "confirmatory";
export type DiscoveryPathOutcome = "succeeded" | "failed" | "blocked" | "unknown";
export interface MultipathAnalysisPath {
	readonly id: string;
	readonly parameters?: Readonly<Record<string, string | number | boolean | null>>;
	readonly description: string;
}
export interface MultipathPlan {
	readonly id: string;
	readonly findingId: string;
	readonly paths: readonly MultipathAnalysisPath[];
	readonly intent: DiscoveryAnalysisIntent;
	readonly priorRegistered: boolean;
}
export interface MultipathPathExecutionResult {
	readonly outcome: DiscoveryPathOutcome;
	readonly signature: string;
	readonly summary: string;
	readonly artifactIds?: readonly string[];
	readonly consistentWithReference: boolean;
}
export interface MultipathPathExecutionRecord {
	readonly pathId: string;
	readonly outcome: DiscoveryPathOutcome;
	readonly signature: string;
	readonly summary: string;
	readonly consistentWithReference: boolean;
	readonly durationMs: number;
	readonly attempt: AttemptRecord;
}
export interface MultipathAssessment {
	readonly grade: "robust" | "sensitive" | "unstable" | "unknown";
	readonly attemptCount: number;
	readonly consistentCount: number;
	readonly consistency: number;
	readonly label: DiscoveryAnalysisIntent;
	readonly paths: readonly MultipathPathExecutionRecord[];
}
export function createMultiPathPlan(input: MultipathPlan): MultipathPlan {
	assertValid(safeId(input.id), "multi-path plan id is invalid");
	assertValid(safeId(input.findingId), "finding id is invalid");
	assertValid(input.paths.length >= 5 && input.paths.length <= 10, "multi-path plans require 5 to 10 paths");
	assertValid(
		input.intent === "exploratory" || input.intent === "confirmatory",
		"analysis intent is invalid",
	);
	for (const path of input.paths) {
		assertValid(safeId(path.id), "analysis path id is invalid");
		assertValid(nonEmptyText(path.description, 10_000), "analysis path description is invalid");
	}
	assertValid(
		new Set(input.paths.map((path) => path.id)).size === input.paths.length,
		"analysis path ids must be unique",
	);
	if (input.intent === "confirmatory")
		assertValid(input.priorRegistered, "confirmatory analysis requires a registered prior");
	return { ...input, paths: [...input.paths] };
}
export async function executeMultiPath(
	plan: MultipathPlan,
	executor: (path: MultipathAnalysisPath) => Promise<MultipathPathExecutionResult>,
	options: {
		readonly timeoutMs?: number;
		readonly projectId?: string;
		readonly hypothesisId?: string;
		readonly inquiry?: InquiryDiscoveryPort;
	} = {},
): Promise<MultipathAssessment> {
	const timeoutMs = options.timeoutMs ?? 60_000;
	assertValid(boundedInteger(timeoutMs, 1, 86_400_000), "multi-path timeout is invalid");
	const records: MultipathPathExecutionRecord[] = [];
	for (const path of plan.paths) {
		const started = Date.now();
		let result: MultipathPathExecutionResult;
		try {
			result = await Promise.race([
				executor(path),
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error("path-timeout")), timeoutMs)),
			]);
			assertValid(
				["succeeded", "failed", "blocked", "unknown"].includes(result.outcome),
				"invalid path outcome",
			);
			assertValid(safeId(result.signature), "path signature is invalid");
			assertValid(nonEmptyText(result.summary, 20_000), "path summary is invalid");
		} catch (error) {
			result = {
				outcome: "blocked",
				signature: "executor-failure",
				summary: error instanceof Error ? error.message : "path-failure",
				consistentWithReference: false,
			};
		}
		const now = new Date().toISOString();
		const attempt: AttemptRecord = {
			id: `multipath:${plan.id}:${path.id}`,
			schemaVersion: 1,
			projectId: options.projectId ?? "discovery",
			hypothesisIds: options.hypothesisId ? [options.hypothesisId] : [],
			parameters: path.parameters ?? {},
			artifactIds: result.artifactIds ?? [],
			resultSummary: result.summary,
			outcome: result.outcome,
			enteredReport: false,
			startedAt: now,
			finishedAt: new Date().toISOString(),
		};
		const record = {
			pathId: path.id,
			outcome: result.outcome,
			signature: result.signature,
			summary: result.summary,
			consistentWithReference: result.consistentWithReference,
			durationMs: Date.now() - started,
			attempt,
		};
		records.push(record);
		if (options.inquiry) {
			assertValid(options.projectId, "projectId is required when recording multipath attempts");
			await options.inquiry.recordAttempt(attempt);
		}
	}
	const consistentCount = records.filter(
		(record) => record.outcome === "succeeded" && record.consistentWithReference,
	).length;
	const consistency = records.length ? consistentCount / records.length : 0;
	const grade =
		records.some((record) => record.outcome === "blocked" || record.outcome === "unknown") &&
		consistentCount === 0
			? "unknown"
			: consistency >= 0.8
				? "robust"
				: consistency >= 0.5
					? "sensitive"
					: "unstable";
	return {
		grade,
		attemptCount: records.length,
		consistentCount,
		consistency,
		label: plan.intent,
		paths: records,
	};
}
export function findingRobustness(assessment: MultipathAssessment): {
	readonly attemptCount: number;
	readonly consistentCount: number;
	readonly grade: MultipathAssessment["grade"];
} {
	return {
		attemptCount: assessment.attemptCount,
		consistentCount: assessment.consistentCount,
		grade: assessment.grade,
	};
}
export function assertFindingLabel(label: FindingRecord["label"], intent: DiscoveryAnalysisIntent): void {
	assertValid(
		(label === "exploratory" && intent === "exploratory") ||
			(label === "confirmatory" && intent === "confirmatory"),
		"finding label does not match analysis intent",
	);
}
export function criticQuestionsForFinding(
	snapshot: { readonly questions: readonly QuestionRecord[] },
	findingId: string,
): readonly QuestionRecord[] {
	assertValid(safeId(findingId), "finding id is invalid");
	return snapshot.questions.filter((question) => question.id.startsWith(`critic:${findingId}:`));
}
