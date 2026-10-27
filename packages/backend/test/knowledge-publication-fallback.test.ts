import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectKnowledgeEvent, projectKnowledgeSnapshot } from "../src/session/knowledge-publication";

// 覆盖 bridge 缺失时的兜底投影（此前无测试，最易随扩展演进而漂移）。
type E = Parameters<typeof projectKnowledgeEvent>[0];
type M = Parameters<typeof projectKnowledgeSnapshot>[0][number];
const ev = (o: unknown): E => o as E;
const NOTICE = "回答检查未完成";

describe("knowledge-publication fallback（bridge 缺失）", () => {
	const prevDir = process.env.DRONE_KNOWLEDGE_DIR;
	beforeEach(() => {
		process.env.DRONE_KNOWLEDGE_DIR = "/tmp/vault";
	});
	afterEach(() => {
		if (prevDir === undefined) delete process.env.DRONE_KNOWLEDGE_DIR;
		else process.env.DRONE_KNOWLEDGE_DIR = prevDir;
	});

	it("DRONE_KNOWLEDGE_DIR 未设时原样透传", () => {
		delete process.env.DRONE_KNOWLEDGE_DIR;
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

	it("preserves the SDK tool-call envelope without publishing draft/thinking or accepting a copied domain proof", () => {
		const call = fauxToolCall("read", { path: "input.txt" });
		const metadata = {
			responseModel: "served-model",
			providerThinkingLevel: "low",
			thinkingLevel: "low",
			diagnostics: [],
			rawStopReason: "tool_use",
			endTurn: false,
			durationMs: 12,
		};
		const message = Object.assign(
			fauxAssistantMessage(
				[
					{ type: "text", text: "PRIVATE_PROGRESS" },
					{ type: "thinking", thinking: "PRIVATE_THINKING", thinkingSignature: "signed-protocol" },
					call,
				],
				{ stopReason: "toolUse", responseId: "provider-response" },
			),
			metadata,
			{
				knowledgePublication: { status: "released", id: "copied-proof" },
				privateDomainState: "not-sdk-metadata",
			},
		);
		const usage = message.usage;
		const out = projectKnowledgeEvent(ev({ type: "message_end", message })) as { message: M };
		expect(out.message).toBe(message);
		expect(message).toMatchObject({ ...metadata, responseId: "provider-response", content: [call] });
		expect(message.usage).toBe(usage);
		expect(Object.hasOwn(message, "knowledgePublication")).toBe(false);
		expect(Object.hasOwn(message, "privateDomainState")).toBe(false);
		for (const projected of [
			projectKnowledgeEvent(ev({ type: "turn_end", message })),
			projectKnowledgeEvent(ev({ type: "agent_end", messages: [message] })),
			projectKnowledgeSnapshot([message], []),
		]) {
			expect(JSON.stringify(projected)).toContain(call.id);
			expect(JSON.stringify(projected)).not.toMatch(/PRIVATE_PROGRESS|PRIVATE_THINKING|copied-proof/);
		}
	});

	it.each(["stop", "error", "aborted"] as const)(
		"keeps official metadata and real usage on a sealed %s message",
		(stopReason) => {
			const message = Object.assign(
				fauxAssistantMessage("UNPUBLISHED_DRAFT", {
					stopReason,
					responseId: "provider-response",
					...(stopReason === "error" ? { errorMessage: "server_error api_key=fixture-secret" } : {}),
				}),
				{ responseModel: "served-model", durationMs: 11, knowledgePublication: { status: "released" } },
			);
			const { role, api, provider, model, usage, responseId, responseModel, timestamp, durationMs } = message;
			projectKnowledgeEvent(ev({ type: "message_end", message }));
			expect(message).toMatchObject({
				role,
				api,
				provider,
				model,
				usage,
				responseId,
				responseModel,
				timestamp,
				durationMs,
				stopReason,
			});
			expect(message.usage).toBe(usage);
			expect(Object.hasOwn(message, "knowledgePublication")).toBe(false);
			expect(JSON.stringify(message)).not.toMatch(/UNPUBLISHED_DRAFT|fixture-secret/);
		},
	);

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
	it("投影器抛异常时失败关闭并清除草稿", () => {
		const runtime = {
			knowledge: {
				publication: {
					projectEvent: () => {
						throw new Error("bridge secret");
					},
				},
			},
		} as Parameters<typeof projectKnowledgeEvent>[1];
		const message = {
			role: "assistant",
			content: [{ type: "text", text: "private draft" }],
			stopReason: "stop",
		};
		const out = projectKnowledgeEvent(ev({ type: "message_end", message }), runtime) as {
			message: { content: Array<{ text?: string }> };
		};
		expect(JSON.stringify(out)).not.toContain("private draft");
		expect(JSON.stringify(out)).not.toContain("bridge secret");
		expect(out.message.content[0]?.text).toContain(NOTICE);
	});
	it("retains the provider failure without exposing the unpublished draft or credentials", () => {
		const message = {
			role: "assistant",
			content: [{ type: "text", text: "UNPUBLISHED_DRAFT" }],
			stopReason: "error",
			errorMessage: "server_error 502 api_key=fixture-secret",
		};
		projectKnowledgeEvent(ev({ type: "message_end", message }));
		expect(message.errorMessage).toContain("server_error 502");
		expect(JSON.stringify(message)).not.toMatch(/UNPUBLISHED_DRAFT|fixture-secret|知识库检查未通过/);
	});
	it("reports cancellation consistently in event and history fallback", () => {
		const message = {
			role: "assistant",
			content: [{ type: "text", text: "UNPUBLISHED_DRAFT" }],
			stopReason: "aborted",
		} as M;
		const out = projectKnowledgeSnapshot([message], []);
		expect(JSON.stringify(out)).toContain("本次请求已中断");
		expect(JSON.stringify(out)).not.toMatch(/UNPUBLISHED_DRAFT|知识库检查未通过/);
	});
});
