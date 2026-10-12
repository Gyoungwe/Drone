import { describe, expect, it } from "vitest";
import { applySkillBudget, estimateTokens, skillListingBudget, truncateDescription } from "./skill-budget";

const entry = (name: string, chars: number, pinned = false) => ({
	name,
	description: "x".repeat(chars),
	pinned,
});

describe("skill listing budget (P12)", () => {
	it("is 8% of the context window", () => {
		expect(skillListingBudget(200_000)).toBe(16_000);
		expect(skillListingBudget(undefined)).toBe(10_240);
	});
	it("estimates CJK and latin text", () => {
		expect(estimateTokens("abcd")).toBe(1);
		expect(estimateTokens("差异分析")).toBe(4);
	});
	it("truncates long descriptions", () => {
		expect(truncateDescription("a".repeat(300))).toHaveLength(250);
	});
	it("keeps entries in priority order until the budget is spent, always keeping pinned ones", () => {
		// 每条 ≈ 24 + 1 + 63 = 88 token；窗口 1000 → 预算 80
		const entries = [entry("a", 250), entry("b", 250), entry("p", 250, true)];
		const r = applySkillBudget(entries, 1000);
		expect(r.budgetTokens).toBe(80);
		expect(r.kept).toEqual(["p"]);
		expect(r.dropped).toEqual(["a", "b"]);
		const big = applySkillBudget(entries, 10_000);
		expect(big.kept).toEqual(["a", "b", "p"]);
		expect(big.usedTokens).toBeLessThanOrEqual(big.budgetTokens);
	});
});
