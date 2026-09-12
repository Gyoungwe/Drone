export const EVIDENCE_STAGES = Object.freeze([
	"created",
	"local_query_recorded",
	"external_search_recorded",
	"sources_inspected",
	"sources_archived",
	"claims_bound",
	"answerable",
]);

const TERMINAL_FAILURES = new Set(["unavailable", "browser_required", "failed"]);

export function createEvidenceGate({ scope = "factual-answer" } = {}) {
	const events = [];
	let stage = "created";
	const record = (type, details = {}) => {
		events.push({ type, at: new Date().toISOString(), ...details });
	};
	const advance = (next, details = {}) => {
		if (!EVIDENCE_STAGES.includes(next)) throw new Error(`Unknown evidence stage: ${next}`);
		const current = EVIDENCE_STAGES.indexOf(stage);
		const target = EVIDENCE_STAGES.indexOf(next);
		if (target < current) throw new Error(`Evidence stage cannot move backwards: ${stage} -> ${next}`);
		stage = next;
		record(next, details);
		return snapshot();
	};
	const fail = (status, details = {}) => {
		if (!TERMINAL_FAILURES.has(status)) throw new Error(`Unknown evidence failure: ${status}`);
		record(status, details);
		return { ...snapshot(), status, answerable: false };
	};
	const snapshot = () => ({
		scope,
		stage,
		status: "ok",
		answerable: stage === "answerable",
		events: [...events],
	});
	return Object.freeze({ advance, fail, snapshot });
}

export function assertEvidenceAnswerable(gate, { claimRefs = [] } = {}) {
	const state = gate.snapshot();
	if (state.stage !== "answerable" || !Array.isArray(claimRefs) || claimRefs.length === 0) {
		throw new Error(
			"Evidence gate is closed: complete retrieval, inspection, archiving and claim binding first",
		);
	}
	return state;
}
