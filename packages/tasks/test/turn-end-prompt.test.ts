import { describe, expect, it } from "vitest";
import { shouldAskToContinue, type TaskContinuationState } from "../src/index";

const authorized = (overrides: Partial<TaskContinuationState> = {}): TaskContinuationState => ({
	executionConsent: { version: 1 },
	state: "waiting_user",
	milestones: [{ state: "pending" }],
	progressCount: 2,
	lastResumeProgress: 1,
	...overrides,
});

describe("task continuation prompt policy", () => {
	it("offers continuation only after authorized progress", () => {
		expect(shouldAskToContinue(authorized())).toBe(true);
		expect(shouldAskToContinue(authorized({ executionConsent: undefined }))).toBe(false);
		expect(shouldAskToContinue(authorized({ progressCount: 1 }))).toBe(false);
	});

	it("does not compete with terminal tasks or pending user actions", () => {
		expect(shouldAskToContinue(authorized({ state: "completed" }))).toBe(false);
		expect(shouldAskToContinue(authorized({ actions: [{ state: "pending" }] }))).toBe(false);
		expect(shouldAskToContinue(authorized({ milestones: [] }))).toBe(false);
	});

	it("stops at the automatic continuation budget", () => {
		expect(shouldAskToContinue(authorized({ budget: { autoResumes: 3 } }))).toBe(false);
	});
});
