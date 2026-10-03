/**
 * Pure evidence-gate state machine.
 *
 * The host owns persistence and tool orchestration; this module only enforces
 * the monotonic stages required before a research answer can be published.
 */

export const EVIDENCE_STAGES = Object.freeze([
	"created",
	"local_query_recorded",
	"external_search_recorded",
	"sources_inspected",
	"sources_archived",
	"claims_bound",
	"answerable",
] as const);

export type EvidenceStage = (typeof EVIDENCE_STAGES)[number];
export type EvidenceFailure = "unavailable" | "browser_required" | "failed";

export interface EvidenceEvent {
	type: EvidenceStage | EvidenceFailure;
	at: string;
	[key: string]: unknown;
}

export interface EvidenceGateState {
	scope: string;
	stage: EvidenceStage;
	status: "ok";
	answerable: boolean;
	events: EvidenceEvent[];
}

export interface EvidenceGateFailureState {
	scope: string;
	stage: EvidenceStage;
	status: EvidenceFailure;
	answerable: false;
	events: EvidenceEvent[];
}

export interface EvidenceGate {
	advance(next: EvidenceStage, details?: Record<string, unknown>): EvidenceGateState;
	fail(status: EvidenceFailure, details?: Record<string, unknown>): EvidenceGateFailureState;
	snapshot(): EvidenceGateState;
}

const TERMINAL_FAILURES = new Set<EvidenceFailure>(["unavailable", "browser_required", "failed"]);

export function createEvidenceGate({ scope = "factual-answer" }: { scope?: string } = {}): EvidenceGate {
	const events: EvidenceEvent[] = [];
	let stage: EvidenceStage = "created";
	const record = (type: EvidenceEvent["type"], details: Record<string, unknown> = {}): void => {
		events.push({ type, at: new Date().toISOString(), ...details });
	};
	const snapshot = (): EvidenceGateState => ({
		scope,
		stage,
		status: "ok",
		answerable: stage === "answerable",
		events: [...events],
	});
	const advance = (next: EvidenceStage, details: Record<string, unknown> = {}): EvidenceGateState => {
		if (!EVIDENCE_STAGES.includes(next)) throw new Error(`Unknown evidence stage: ${next}`);
		const current = EVIDENCE_STAGES.indexOf(stage);
		const target = EVIDENCE_STAGES.indexOf(next);
		if (target < current) throw new Error(`Evidence stage cannot move backwards: ${stage} -> ${next}`);
		stage = next;
		record(next, details);
		return snapshot();
	};
	const fail = (status: EvidenceFailure, details: Record<string, unknown> = {}): EvidenceGateFailureState => {
		if (!TERMINAL_FAILURES.has(status)) throw new Error(`Unknown evidence failure: ${status}`);
		record(status, details);
		return { ...snapshot(), status, answerable: false };
	};
	return Object.freeze({ advance, fail, snapshot });
}

export function assertEvidenceAnswerable(
	gate: Pick<EvidenceGate, "snapshot">,
	{ claimBindings = [] }: { claimBindings?: unknown[] } = {},
): EvidenceGateState {
	const state = gate.snapshot();
	if (
		state.stage !== "answerable" ||
		!Array.isArray(claimBindings) ||
		claimBindings.length === 0 ||
		claimBindings.some((binding) => !binding || typeof binding !== "object" || Array.isArray(binding))
	) {
		throw new Error(
			"Evidence gate is closed: complete retrieval, inspection, archiving and structured claim binding first",
		);
	}
	return state;
}
