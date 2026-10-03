import { describe, expect, it } from "vitest";
import {
	assertEvidenceAnswerable,
	createEvidenceGate,
	EVIDENCE_STAGES,
	type EvidenceFailure,
} from "../src/evidence-gate";

describe("evidence gate", () => {
	it("advances monotonically and only becomes answerable at the final stage", () => {
		const gate = createEvidenceGate({ scope: "fixture" });
		expect(gate.snapshot()).toMatchObject({ scope: "fixture", stage: "created", answerable: false });
		for (const stage of EVIDENCE_STAGES.slice(1)) gate.advance(stage);
		const state = gate.snapshot();
		expect(state).toMatchObject({ stage: "answerable", status: "ok", answerable: true });
		expect(state.events).toHaveLength(EVIDENCE_STAGES.length - 1);
		expect(state.events.at(-1)?.type).toBe("answerable");
	});

	it("rejects unknown and backwards transitions while retaining the current stage", () => {
		const gate = createEvidenceGate();
		gate.advance("sources_inspected");
		expect(() => gate.advance("created")).toThrow("cannot move backwards");
		expect(() => gate.advance("invalid" as never)).toThrow("Unknown evidence stage");
		expect(gate.snapshot().stage).toBe("sources_inspected");
	});

	it.each(["unavailable", "browser_required", "failed"] as EvidenceFailure[])(
		"records terminal failure %s without making the gate answerable",
		(status) => {
			const gate = createEvidenceGate();
			const failed = gate.fail(status, { reason: "fixture" });
			expect(failed).toMatchObject({ status, answerable: false, stage: "created" });
			expect(failed.events.at(-1)).toMatchObject({ type: status, reason: "fixture" });
		},
	);

	it("requires completed evidence and at least one structured claim binding", () => {
		const gate = createEvidenceGate();
		for (const stage of EVIDENCE_STAGES.slice(1)) gate.advance(stage);
		expect(() => assertEvidenceAnswerable(gate)).toThrow("Evidence gate is closed");
		expect(() => assertEvidenceAnswerable(gate, { claimBindings: ["claim-1"] })).toThrow(
			"structured claim binding",
		);
		expect(assertEvidenceAnswerable(gate, { claimBindings: [{ claim: "claim-1" }] }).stage).toBe("answerable");
	});
});
