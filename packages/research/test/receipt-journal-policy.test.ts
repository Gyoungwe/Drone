import { describe, expect, it } from "vitest";
import {
	CORE_RESEARCH_RECEIPT_TOOLS,
	ReceiptJournalBuffer,
	receiptBelongsToRun,
	shouldRecordResearchReceipt,
} from "../src/receipt-journal-policy";

describe("receipt journal policy", () => {
	it("admits core tools and declared extension tools", () => {
		expect(CORE_RESEARCH_RECEIPT_TOOLS).toContain("research_read_knowledge");
		expect(shouldRecordResearchReceipt({ toolName: "bash", isError: true })).toBe(true);
		expect(shouldRecordResearchReceipt({ toolName: "custom", isError: true }, () => true)).toBe(false);
		expect(shouldRecordResearchReceipt({ toolName: "custom" }, (name) => name === "custom")).toBe(true);
		expect(shouldRecordResearchReceipt({ toolName: "custom", isError: true })).toBe(false);
	});

	it("deduplicates tool calls and evicts the oldest bounded entry", () => {
		const buffer = new ReceiptJournalBuffer<{ toolCallId?: string }>({ capacity: 2 });
		expect(buffer.add({ toolCallId: "a" })).toBe(true);
		expect(buffer.add({ toolCallId: "a" })).toBe(false);
		expect(buffer.add({ toolCallId: "b" })).toBe(true);
		expect(buffer.add({ toolCallId: "c" })).toBe(true);
		expect(buffer.values()).toEqual([{ toolCallId: "b" }, { toolCallId: "c" }]);
		expect(buffer.add({ toolCallId: "a" })).toBe(false);
		expect(buffer.snapshot()).toEqual({
			scope: "current-session-current-turn",
			buffered: 2,
			evicted: 1,
		});
	});

	it("matches optional run ownership using the session cwd", () => {
		const cwd = "/tmp/drone-project";
		expect(receiptBelongsToRun({ args: {} }, cwd, "results/fixture/run-1")).toBe(true);
		expect(
			receiptBelongsToRun({ args: { run_dir: "results/fixture/run-1" } }, cwd, "results/fixture/run-1"),
		).toBe(true);
		expect(
			receiptBelongsToRun({ details: { run_dir: "results/fixture/run-2" } }, cwd, "results/fixture/run-1"),
		).toBe(false);
	});

	it("rejects invalid capacities", () => {
		expect(() => new ReceiptJournalBuffer({ capacity: 0 })).toThrow("positive integer");
	});
});
