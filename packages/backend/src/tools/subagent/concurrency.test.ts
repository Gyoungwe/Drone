import { describe, expect, it } from "vitest";
import { maxParallelSubagents } from "../agent-mode";
import { resolveSubagentConcurrency } from "./tool";

describe("H1 subagent concurrency follows agent mode", () => {
	it("uses mode limits", () => {
		expect(resolveSubagentConcurrency(maxParallelSubagents("lead"))).toBe(1);
		expect(resolveSubagentConcurrency(maxParallelSubagents("swarm"))).toBe(4);
		expect(resolveSubagentConcurrency(maxParallelSubagents("single"))).toBe(1);
	});
	it("falls back to 3 and clamps", () => {
		expect(resolveSubagentConcurrency(undefined)).toBe(3);
		expect(resolveSubagentConcurrency(99)).toBe(8);
		expect(resolveSubagentConcurrency(Number.NaN)).toBe(3);
	});
});
