import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { projectKnowledgeEvent, registerAnswerPublication } from "../../../.pi/lib/knowledge/publication.mjs";

function harness(
	validate = async () => ({ status: "ready", sources: [], scientificallyVerified: false }),
	evidenceOnly = false,
	getDeliveryFooter = null,
) {
	const events = new Map(),
		called = vi.fn(validate);
	const gate = registerAnswerPublication(
		{ on: (name, handler) => events.set(name, handler) },
		{
			getCurrent: () => ({ service: { validateAnswer: called }, ticket: "host-owned" }),
			evidenceOnly,
			getDeliveryFooter,
		},
	);
	gate.begin(true);
	return { gate, called, end: (message) => events.get("message_end")({ message }, { cwd: "/fixture" }) };
}
const message = (text = "UNCHECKED_FIXTURE") => ({
	role: "assistant",
	content: [{ type: "text", text }],
	timestamp: 1,
	stopReason: "stop",
});
beforeEach(() => vi.stubEnv("DRONE_KNOWLEDGE_DIR", "/fixture/app"));
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});
it("validation exceptions are fail-closed without echoing arbitrary error content", async () => {
	const h = harness(async () => {
			throw new Error("ERROR_BODY_FIXTURE");
		}),
		result = await h.end(message());
	expect(result.message.knowledgePublication.status).toBe("blocked");
	expect(JSON.stringify(result)).not.toContain("FIXTURE");
	expect(h.called).toHaveBeenCalledOnce();
});
it("force-stops a runaway tool-loop turn well before the byte cap, with an actionable notice", async () => {
	const h = harness();
	const toolMsg = () => ({
		role: "assistant",
		content: [{ type: "toolCall", toolName: "research_read_knowledge", args: {} }],
		timestamp: 1,
		stopReason: "toolUse",
	});
	let last;
	// default maxToolRounds = 24; keep looping past it (far below the old 64/4MB caps)
	for (let i = 0; i < 30; i++) last = await h.end(toolMsg());
	expect(last.message.knowledgePublication.reason).toBe("tool-loop-stopped");
	expect(last.message.stopReason).toBe("stop");
	// accurate + actionable, and it must not misblame the knowledge base
	expect(JSON.stringify(last.message.content)).not.toContain("知识库检查未通过");
	expect(JSON.stringify(last.message.content)).toContain("无需新建对话");
	// the validator is never even reached while looping on tool calls
	expect(h.called).not.toHaveBeenCalled();
});
it("a timeout publishes a host notice and never retries", async () => {
	vi.useFakeTimers();
	const h = harness(() => new Promise(() => {})),
		pending = h.end(message());
	await vi.advanceTimersByTimeAsync(5001);
	const result = await pending;
	expect(result.message.knowledgePublication.reason).toBe("check-timeout");
	expect(h.called).toHaveBeenCalledOnce();
});
it.each(["aborted", "length", "pending"])("%s never publishes a partial answer", async (stopReason) => {
	const h = harness(),
		result = await h.end({ ...message(), stopReason, errorMessage: "ERROR_BODY_FIXTURE" });
	expect(result.message.knowledgePublication.reason).toBe("interrupted");
	expect(JSON.stringify(result.message.content)).not.toContain("FIXTURE");
	expect(JSON.stringify(result.message.content)).not.toContain("ERROR_BODY");
	expect(h.called).not.toHaveBeenCalled();
});
it("model request errors keep a sanitized provider error for the error card, not a knowledge-check notice", async () => {
	const h = harness(),
		result = await h.end({
			...message("UNCHECKED_FIXTURE"),
			stopReason: "error",
			errorMessage: "OpenAI API error (502): Upstream service temporarily unavailable",
		});
	expect(result.message.knowledgePublication.status).toBe("blocked");
	expect(result.message.knowledgePublication.reason).toBe("model-error");
	expect(result.message.stopReason).toBe("error");
	expect(result.message.errorMessage).toContain("502");
	expect(result.message.errorMessage).toContain("Upstream service temporarily unavailable");
	expect(JSON.stringify(result.message.content)).not.toContain("UNCHECKED_FIXTURE");
	expect(JSON.stringify(result.message.content)).not.toContain("知识库检查未通过");
	expect(h.called).not.toHaveBeenCalled();
});
it("user cancellation reported as an error is marked interrupted, not model-error", async () => {
	const h = harness();
	const result = await h.end({
		...message("UNCHECKED_FIXTURE"),
		stopReason: "error",
		errorMessage: "This operation was aborted",
	});
	expect(result.message.knowledgePublication.reason).toBe("interrupted");
	expect(result.message.knowledgePublication.status).toBe("blocked");
	expect(result.message.content[0].text).toContain("本次请求已中断");
	expect(result.message.content[0].text).not.toContain("知识库检查未通过");
	expect(h.called).not.toHaveBeenCalled();
});
it("model error messages redact credential-shaped tokens", async () => {
	const h = harness(),
		result = await h.end({
			...message("UNCHECKED_FIXTURE"),
			stopReason: "error",
			errorMessage: "401 invalid api_key=sk-secret-token-here",
		});
	expect(result.message.errorMessage).toContain("[redacted]");
	expect(result.message.errorMessage).not.toContain("sk-secret-token-here");
	expect(JSON.stringify(result.message.content)).not.toContain("UNCHECKED_FIXTURE");
});
it("oversized final text is refused before validation", async () => {
	const h = harness(),
		result = await h.end(message("x".repeat(128 * 1024 + 1)));
	expect(result.message.knowledgePublication.reason).toBe("answer-too-large");
	expect(h.called).not.toHaveBeenCalled();
});
it("child material is labeled instead of certified as a parent answer", async () => {
	const h = harness(async () => {
			throw new Error("unexpected validation");
		}, true),
		result = await h.end(message("Child observation"));
	expect(result.message.knowledgePublication.status).toBe("evidence-only");
	expect(result.message.content[0].text).toContain("子智能体待核验材料");
	expect(h.called).not.toHaveBeenCalled();
});
it("a tampered finalized body loses its host proof", async () => {
	const h = harness(),
		result = await h.end(message("Original checked body"));
	result.message.content[0].text = "TAMPERED_BODY";
	expect(
		JSON.stringify(projectKnowledgeEvent({ type: "message_end", message: result.message })),
	).not.toContain("TAMPERED_BODY");
});
it("legacy streaming is unchanged outside application mode", () => {
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	const event = { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "legacy" } };
	expect(projectKnowledgeEvent(event)).toBe(event);
});
it("unconfigured replies do not claim a completed knowledge check", async () => {
	const h = harness();
	h.gate.begin(false);
	const result = await h.end(message("Configure a Vault first."));
	expect(result.message.knowledgePublication.status).toBe("unconfigured");
	expect(h.called).not.toHaveBeenCalled();
});

