import { describe, expect, it } from "vitest";
import {
	createSpecialistBudget,
	decideSpecialistRun,
	specialistRequestSignature,
} from "../src/orchestration-policy";

describe("orchestration policy", () => {
	it("keeps request signatures deterministic", () => {
		expect(specialistRequestSignature({ role: "evidence", task: "x", sourcePaths: ["b", "a", "a"] })).toBe(
			specialistRequestSignature({ role: "evidence", task: "x", sourcePaths: ["a", "b"] }),
		);
	});

	it("applies permission, evidence, and queue gates", () => {
		expect(decideSpecialistRun({ role: "evidence", automatic: true, hasEvidence: false }).reasonCode).toBe(
			"no-evidence",
		);
		expect(decideSpecialistRun({ role: "navigator", trusted: false }).decision).toBe("skip");
		expect(
			decideSpecialistRun({ role: "navigator", active: 2, concurrency: 2, queueLength: 8 }).decision,
		).toBe("wait");
	});

	it("bounds reservations and usage by turn", () => {
		const budget = createSpecialistBudget({ maxRunsPerTurn: 2, maxRunsPerSession: 3 });
		budget.begin();
		expect(budget.reserve("a")).toBe(true);
		expect(budget.commit("a")).toBe(true);
		expect(budget.reserve("a")).toBe(false);
		expect(budget.reserve("b")).toBe(true);
		expect(budget.commit("b")).toBe(true);
		expect(budget.reserve("c")).toBe(false);
		expect(budget.snapshot.turnRuns).toBe(2);
	});
});
