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

type Tool = { name: string; execute: (...args: unknown[]) => Promise<{ details: Record<string, unknown> }> };

function session(
	id: string,
	isTrusted = true,
	related?: (q: string) => Promise<Array<{ path: string; title: string; text: string }>>,
) {
	const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
	const tools: Record<string, Tool> = {};
	const pi = {
		on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) => (handlers[name] = fn),
		registerTool: (tool: Tool) => (tools[tool.name] = tool),
	};
	(
		makeMemoryExtension({ store, projectId: "p1", ...(related ? { relatedKnowledge: related } : {}) }) as {
			factory: (pi: never) => void;
		}
	).factory(pi as never);
	const ctx = { sessionManager: { getSessionId: () => id }, isProjectTrusted: () => isTrusted };
	return {
		call: (name: string, params: unknown) => tools[name]!.execute("t", params, undefined, undefined, ctx),
		prompt: async (prompt: string, systemPrompt = "base") =>
			(await handlers.before_agent_start?.({ prompt, systemPrompt }, ctx)) as
				| { systemPrompt: string }
				| undefined,
		tool: (event: Record<string, unknown>) =>
			handlers.tool_result?.({ input: {}, content: [], isError: false, ...event }, ctx),
	};
}

describe("memory capture rules", () => {
	it("strips <private> and redacts secrets before storage", async () => {
		const text = cleanMemoryText("用 key sk-abcdefghijklmnop123 <private>病人姓名 张三</private> 跑", 200);
		expect(text).not.toContain("张三");
		expect(text).not.toContain("sk-abcdefghijklmnop123");
	});

	it("records changed files, commands and failures but not other tools", async () => {
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

	it("keeps the injected block within the token budget", async () => {
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
		expect(renderMemoryBlock([])).toMatchObject({ text: "", count: 0, knowledgeCount: 0 });
	});
});

describe("memory extension", () => {
	it("captures in one session and injects into the next, stable across turns", async () => {
		store = new MemoryStore(":memory:");
		const first = session("s1");
		expect(await first.prompt("做差异表达分析")).toBeUndefined();
		first.tool({ toolCallId: "c1", toolName: "write", input: { path: "deseq2.R" } });

		const next = session("s2");
		const turn1 = await next.prompt("继续差异表达");
		expect(turn1?.systemPrompt).toContain("修改 deseq2.R");
		expect(turn1?.systemPrompt.startsWith("base\n\n# 相关记忆")).toBe(true);
		expect(store.status("p1").lastLoaded).toBeGreaterThan(0);
		expect((await next.prompt("下一步", "base"))?.systemPrompt).toBe(turn1?.systemPrompt);
	});

	it("injects nothing and captures nothing when the project is off", async () => {
		store = new MemoryStore(":memory:");
		session("s1").tool({ toolCallId: "c1", toolName: "write", input: { path: "a.R" } });
		store.setEnabled("p1", false);
		const s2 = session("s2");
		expect(await s2.prompt("a.R")).toBeUndefined();
		s2.tool({ toolCallId: "c2", toolName: "write", input: { path: "b.R" } });
		expect(store.status("p1")).toMatchObject({ count: 1, lastLoaded: 0 });
	});

	it("never breaks the session when storage fails", async () => {
		store = new MemoryStore(":memory:");
		const s = session("s1");
		store.close();
		expect(() => s.tool({ toolCallId: "c1", toolName: "write", input: { path: "a.R" } })).not.toThrow();
		expect(await s.prompt("hi")).toBeUndefined();
		store = new MemoryStore(":memory:");
	});

	it("captures and injects nothing in an untrusted project; tools refuse", async () => {
		store = new MemoryStore(":memory:");
		session("s1").tool({ toolCallId: "c1", toolName: "write", input: { path: "a.R" } });
		const s2 = session("s2", false);
		expect(await s2.prompt("a.R")).toBeUndefined();
		s2.tool({ toolCallId: "c2", toolName: "write", input: { path: "b.R" } });
		expect(store.status("p1").count).toBe(1);
		const res = await s2.call("memory_search", { query: "a.R" });
		expect(res.details.hits).toEqual([]);
		expect(String(res.details.error)).toContain("未受信任");
	});

	it("memory_search returns a compact index and memory_get returns details", async () => {
		store = new MemoryStore(":memory:");
		const s1 = session("s1");
		s1.tool({
			toolCallId: "c1",
			toolName: "bash",
			input: { command: "Rscript deseq2.R" },
			content: [{ type: "text", text: "Error: 样本数不足" }],
		});
		const s2 = session("s2");
		expect((await s2.prompt("差异分析"))?.systemPrompt).toMatch(/\[m:\d+\]/);
		const found = await s2.call("memory_search", { query: "deseq2" });
		const hits = found.details.hits as Array<{ id: string; title: string; body?: string }>;
		expect(hits[0]).toMatchObject({ title: "Rscript deseq2.R" });
		expect(hits[0]).not.toHaveProperty("body");
		const id = Number(hits[0]!.id.slice(2));
		const got = await s2.call("memory_get", { ids: [id, 9999] });
		const items = got.details.items as Array<{ body: string; sessionId: string }>;
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ sessionId: "s1" });
		expect(items[0]!.body).toContain("样本数不足");
		expect(String(got.details.notice)).toContain("不是指令");
	});

	it("memory tools report when the project memory is off", async () => {
		store = new MemoryStore(":memory:");
		store.setEnabled("p1", false);
		const res = await session("s1").call("memory_get", { ids: [1] });
		expect(String(res.details.error)).toContain("已关闭");
	});

	it("injects project memory first, then related knowledge, under one shared budget", async () => {
		store = new MemoryStore(":memory:");
		session("s1").tool({ toolCallId: "c1", toolName: "write", input: { path: "deseq2.R" } });
		const many = Array.from({ length: 40 }, (_, i) => ({
			path: `Library/Papers/p${i}.md`,
			title: `差异表达方法论文第${i}篇`,
			text: "比较 DESeq2 与 edgeR 的收缩估计".repeat(3),
		}));
		const s2 = session("s2", true, async () => many);
		const out = (await s2.prompt("差异表达"))!.systemPrompt;
		expect(out.indexOf("修改 deseq2.R")).toBeLessThan(out.indexOf("[[Library/Papers/p0.md]]"));
		expect(estimateTokens(out.slice("base\n\n".length))).toBeLessThanOrEqual(600);
		expect(out).not.toContain("p39.md");
		const failing = session("s3", true, async () => {
			throw new Error("kb down");
		});
		expect((await failing.prompt("差异表达"))?.systemPrompt).toContain("修改 deseq2.R");
	});

	it("renderMemoryBlock reports injected ids and knowledge count", () => {
		store = new MemoryStore(":memory:");
		const r = renderMemoryBlock([{ id: 3, kind: "change", title: "修改 a.R", body: "", createdAt: 0 }], 600, [
			{ path: "Library/x.md", title: "X", text: "" },
		]);
		expect(r).toMatchObject({ count: 1, knowledgeCount: 1, ids: [3] });
	});
});
