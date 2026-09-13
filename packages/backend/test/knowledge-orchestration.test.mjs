import { describe, expect, it } from "vitest";
import {
	createSpecialistBudget,
	decideSpecialistRun,
	specialistRequestSignature,
} from "../../../.pi/lib/knowledge/orchestration-policy.mjs";

describe("knowledge orchestration policy", () => {
	it("blocks automatic evidence roles without evidence and preserves explicit delegation", () => {
		expect(decideSpecialistRun({ role: "evidence", automatic: true, hasEvidence: false }).reasonCode).toBe(
			"no-evidence",
		);
		expect(decideSpecialistRun({ role: "evidence", automatic: false, hasEvidence: false }).decision).toBe(
			"run",
		);
	});
	it("keeps manual/off authoritative and reports session exhaustion for user recovery", () => {
		expect(decideSpecialistRun({ role: "navigator", mode: "off" }).reasonCode).toBe("mode-disabled");
		expect(decideSpecialistRun({ role: "navigator", mode: "manual", automatic: true }).reasonCode).toBe(
			"mode-disabled",
		);
		expect(decideSpecialistRun({ role: "navigator", sessionRuns: 20, maxRunsPerSession: 20 }).decision).toBe(
			"ask-user",
		);
	});
	it("normalizes signatures so repeated requests are deterministic", () => {
		expect(specialistRequestSignature({ role: "evidence", task: "x", sourcePaths: ["b", "a", "a"] })).toBe(
			specialistRequestSignature({ role: "evidence", task: "x", sourcePaths: ["a", "b"] }),
		);
	});
	it("reserves before awaits, commits once, and releases cancelled reservations", () => {
		const budget = createSpecialistBudget({ maxRunsPerTurn: 2, maxRunsPerSession: 3 });
		budget.begin();
		expect(budget.reserve("a")).toBe(true);
		expect(budget.reserve("a")).toBe(false);
		budget.release("a");
		expect(budget.reserve("a")).toBe(true);
		budget.commit("a", budget.snapshot.turn);
		expect(budget.snapshot.turnRuns).toBe(1);
		expect(budget.snapshot.sessionRuns).toBe(1);
	});
	it("ignores a late completion from a replaced turn", () => {
		const budget = createSpecialistBudget();
		budget.begin();
		const oldTurn = budget.snapshot.turn;
		expect(budget.reserve("old")).toBe(true);
		budget.begin();
		expect(budget.commit("old", oldTurn)).toBe(false);
		expect(budget.snapshot.turnRuns).toBe(0);
	});
	it("does not let a late release remove a same-signature new reservation", () => {
		const budget = createSpecialistBudget();
		budget.begin();
		const oldTurn = budget.snapshot.turn;
		expect(budget.reserve("same")).toBe(true);
		budget.begin();
		expect(budget.reserve("same")).toBe(true);
		expect(budget.release("same", oldTurn)).toBe(false);
		expect(budget.snapshot.reservations).toBe(1);
	});
	it("includes summary and source fingerprints in dedupe signatures", () => {
		const a = specialistRequestSignature({
			role: "evidence",
			task: "x",
			sourcePaths: ["a"],
			sourceHashes: ["1"],
			summary: "old",
		});
		const b = specialistRequestSignature({
			role: "evidence",
			task: "x",
			sourcePaths: ["a"],
			sourceHashes: ["2"],
			summary: "new",
		});
		expect(a).not.toBe(b);
	});
});
