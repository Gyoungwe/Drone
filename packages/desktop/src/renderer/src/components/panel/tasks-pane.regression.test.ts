import { describe, expect, it } from "vitest";
import { stableEmptyConfirmedIds, stableEmptyDecisions } from "./decision-projection";

describe("session replacement panel projections", () => {
	it("keeps repeated empty resets referentially stable", () => {
		const decisions: never[] = [];
		const confirmed = new Set<string>();
		expect(stableEmptyDecisions(decisions)).toBe(decisions);
		expect(stableEmptyDecisions(stableEmptyDecisions(decisions))).toBe(decisions);
		expect(stableEmptyConfirmedIds(confirmed)).toBe(confirmed);
		expect(stableEmptyConfirmedIds(stableEmptyConfirmedIds(confirmed))).toBe(confirmed);
	});

	it("drops old session projections once without creating a new empty reference", () => {
		expect(stableEmptyDecisions([{ id: "old" } as never])).toHaveLength(0);
		expect(stableEmptyConfirmedIds(new Set(["old"]))).toHaveLength(0);
	});
});
