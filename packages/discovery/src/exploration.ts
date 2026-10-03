import { randomUUID } from "node:crypto";
import type { AttemptRecord, QuestionPosterior, QuestionPrior, QuestionRecord } from "@drone/inquiry";
import type { InquiryDiscoveryPort } from "./inquiry-port";
import {
	assertValid,
	boundedInteger,
	finiteNonNegative,
	isoDate,
	nonEmptyText,
	positiveFinite,
	safeId,
	stableJson,
} from "./validation";

export type RobustnessLevel = "robust" | "sensitive" | "unstable";
export interface DiscoveryExplorationBudget {
	readonly maxExecutions: number;
	readonly maxWallTimeMs: number;
	readonly maxOutputBytes: number;
	readonly maxCostUnits: number;
}
export interface DiscoveryExplorationMilestone {
	readonly id: string;
	readonly projectId: string;
	readonly hypothesisId: string;
	readonly prior: QuestionPrior;
	readonly budget: DiscoveryExplorationBudget;
	readonly independentCallBudget: true;
	readonly status: "planned";
	readonly createdAt: string;
}

export class ExplorationBudgetError extends Error {
	readonly code = "exploration-budget-exceeded";
}
function validateBudget(budget: DiscoveryExplorationBudget): void {
	assertValid(boundedInteger(budget.maxExecutions, 1, 1_000_000), "maxExecutions is invalid");
	assertValid(boundedInteger(budget.maxWallTimeMs, 1, 365 * 24 * 60 * 60_000), "maxWallTimeMs is invalid");
	assertValid(boundedInteger(budget.maxOutputBytes, 1, Number.MAX_SAFE_INTEGER), "maxOutputBytes is invalid");
	assertValid(positiveFinite(budget.maxCostUnits), "maxCostUnits is invalid");
}
function validatePrior(prior: QuestionPrior): void {
	assertValid(prior && isoDate(prior.recordedAt), "prior timestamp is invalid");
	assertValid(
		["positive", "negative", "none", "unknown"].includes(prior.direction),
		"prior direction is invalid",
	);
	if (prior.magnitude !== undefined)
		assertValid(finiteNonNegative(prior.magnitude), "prior magnitude is invalid");
	if (prior.confidence !== undefined)
		assertValid(prior.confidence >= 0 && prior.confidence <= 1, "prior confidence is invalid");
}
export function createExplorationMilestone(input: {
	readonly id: string;
	readonly projectId: string;
	readonly hypothesisId: string;
	readonly prior: QuestionPrior;
	readonly budget: DiscoveryExplorationBudget;
	readonly createdAt?: string;
}): DiscoveryExplorationMilestone {
	assertValid(safeId(input.id), "milestone id is invalid");
	assertValid(safeId(input.projectId), "projectId is invalid");
	assertValid(safeId(input.hypothesisId), "hypothesisId is invalid");
	validatePrior(input.prior);
	validateBudget(input.budget);
	const createdAt = input.createdAt ?? new Date().toISOString();
	assertValid(isoDate(createdAt), "milestone timestamp is invalid");
	return { ...input, independentCallBudget: true, status: "planned", createdAt };
}
export class ExplorationBudgetLedger {
	private current = { executions: 0, wallTimeMs: 0, outputBytes: 0, costUnits: 0 };
	constructor(readonly budget: DiscoveryExplorationBudget) {
		validateBudget(budget);
	}
	get usage(): Readonly<typeof this.current> {
		return { ...this.current };
	}
	reserve(input: Readonly<typeof this.current>): Readonly<typeof this.current> {
		assertValid(
			boundedInteger(input.executions, 0, this.budget.maxExecutions),
			"usage executions are invalid",
		);
		assertValid(finiteNonNegative(input.wallTimeMs), "usage wall time is invalid");
		assertValid(finiteNonNegative(input.outputBytes), "usage output bytes is invalid");
		assertValid(finiteNonNegative(input.costUnits), "usage cost is invalid");
		const next = {
			executions: this.current.executions + input.executions,
			wallTimeMs: this.current.wallTimeMs + input.wallTimeMs,
			outputBytes: this.current.outputBytes + input.outputBytes,
			costUnits: this.current.costUnits + input.costUnits,
		};
		if (
			next.executions > this.budget.maxExecutions ||
			next.wallTimeMs > this.budget.maxWallTimeMs ||
			next.outputBytes > this.budget.maxOutputBytes ||
			next.costUnits > this.budget.maxCostUnits
		)
			throw new ExplorationBudgetError("exploration budget exceeded");
		this.current = next;
		return this.usage;
	}
}
export function computeSurprise(prior: QuestionPrior, posterior: QuestionPosterior): number {
	validatePrior(prior);
	assertValid(posterior && isoDate(posterior.recordedAt), "posterior timestamp is invalid");
	assertValid(Date.parse(posterior.recordedAt) >= Date.parse(prior.recordedAt), "posterior predates prior");
	if (posterior.magnitude !== undefined)
		assertValid(finiteNonNegative(posterior.magnitude), "posterior magnitude is invalid");
	if (posterior.confidence !== undefined)
		assertValid(posterior.confidence >= 0 && posterior.confidence <= 1, "posterior confidence is invalid");
	const directionChange =
		posterior.direction && posterior.direction !== "unknown" && posterior.direction !== prior.direction
			? 0.5
			: 0;
	const magnitudeChange = Math.min(
		1,
		Math.abs((posterior.magnitude ?? prior.magnitude ?? 0) - (prior.magnitude ?? 0)) /
			Math.max(1, Math.abs(prior.magnitude ?? 0)),
	);
	const confidenceChange = Math.min(
		1,
		Math.abs((posterior.confidence ?? prior.confidence ?? 0.5) - (prior.confidence ?? 0.5)),
	);
	return Math.min(1, directionChange + magnitudeChange * 0.35 + confidenceChange * 0.15);
}
export interface ExplorationCandidate {
	readonly id: string;
	readonly statement: string;
	readonly surprise: number;
	readonly estimatedCost: number;
	readonly expectedExplanationsExcluded: number;
	readonly credibility: number;
}
export function rankExplorationCandidates(
	candidates: readonly ExplorationCandidate[],
): readonly ExplorationCandidate[] {
	for (const candidate of candidates) {
		assertValid(safeId(candidate.id), "candidate id is invalid");
		assertValid(nonEmptyText(candidate.statement, 10_000), "candidate statement is invalid");
		assertValid(
			finiteNonNegative(candidate.surprise) && candidate.surprise <= 1,
			"candidate surprise is invalid",
		);
		assertValid(positiveFinite(candidate.estimatedCost), "candidate cost is invalid");
		assertValid(
			finiteNonNegative(candidate.expectedExplanationsExcluded),
			"candidate discrimination is invalid",
		);
		assertValid(
			finiteNonNegative(candidate.credibility) && candidate.credibility <= 1,
			"candidate credibility is invalid",
		);
	}
	return [...candidates].sort(
		(a, b) =>
			b.expectedExplanationsExcluded / b.estimatedCost - a.expectedExplanationsExcluded / a.estimatedCost ||
			b.surprise - a.surprise ||
			a.id.localeCompare(b.id),
	);
}
export type ExplanationKind = "biological" | "technical" | "sampling" | "procedural";
export interface CompetitiveExplanation {
	readonly id: string;
	readonly statement: string;
	readonly kind: ExplanationKind;
	readonly plausibility: number;
	readonly testIds: readonly string[];
}
export function generateCompetitiveExplanations(anomaly: string): readonly CompetitiveExplanation[] {
	assertValid(nonEmptyText(anomaly, 10_000), "anomaly is required");
	return [
		{
			id: "explanation-biological",
			statement: `A biological effect explains: ${anomaly}`,
			kind: "biological",
			plausibility: 0.5,
			testIds: [],
		},
		{
			id: "explanation-technical",
			statement: `A batch, parameter, contamination, or measurement issue explains: ${anomaly}`,
			kind: "technical",
			plausibility: 0.5,
			testIds: [],
		},
		{
			id: "explanation-sampling",
			statement: `Sampling variation or an unmeasured covariate explains: ${anomaly}`,
			kind: "sampling",
			plausibility: 0.5,
			testIds: [],
		},
	];
}
export function validateCompetitiveExplanations(
	explanations: readonly CompetitiveExplanation[],
): readonly string[] {
	const errors: string[] = [];
	if (explanations.length < 3) errors.push("at least three competing explanations are required");
	if (!explanations.some((item) => item.kind === "technical"))
		errors.push("a technical explanation is required");
	const ids = new Set<string>();
	for (const explanation of explanations) {
		if (!safeId(explanation.id)) errors.push(`invalid explanation id: ${explanation.id}`);
		if (ids.has(explanation.id)) errors.push(`duplicate explanation id: ${explanation.id}`);
		ids.add(explanation.id);
		if (!nonEmptyText(explanation.statement, 10_000))
			errors.push(`invalid explanation statement: ${explanation.id}`);
		if (!finiteNonNegative(explanation.plausibility) || explanation.plausibility > 1)
			errors.push(`invalid plausibility: ${explanation.id}`);
	}
	return [...new Set(errors)];
}
export interface DiscriminatingTest {
	readonly id: string;
	readonly explanationIds: readonly string[];
	readonly expectedExplanationsExcluded: number;
	readonly estimatedCost: number;
	readonly description: string;
}
export function rankDiscriminatingTests(tests: readonly DiscriminatingTest[]): readonly DiscriminatingTest[] {
	for (const test of tests) {
		assertValid(safeId(test.id), "test id is invalid");
		assertValid(test.explanationIds.length > 0, "test must target an explanation");
		assertValid(finiteNonNegative(test.expectedExplanationsExcluded), "test discrimination is invalid");
		assertValid(positiveFinite(test.estimatedCost), "test cost is invalid");
		assertValid(nonEmptyText(test.description, 10_000), "test description is invalid");
	}
	return [...tests].sort(
		(a, b) =>
			b.expectedExplanationsExcluded / b.estimatedCost - a.expectedExplanationsExcluded / a.estimatedCost ||
			a.id.localeCompare(b.id),
	);
}
export interface DiscoveryLedgerInput {
	readonly projectId: string;
	readonly questionId: string;
	readonly statement: string;
	readonly hypothesisId?: string;
	readonly prior: QuestionPrior;
	readonly posterior?: QuestionPosterior;
	readonly explanations: readonly CompetitiveExplanation[];
	readonly testsPlanned: readonly string[];
	readonly attemptId: string;
	readonly parameters?: Readonly<Record<string, string | number | boolean | null>>;
	readonly artifactIds?: readonly string[];
}
export async function recordDiscoveryToInquiry(
	port: InquiryDiscoveryPort,
	input: DiscoveryLedgerInput,
): Promise<void> {
	assertValid(safeId(input.projectId), "projectId is invalid");
	assertValid(safeId(input.questionId), "questionId is invalid");
	assertValid(safeId(input.attemptId), "attemptId is invalid");
	assertValid(nonEmptyText(input.statement, 10_000), "statement is invalid");
	validatePrior(input.prior);
	if (input.posterior) computeSurprise(input.prior, input.posterior);
	const errors = validateCompetitiveExplanations(input.explanations);
	assertValid(errors.length === 0, errors.join("; "));
	const now = new Date().toISOString();
	const question: QuestionRecord = {
		id: input.questionId,
		schemaVersion: 1,
		projectId: input.projectId,
		kind: "anomaly",
		statement: input.statement,
		prior: input.prior,
		...(input.posterior
			? { posterior: input.posterior, surprise: computeSurprise(input.prior, input.posterior) }
			: {}),
		competingExplanations: input.explanations.map((item) => `${item.kind}: ${item.statement}`),
		testsDone: [],
		testsPlanned: input.testsPlanned,
		status: "open",
		proposer: "agent",
		priority: 0.5,
		createdAt: now,
		updatedAt: now,
	};
	const attempt: AttemptRecord = {
		id: input.attemptId,
		schemaVersion: 1,
		projectId: input.projectId,
		hypothesisIds: input.hypothesisId ? [input.hypothesisId] : [],
		parameters: input.parameters ?? { discovery: stableJson({ questionId: input.questionId }) },
		artifactIds: input.artifactIds ?? [],
		outcome: "running",
		enteredReport: false,
		startedAt: now,
	};
	await port.recordQuestion(question);
	await port.recordAttempt(attempt);
}

export function criticClueId(): string {
	return randomUUID();
}
