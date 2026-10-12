import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../../memory/store";
import {
	cleanMemoryText,
	estimateTokens,
	makeMemoryExtension,
	observeToolResult,
	renderMemoryBlock,
} from "./memory";

let store: MemoryStore;
afterEach(() => store?.close());

function session(id: string) {
	const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
	const pi = { on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) => (handlers[name] = fn) };
	(makeMemoryExtension({ store, projectId: "p1" }) as { factory: (pi: never) => void }).factory(pi as never);
	const ctx = { sessionManager: { getSessionId: () => id } };
	return {
		prompt: (prompt: string, systemPrompt = "base") =>
			handlers.before_agent_start?.({ prompt, systemPrompt }, ctx) as { systemPrompt: string } | undefined,
		tool: (event: Record<string, unknown>) =>
			handlers.tool_result?.({ input: {}, content: [], isError: false, ...event }, ctx),
	};
}

describe("memory capture rules", () => {
	it("strips <private> and redacts secrets before storage", () => {
		const text = cleanMemoryText("用 key sk-abcdefghijklmnop123 <private>病人姓名 张三</private> 跑", 200);
		expect(text).not.toContain("张三");
		expect(text).not.toContain("sk-abcdefghijklmnop123");
	});

	it("records changed files, commands and failures but not other tools", () => {
		const base = { toolCallId: "c1", input: {}, content: [] };
		expect(observeToolResult({ ...base, toolName: "write", input: { path: "a.R" } })?.title).toBe("修改 a.R");
		expect(
			observeToolResult({
				...base,
				toolName: "bash",
				input: { command: "Rscript a.R" },
				content: [{ type: "text", text: "ok\ndone" }],
			}),
		).toMatchObject({ kind: "command", title: "Rscript a.R", body: "ok done" });
		expect(
			observeToolResult({
				...base,
				toolName: "read",
				isError: true,
				content: [{ type: "text", text: "ENOENT" }],
			}),
		).toMatchObject({ kind: "error", body: "ENOENT" });
		expect(observeToolResult({ ...base, toolName: "read", input: { path: "a.R" } })).toBeNull();
	});

	it("keeps the injected block within the token budget", () => {
		const hits = Array.from({ length: 50 }, (_, i) => ({
			id: i,
			kind: "change" as const,
			title: `修改了一个很长的分析脚本文件名称第${i}号`,
			body: "",
			createdAt: 0,
		}));
		const block = renderMemoryBlock(hits);
		expect(block.count).toBeGreaterThan(0);
		expect(block.count).toBeLessThan(50);
		expect(estimateTokens(block.text)).toBeLessThanOrEqual(600);
		expect(renderMemoryBlock([])).toEqual({ text: "", count: 0 });
	});
});

describe("memory extension", () => {
	it("captures in one session and injects into the next, stable across turns", () => {
		store = new MemoryStore(":memory:");
		const first = session("s1");
		expect(first.prompt("做差异表达分析")).toBeUndefined();
		first.tool({ toolCallId: "c1", toolName: "write", input: { path: "deseq2.R" } });

		const next = session("s2");
		const turn1 = next.prompt("继续差异表达");
		expect(turn1?.systemPrompt).toContain("修改 deseq2.R");
		expect(turn1?.systemPrompt.startsWith("base\n\n# 相关记忆")).toBe(true);
		expect(store.status("p1").lastLoaded).toBeGreaterThan(0);
		expect(next.prompt("下一步", "base")?.systemPrompt).toBe(turn1?.systemPrompt);
	});

	it("injects nothing and captures nothing when the project is off", () => {
		store = new MemoryStore(":memory:");
		session("s1").tool({ toolCallId: "c1", toolName: "write", input: { path: "a.R" } });
		store.setEnabled("p1", false);
		const s2 = session("s2");
		expect(s2.prompt("a.R")).toBeUndefined();
		s2.tool({ toolCallId: "c2", toolName: "write", input: { path: "b.R" } });
		expect(store.status("p1")).toMatchObject({ count: 1, lastLoaded: 0 });
	});

	it("never breaks the session when storage fails", () => {
		store = new MemoryStore(":memory:");
		const s = session("s1");
		store.close();
		expect(() => s.tool({ toolCallId: "c1", toolName: "write", input: { path: "a.R" } })).not.toThrow();
		expect(s.prompt("hi")).toBeUndefined();
		store = new MemoryStore(":memory:");
	});
});
