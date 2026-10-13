import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../../memory/store";
import {
	cleanMemoryText,
	estimateTokens,
	makeMemoryExtension,
	observeToolResult,
	renderMemoryBlock,
	turnTranscript,
} from "./memory";

let store: MemoryStore;
afterEach(() => store?.close());

type Tool = { name: string; execute: (...args: unknown[]) => Promise<{ details: Record<string, unknown> }> };

function session(id: string, isTrusted = true, summarize?: (t: string, m: unknown) => Promise<string>) {
	const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
	const tools: Record<string, Tool> = {};
	const pi = {
		on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) => (handlers[name] = fn),
		registerTool: (tool: Tool) => (tools[tool.name] = tool),
	};
	(
		makeMemoryExtension({ store, projectId: "p1", ...(summarize ? { summarize } : {}) }) as {
			factory: (pi: never) => void;
		}
	).factory(pi as never);
	const ctx = {
		sessionManager: { getSessionId: () => id },
		isProjectTrusted: () => isTrusted,
		model: { id: "m" },
	};
	return {
		call: (name: string, params: unknown) => tools[name]!.execute("t", params, undefined, undefined, ctx),
		prompt: (prompt: string, systemPrompt = "base") =>
			handlers.before_agent_start?.({ prompt, systemPrompt }, ctx) as { systemPrompt: string } | undefined,
		end: (messages: unknown[]) => handlers.agent_end?.({ messages }, ctx),
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

	it("captures and injects nothing in an untrusted project; tools refuse", async () => {
		store = new MemoryStore(":memory:");
		session("s1").tool({ toolCallId: "c1", toolName: "write", input: { path: "a.R" } });
		const s2 = session("s2", false);
		expect(s2.prompt("a.R")).toBeUndefined();
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
		expect(s2.prompt("差异分析")?.systemPrompt).toMatch(/\[m:\d+\]/);
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

	it("writes one redacted turn-end summary per session, trust-gated", async () => {
		store = new MemoryStore(":memory:");
		const seen: string[] = [];
		const summarize = async (t: string) => {
			seen.push(t);
			return "DESeq2 差异分析\n完成计数，下一步画火山图";
		};
		const msgs = [
			{ role: "user", content: "跑 DESeq2 <private>病人 张三</private> key sk-abcdefghijklmnop123" },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "秘密思考" },
					{ type: "text", text: "好的" },
				],
			},
			{ role: "toolResult", content: [{ type: "text", text: "原始输出" }] },
		];
		const s1 = session("s1", true, summarize);
		s1.end(msgs);
		s1.end(msgs);
		await new Promise((r) => setTimeout(r, 0));
		expect(seen[0]).not.toContain("张三");
		expect(seen[0]).not.toContain("sk-abcdefghijklmnop123");
		expect(seen[0]).not.toContain("秘密思考");
		expect(seen[0]).not.toContain("原始输出");
		const sums = store.list("p1").filter((h) => h.kind === "summary");
		expect(sums).toHaveLength(1);
		expect(sums[0]).toMatchObject({ title: "DESeq2 差异分析" });
		session("s2", false, summarize).end(msgs);
		store.setEnabled("p1", false);
		session("s3", true, summarize).end(msgs);
		await new Promise((r) => setTimeout(r, 0));
		expect(seen).toHaveLength(2);
	});

	it("summary failure never throws", async () => {
		store = new MemoryStore(":memory:");
		const s = session("s1", true, async () => {
			throw new Error("boom");
		});
		expect(() => s.end([{ role: "user", content: "hi" }])).not.toThrow();
		await new Promise((r) => setTimeout(r, 0));
		expect(turnTranscript([{ role: "user", content: "hi" }])).toBe("用户：hi");
	});
});