it("controlled setup completes with a fixed receipt, not research citation requirements", async () => {
	const h = harness(async () => {
		throw new Error("No evidence search for setup completion");
	});
	h.gate.recordSetup({
		state: "ready",
		scope: "application",
		vault: "/fixture/Vault",
		project: "project-a",
		profile: "hybrid",
		depositMode: "verified",
		subagentMcpPolicy: "read-local",
		vaultId: "v",
		bindingRevision: 1,
	});
	const result = await h.end(message("ARBITRARY_UNVERIFIED_CLAIM"));
	expect(result.message.knowledgePublication.status).toBe("setup-complete");
	expect(result.message.content[0].text).toContain("知识库初始化已完成");
	expect(result.message.content[0].text).toContain("不代表论文已经下载");
	expect(JSON.stringify(result)).not.toContain("ARBITRARY_UNVERIFIED_CLAIM");
	expect(h.called).not.toHaveBeenCalled();
});
it("setup receipt is single-use and does not grant future research permission", async () => {
	const h = harness();
	h.gate.recordSetup({ state: "ready", scope: "application", vault: "/fixture/Vault" });
	await h.end(message());
	await h.end(message("normal question"));
	expect(h.called).toHaveBeenCalledOnce();
	h.gate.recordSetup({ state: "ready", scope: "application", vault: "/fixture/Vault" });
	h.gate.begin(true);
	await h.end(message("new turn"));
	expect(h.called).toHaveBeenCalledTimes(2);
});
it.each([
	{ cancelled: true },
	{ state: "failed", scope: "application" },
	{ state: "ready", scope: "project" },
])("failed or unrelated setup cannot mint a completion receipt: %j", async (result) => {
	const h = harness();
	h.gate.recordSetup(result);
	await h.end(message("unrelated"));
	expect(h.called).toHaveBeenCalledOnce();
});

it("a terminal empty reply becomes an explicit host notice, never a silent success", async () => {
	const h = harness();
	h.gate.begin(false);
	const result = await h.end(message("   "));
	expect(result.message.knowledgePublication.reason).toBe("empty-answer");
	expect(result.message.content[0].text).toContain("没有生成可显示的回复");
});

