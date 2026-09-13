import { describe, expect, it } from "vitest";
import { deriveRunInspectors } from "./run-inspector";
import type { UIMessage } from "./types";

const tool = (name: string, output = "{}", state: "done" | "error" = "done") => ({
	key: name,
	id: name,
	name,
	args: name === "read" ? '{"path":"Library/Papers/a.md"}' : "{}",
	output,
	state,
	endedAt: 30,
});

describe("deriveRunInspectors", () => {
	it("derives observable per-turn models, stages, tools, reads, artifacts, subagents and publication gate", () => {
		const messages: UIMessage[] = [
			{
				kind: "user",
				id: "u",
				text: "research",
				images: [],
				timestamp: 1,
				skill: { name: "research-workflow" },
			},
			{
				kind: "assistant",
				id: "a1",
				text: "",
				thinking: "",
				timestamp: 10,
				progress: { text: "Searching", phase: "searching" },
				tools: [tool("read"), tool("research_check_answer", '{"ok":false,"reason":"source-unread"}')],
				usage: {
					id: "r1",
					input: 100,
					output: 20,
					cacheRead: 50,
					cacheWrite: 0,
					cost: 0.01,
					provider: "openai",
					model: "gpt-x",
				},
			},
			{
				kind: "subagent",
				id: "s",
				timestamp: 20,
				runs: [
					{ key: "sr", agent: "knowledge-navigator", status: "done", model: "google/gemini", tokens: 42 },
				],
			},
			{ kind: "image", id: "i", timestamp: 21, images: [], paths: ["results/figure.png"] },
			{
				kind: "error",
				id: "e",
				text: "",
				timestamp: 22,
				error: {
					severity: "error",
					source: "app",
					titleKey: "error.title.generic",
					detail: "x",
					actions: ["copyDetail"],
					timestamp: 22,
				},
			},
		];
		const [run] = deriveRunInspectors(messages);
		expect(run).toBeDefined();
		if (!run) throw new Error("missing run inspector turn");
		expect(run.models).toEqual([{ provider: "openai", model: "gpt-x", responses: 1 }]);
		expect(run.publicStages).toHaveLength(1);
		expect(run.tools.map((item) => item.name)).toEqual(["read", "research_check_answer"]);
		expect(run?.sourcePaths).toContain("Library/Papers/a.md");
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

describe("Run Inspector reliability", () => {
	const user: UIMessage = { kind: "user", id: "user", text: "research", images: [], timestamp: 1 };
	const assistant = (
		id: string,
		tools: Extract<UIMessage, { kind: "assistant" }>["tools"],
		extra: Partial<Extract<UIMessage, { kind: "assistant" }>> = {},
	): UIMessage => ({ kind: "assistant", id, text: "", thinking: "", timestamp: 2, tools, ...extra });
	it("counts only actual read targets, not arbitrary links inside retrieved content", () => {
		const read = {
			...tool("research_read_knowledge"),
			args: '{"path":"Library/Papers/read.md"}',
			output: JSON.stringify({
				path: "Library/Papers/read.md",
				text: 'See [[Library/Papers/UNREAD.md]] and {"path":"Library/Papers/ALSO-UNREAD.md"}',
				missing: false,
			}),
		};
		const [run] = deriveRunInspectors([user, assistant("a", [read])]);
		expect(run?.sourcePaths).toEqual(["Library/Papers/read.md"]);
	});
	it("does not call missing or empty knowledge ranges actually read", () => {
		const missing = {
			...tool("research_read_knowledge"),
			output: JSON.stringify({ path: "Library/missing.md", missing: true, text: "" }),
		};
		const empty = {
			...missing,
			key: "empty",
			id: "empty",
			output: JSON.stringify({ path: "Library/empty.md", missing: false, text: "" }),
		};
		expect(deriveRunInspectors([user, assistant("a", [missing, empty])])[0]?.sourcePaths).toEqual([]);
	});
	it("deduplicates repeated response IDs and tool IDs from replay", () => {
		const usage = {
			id: "response-1",
			input: 1,
			output: 2,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			provider: "fixture",
			model: "fixture",
		};
		const messages = [
			user,
			assistant("a1", [tool("read")], { usage }),
			assistant("a2", [tool("read")], { usage }),
		];
		const [run] = deriveRunInspectors(messages);
		expect(run?.models[0]?.responses).toBe(1);
		expect(run?.tools).toHaveLength(1);
	});
	it("shows hybrid/fallback observations without fabricating evidence", () => {
		const retrieval = {
			mode: "hybrid",
			query: "中文同义词",
			lexicalCandidates: 5,
			semanticCandidates: 4,
			mergedCandidates: 7,
			elapsedMs: 12,
			fallbackReason: null,
		};
		const search = {
			...tool("research_search_knowledge"),
			output: JSON.stringify({ query: retrieval.query, hits: [{ path: "Library/UNREAD.md" }], retrieval }),
		};
		const [run] = deriveRunInspectors([user, assistant("a", [search])]);
		expect(run?.retrievals[0]).toMatchObject(retrieval);
		expect(run?.sourcePaths).toEqual([]);
	});
	it("keeps actionable failures visible and ignores private tool fields", () => {
		const failure = {
			...tool("research_delegate_knowledge"),
			output: JSON.stringify({
				status: "skipped",
				reason: "session-token-budget",
				nextAction: "Summarize current evidence",
				thinking: "PRIVATE_INTERNAL",
			}),
		};
		const [run] = deriveRunInspectors([user, assistant("a", [failure])]);
		expect(run?.diagnostics[0]).toMatchObject({
			status: "skipped",
			reason: "session-token-budget",
			nextAction: "Summarize current evidence",
		});
		expect(JSON.stringify(run?.diagnostics)).not.toContain("PRIVATE_INTERNAL");
	});
	it("reconstructs public specialist skip decisions from task-status receipts", () => {
		const status = {
			...tool("research_task_status"),
			output: JSON.stringify({
				specialists: {
					decisions: [
						{ role: "evidence", decision: "skip", reasonCode: "no-evidence", at: 10 },
						{ role: "wiki", decision: "ask-user", reasonCode: "session-budget-exhausted", at: 11 },
					],
				},
			}),
		};
		const [run] = deriveRunInspectors([user, assistant("status", [status])]);
		expect(run?.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ tool: "knowledge-evidence", status: "skipped", reason: "no-evidence" }),
				expect.objectContaining({
					tool: "knowledge-wiki",
					status: "needs-user",
					reason: "session-budget-exhausted",
				}),
			]),
		);
	});
});
