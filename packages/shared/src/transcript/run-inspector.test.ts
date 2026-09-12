import { describe, expect, it } from "vitest";
import { deriveRunInspectors } from "./run-inspector";
import type { UIMessage } from "./types";

const tool = (name: string, output = "{}", state: "done" | "error" = "done") => ({ key: name, id: name, name, args: name === "read" ? '{"path":"Library/Papers/a.md"}' : "{}", output, state, endedAt: 30 });

describe("deriveRunInspectors", () => {
	it("derives observable per-turn models, stages, tools, reads, artifacts, subagents and publication gate", () => {
		const messages: UIMessage[] = [
			{ kind: "user", id: "u", text: "research", images: [], timestamp: 1, skill: { name: "research-workflow" } },
			{ kind: "assistant", id: "a1", text: "", thinking: "", timestamp: 10, progress: { text: "Searching", phase: "searching" }, tools: [tool("read"), tool("research_check_answer", '{"ok":false,"reason":"source-unread"}')], usage: { id: "r1", input: 100, output: 20, cacheRead: 50, cacheWrite: 0, cost: 0.01, provider: "openai", model: "gpt-x" } },
			{ kind: "subagent", id: "s", timestamp: 20, runs: [{ key: "sr", agent: "knowledge-navigator", status: "done", model: "google/gemini", tokens: 42 }] },
			{ kind: "image", id: "i", timestamp: 21, images: [], paths: ["results/figure.png"] },
			{ kind: "error", id: "e", text: "", timestamp: 22, error: { severity: "error", source: "app", titleKey: "error.title.generic", detail: "x", actions: ["copyDetail"], timestamp: 22 } },
		];
		const [run] = deriveRunInspectors(messages);
		expect(run).toBeDefined();
		if (!run) throw new Error("missing run inspector turn");
		expect(run.models).toEqual([{ provider: "openai", model: "gpt-x", responses: 1 }]);
		expect(run.publicStages).toHaveLength(1);
		expect(run.tools.map((item) => item.name)).toEqual(["read", "research_check_answer"]);
		expect(run.sourcePaths).toContain("Library/Papers/a.md");
		expect(run.artifacts).toEqual(["results/figure.png"]);
		expect(run.subagents[0]?.agent).toBe("knowledge-navigator");
		expect(run.publication).toEqual({ status: "blocked", reason: "source-unread" });
		expect(run.skill).toBe("research-workflow");
		expect(run.errors).toBe(1);
	});

	it("never derives private thinking content into the inspector", () => {
		const messages: UIMessage[] = [
			{ kind: "user", id: "u", text: "x", images: [], timestamp: 1 },
			{ kind: "assistant", id: "a", text: "answer", thinking: "PRIVATE_CHAIN", timestamp: 2, tools: [] },
		];
		const serialized = JSON.stringify(deriveRunInspectors(messages));
		expect(serialized).not.toContain("PRIVATE_CHAIN");
	});
});