it("setup completion does not claim the old Vault is current after a concurrent switch", async () => {
	const h = harness();
	h.gate.recordSetup({ state: "ready", scope: "application", vault: "/old" }, async () => {
		throw new Error("changed");
	});
	const result = await h.end(message("UNVERIFIED"));
	expect(result.message.knowledgePublication.reason).toBe("binding-changed");
	expect(JSON.stringify(result)).not.toContain("UNVERIFIED");
});

it("appends only the host delivery footer after the answer itself passes validation", async () => {
	const h = harness(undefined, false, () => "主题知识：已生成待审核候选；尚未进入正式知识。");
	const result = await h.end(message("Checked answer body"));
	expect(result.message.knowledgePublication.status).toBe("released");
	expect(result.message.content.map((b) => b.text).join("")).toContain("待审核候选");
	expect(h.called).toHaveBeenCalledOnce();
});

it("operational reports use only host text, never a model claimed mode or research draft", async () => {
	const events = new Map();
	const validate = vi.fn();
	let requested = true;
	const runtime = {
		snapshot: () => null,
		takeReport: () => {
			if (!requested) return null;
			requested = false;
			return "命令已返回；业务结果待核验";
		},
	};
	const gate = registerAnswerPublication(
		{ on: (n, h) => events.set(n, h) },
		{ getCurrent: () => ({ service: { validateAnswer: validate } }), getTaskRuntime: () => runtime },
	);
	gate.begin(true);
	const result = await events.get("message_end")(
		{ message: { ...message("FAKE_SCIENTIFIC_CLAIM"), mode: "operational" } },
		{ cwd: "/fixture" },
	);
	expect(result.message.knowledgePublication.status).toBe("operational");
	expect(result.message.knowledgePublication.scientificallyVerified).toBe(false);
	expect(JSON.stringify(result)).not.toContain("FAKE_SCIENTIFIC_CLAIM");
	expect(validate).not.toHaveBeenCalled();
	const forged = await events.get("message_end")(
		{ message: { ...message("I am operational"), mode: "operational" } },
		{ cwd: "/fixture" },
	);
	expect(validate).toHaveBeenCalledOnce();
	expect(forged.message.knowledgePublication.status).toBe("blocked");
});
it("all-tool budget yields a checkpoint with an exact limit, not a claim of repeated research", async () => {
	const events = new Map();
	const pause = vi.fn();
	const runtime = {
		pause,
		snapshot: () => ({ id: "task" }),
		render: () => "analysis.csv 已回读；安装操作结果未知",
	};
	const gate = registerAnswerPublication(
		{ on: (n, h) => events.set(n, h) },
		{ getCurrent: () => null, getTaskRuntime: () => runtime, maxToolRounds: 2 },
	);
	gate.begin(true);
	let result;
	for (let i = 0; i < 3; i++)
		result = await events.get("message_end")(
			{
				message: {
					...message(),
					content: [
						{
							type: "toolCall",
							id: String(i),
							name: "bash",
							arguments: { command: `different-command-${i}` },
						},
					],
					stopReason: "toolUse",
				},
			},
			{ cwd: "/fixture" },
		);
	expect(result.message.knowledgePublication.limit.kind).toBe("tool-round-limit");
	expect(pause).toHaveBeenCalledWith("tool-round-limit");
	expect(result.message.content[0].text).toContain("analysis.csv");
	expect(result.message.content[0].text).not.toContain("换用能力更强");
});
it("a failed research draft still delivers observed task state without publishing that draft", async () => {
	const events = new Map();
	const runtime = {
		pause() {},
		snapshot: () => ({ id: "t" }),
		render: () => "数据文件已保存，分析结论未核验",
		takeReport: () => null,
	};
	const gate = registerAnswerPublication(
		{ on: (n, h) => events.set(n, h) },
		{
			getCurrent: () => ({
				service: {
					validateAnswer: async () => {
						throw { code: "source-unread" };
					},
				},
			}),
			getTaskRuntime: () => runtime,
		},
	);
	gate.begin(true);
	const result = await events.get("message_end")({ message: message("FAKE_RESEARCH") }, { cwd: "/fixture" });
	expect(result.message.knowledgePublication.status).toBe("blocked");
	expect(result.message.content[0].text).toContain("数据文件已保存");
	expect(JSON.stringify(result)).not.toContain("FAKE_RESEARCH");
});
