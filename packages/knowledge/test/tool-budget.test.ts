import { describe, expect, it } from "vitest";
import { createToolBudget } from "../src/tool-budget";

describe("knowledge tool budget", () => {
	it("bounds reads, searches and repeated calls while allowing two recoveries", () => {
		const budget = createToolBudget({ maxReads: 2, maxSearches: 1, maxRepeats: 1 });
		expect(budget.consume("read", "a")).toBeNull();
		expect(budget.consume("read", "a")?.code).toBe("tool-loop");
		budget.reset();
		expect(budget.consume("read", "a", { recovery: true })).toBeNull();
		expect(budget.consume("read", "b", { recovery: true })).toBeNull();
		expect(budget.consume("search", "q")).toBeNull();
		expect(budget.consume("search", "other")?.status).toBe("budget-exhausted");
	});
});
