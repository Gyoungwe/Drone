import { describe, expect, it } from "vitest";
import {
	filterToolsForMode,
	isAgentMode,
	maxParallelSubagents,
	modeToolDiff,
	toolAllowedInMode,
} from "./agent-mode";

describe("agent mode tool whitelist (P12)", () => {
	const tools = ["read", "bash", "subagent"];
	it("single mode forbids subagent", () => {
		expect(filterToolsForMode("single", tools)).toEqual(["read", "bash"]);
		expect(toolAllowedInMode("single", "subagent")).toBe(false);
	});
	it("lead and swarm allow subagent with different parallelism", () => {
		expect(filterToolsForMode("lead", tools)).toEqual(tools);
		expect(filterToolsForMode("swarm", tools)).toEqual(tools);
		expect([
			maxParallelSubagents("single"),
			maxParallelSubagents("lead"),
			maxParallelSubagents("swarm"),
		]).toEqual([0, 1, 4]);
	});
	it("diffs tools between modes", () => {
		expect(modeToolDiff("single", "swarm", tools)).toEqual({ added: ["subagent"], removed: [] });
		expect(modeToolDiff("lead", "single", tools)).toEqual({ added: [], removed: ["subagent"] });
	});
	it("validates mode strings", () => {
		expect(isAgentMode("lead")).toBe(true);
		expect(isAgentMode("team")).toBe(false);
	});
});
