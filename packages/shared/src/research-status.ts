/**
 * Cross-package status vocabulary for the scientific workbench.
 *
 * Evidence status describes what was observed and validated. Claim status
 * describes how far a statement may be interpreted. They are deliberately
 * separate: a validated capability can still only support an inferred claim,
 * and a successful run is never scientific verification by itself.
 */

export const RESEARCH_EVIDENCE_STATES = Object.freeze([
	"observed",
	"reproduced",
	"verified",
	"partial",
	"stale",
	"unsupported",
	"unknown",
	"blocked",
] as const);

export type ResearchEvidenceState = (typeof RESEARCH_EVIDENCE_STATES)[number];

export const RESEARCH_CLAIM_STATES = Object.freeze([
	"supported",
	"mixed",
	"inferred",
	"hypothesis",
	"unsupported",
] as const);

export type ResearchClaimState = (typeof RESEARCH_CLAIM_STATES)[number];

export const RESEARCH_VALIDATION_SCOPES = Object.freeze([
	"fixture",
	"integration",
	"real-data",
	"scientific-review",
] as const);

export type ResearchValidationScope = (typeof RESEARCH_VALIDATION_SCOPES)[number];

export const RESEARCH_FRESHNESS_STATES = Object.freeze(["fresh", "stale", "unknown"] as const);
export type ResearchFreshnessState = (typeof RESEARCH_FRESHNESS_STATES)[number];

export interface ResearchStatus {
	readonly evidenceState: ResearchEvidenceState;
	readonly claimState: ResearchClaimState;
	readonly validationScope: ResearchValidationScope;
	readonly freshness: ResearchFreshnessState;
	readonly scientificallyVerified: boolean;
}

export interface ResearchStatusInput extends Omit<ResearchStatus, "scientificallyVerified"> {
	readonly scientificallyVerified?: boolean;
}

const GREEN_EVIDENCE = new Set<ResearchEvidenceState>(["verified", "reproduced"]);
const BLOCKED_EVIDENCE = new Set<ResearchEvidenceState>([
	"partial",
	"stale",
	"unsupported",
	"unknown",
	"blocked",
]);

function includes<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
	return typeof value === "string" && values.includes(value);
}

/** A fresh, verified/reproduced evidence state may be shown as green. */
export function isResearchEvidenceGreen(
	status: Pick<ResearchStatus, "evidenceState" | "freshness">,
): boolean {
	return GREEN_EVIDENCE.has(status.evidenceState) && status.freshness === "fresh";
}

/**
 * A scientific claim needs an explicit scientific-review scope and an
 * explicit human/host verification marker in addition to fresh evidence.
 */
export function isScientificClaimGreen(status: ResearchStatus): boolean {
	return (
		isResearchEvidenceGreen(status) &&
		status.claimState === "supported" &&
		status.validationScope === "scientific-review" &&
		status.scientificallyVerified === true
	);
}

/**
 * Validate the red-line combinations before a status is persisted or rendered.
 * In particular, unknown/partial/stale/unsupported/blocked can never be green.
 */
export function assertResearchStatus(status: ResearchStatus): void {
	if (!status || typeof status !== "object") throw new Error("Research status is required");
	if (!includes(RESEARCH_EVIDENCE_STATES, status.evidenceState))
		throw new Error("Invalid research evidence state");
	if (!includes(RESEARCH_CLAIM_STATES, status.claimState)) throw new Error("Invalid research claim state");
	if (!includes(RESEARCH_VALIDATION_SCOPES, status.validationScope))
		throw new Error("Invalid research validation scope");
	if (!includes(RESEARCH_FRESHNESS_STATES, status.freshness))
		throw new Error("Invalid research freshness state");
	if (typeof status.scientificallyVerified !== "boolean")
		throw new Error("scientificallyVerified must be boolean");
	if (BLOCKED_EVIDENCE.has(status.evidenceState) && isResearchEvidenceGreen(status))
		throw new Error("Blocked or incomplete evidence cannot be green");
	if (status.scientificallyVerified && !isScientificClaimGreen(status))
		throw new Error("Scientific verification requires fresh supported evidence and scientific-review scope");
}

/**
 * Derive the conservative status for a validation capsule. A capsule can
 * prove capability validation, but defaults to an inferred claim and fixture
 * scope until a later phase supplies real-data and scientific review evidence.
 */
export function statusForValidationCapsule(input: {
	readonly status: "validated" | "failed" | "incomplete";
	readonly validationScope?: ResearchValidationScope;
	readonly freshness?: ResearchFreshnessState;
}): ResearchStatus {
	const evidenceState: ResearchEvidenceState =
		input.status === "validated" ? "verified" : input.status === "incomplete" ? "partial" : "blocked";
	const result: ResearchStatus = {
		evidenceState,
		claimState: input.status === "validated" ? "inferred" : "unsupported",
		validationScope: input.validationScope ?? "fixture",
		freshness: input.freshness ?? "fresh",
		scientificallyVerified: false,
	};
	assertResearchStatus(result);
	return result;
}
