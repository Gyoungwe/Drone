import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectKnowledgeEvent, projectKnowledgeSnapshot } from "../src/session/knowledge-publication";

// 覆盖 bridge 缺失时的兜底投影（此前无测试，最易随扩展演进而漂移）。
type E = Parameters<typeof projectKnowledgeEvent>[0];
type M = Parameters<typeof projectKnowledgeSnapshot>[0][number];
const ev = (o: unknown): E => o as E;
const KEY = Symbol.for("percho.knowledge.publication.v1");
const NOTICE = "发布检查未加载";

describe("knowledge-publication fallback（bridge 缺失）", () => {
	const prevDir = process.env.PERCHO_KNOWLEDGE_DIR;
	const prevBridge = (globalThis as Record<symbol, unknown>)[KEY];
	beforeEach(() => {
		process.env.PERCHO_KNOWLEDGE_DIR = "/tmp/vault";
		delete (globalThis as Record<symbol, unknown>)[KEY];
	});
	afterEach(() => {
		if (prevDir === undefined) delete process.env.PERCHO_KNOWLEDGE_DIR;
		else process.env.PERCHO_KNOWLEDGE_DIR = prevDir;
		if (prevBridge === undefined) delete (globalThis as Record<symbol, unknown>)[KEY];
		else (globalThis as Record<symbol, unknown>)[KEY] = prevBridge;
	});

	it("PERCHO_KNOWLEDGE_DIR 未设时原样透传", () => {
		delete process.env.PERCHO_KNOWLEDGE_DIR;
		const e = ev({
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "draft" }] },
		});
		expect(projectKnowledgeEvent(e)).toBe(e);
	});

	it("丢弃流式增量", () => {
		expect(
			projectKnowledgeEvent(
				ev({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x" } }),
			),
		).toBeNull();
	});

	it("message_start：清空 assistant 内容（不提前显示提示）", () => {
		const out = projectKnowledgeEvent(
			ev({
				type: "message_start",
				message: { role: "assistant", content: [{ type: "text", text: "draft" }] },
			}),
		) as { message: { content: unknown[] } };
		expect(out.message.content).toEqual([]);
	});

	it("message_end：原地封条化（SDK 按引用落盘）", () => {
		const message = { role: "assistant", content: [{ type: "text", text: "secret draft" }], timestamp: 1 };
		const out = projectKnowledgeEvent(ev({ type: "message_end", message })) as { message: unknown };
		expect(JSON.stringify(message)).not.toContain("secret draft");
		expect(JSON.stringify(message)).toContain(NOTICE);
		expect(out.message).toBe(message);
	});

	it("agent_end：封条化 messages 内的 assistant 项，保留其它角色", () => {
		const out = projectKnowledgeEvent(
			ev({
				type: "agent_end",
				messages: [
					{ role: "user", content: "hi" },
					{ role: "assistant", content: [{ type: "text", text: "secret" }] },
				],
			}),
		) as { messages: Array<{ role: string; content: unknown }> };
		expect(JSON.stringify(out.messages)).not.toContain("secret");
		expect(out.messages[0]?.content).toBe("hi");
	});

	it("drift-safe：未来新增的带 assistant message 的事件类型也被封条化", () => {
		const out = projectKnowledgeEvent(
			ev({
				type: "some_future_event",
				message: { role: "assistant", content: [{ type: "text", text: "secret" }] },
			}),
		) as { message: unknown };
		expect(JSON.stringify(out.message)).not.toContain("secret");
		expect(JSON.stringify(out.message)).toContain(NOTICE);
	});

	it("snapshot：封条化未封条的 assistant 消息", () => {
		const out = projectKnowledgeSnapshot(
			[{ role: "assistant", content: [{ type: "text", text: "secret" }] } as M],
			[],
		);
		expect(JSON.stringify(out)).not.toContain("secret");
		expect(JSON.stringify(out)).toContain(NOTICE);
	});
});
