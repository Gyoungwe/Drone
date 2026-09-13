import { describe, expect, it } from "vitest";
import { createToolBudget } from "../../../.pi/lib/knowledge/tool-budget.mjs";

describe("knowledge tool-budget", () => {
	it("allows reads and searches up to the default caps", () => {
		const budget = createToolBudget();
		for (let i = 0; i < 8; i++) expect(budget.consume("read", `p${i}`)).toBeNull();
		for (let i = 0; i < 4; i++) expect(budget.consume("search", `q${i}`)).toBeNull();
		expect(budget.snapshot()).toEqual({ reads: 8, searches: 4 });
	});

	it("blocks the 9th distinct read and 5th distinct search as tool-loop", () => {
		const budget = createToolBudget();
		for (let i = 0; i < 8; i++) budget.consume("read", `p${i}`);
		const blockedRead = budget.consume("read", "p-overflow");
		expect(blockedRead).toMatchObject({ status: "budget-exhausted", code: "tool-loop" });
		expect(blockedRead.next).toMatch(/Do not call research_read_knowledge/);

		const other = createToolBudget();
		for (let i = 0; i < 4; i++) other.consume("search", `q${i}`);
		const blockedSearch = other.consume("search", "q-overflow");
		expect(blockedSearch).toMatchObject({ status: "budget-exhausted", code: "tool-loop" });
	});

	it("blocks the 3rd repeat of the same path or query", () => {
		const budget = createToolBudget();
		expect(budget.consume("read", "Wiki/a.md")).toBeNull();
		expect(budget.consume("read", "Wiki/a.md")).toBeNull();
		const blocked = budget.consume("read", "Wiki/a.md");
		expect(blocked).toMatchObject({ status: "budget-exhausted", code: "tool-loop" });
		expect(blocked.message).toMatch(/Repeated read/);
	});

	it("reset clears counts so a new turn can search and read again", () => {
		const budget = createToolBudget();
		for (let i = 0; i < 8; i++) budget.consume("read", `p${i}`);
		expect(budget.consume("read", "extra")).not.toBeNull();
		budget.reset();
		expect(budget.consume("read", "extra")).toBeNull();
		expect(budget.snapshot()).toEqual({ reads: 1, searches: 0 });
	});
});
