import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readKnowledgeBinding } from "../../../.pi/lib/knowledge/config.mjs";
import { resolveWriteRoots } from "../../../.pi/lib/tasks/consent.mjs";
import { registerWorkbench } from "../../../.pi/lib/tasks/register.mjs";
import { createTaskWorkbench, LIMITS, WORKBENCH_ENTRY } from "../../../.pi/lib/tasks/workbench.mjs";

vi.mock("../../../.pi/lib/knowledge/config.mjs", async (original) => ({
	...(await original()),
	readKnowledgeBinding: vi.fn(async () => null),
}));
const dirs = [];
afterEach(async () => {
	vi.useRealTimers();
	for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
const act = (j, action) => j.command({ taskId: j.snapshot().id, revision: j.view().revision, action });
function setup() {
	const entries = [];
	const j = createTaskWorkbench({
		requireAuthorization: true,
		persist: (data) => entries.push({ customType: WORKBENCH_ENTRY, data }),
	});
	j.attach("session-a");
	j.begin("分析数据并交付图表");
	return { j, entries };
}
const plan = (j) =>
	j.plan({
		summary: "使用现有软件生成结果，不安装软件或发布数据。",
		milestones: [{ id: "report", title: "结果文件", acceptance: { kind: "file", path: "report.csv" } }],
	});
async function read(j, id) {
	const event = { toolName: "read", toolCallId: id, input: { path: `${id}.txt` } };
	expect(j.guard(event)).toBeNull();
	await j.observe({ ...event, content: [{ type: "text", text: "fixture data" }] });
}
it("new tasks require one explicit consent before commands and writes, but allow read-only preparation", async () => {
	const { j } = setup();
	await read(j, "prepare");
	expect(j.guard({ toolName: "bash", toolCallId: "cmd", input: { command: "echo x" } })).toMatchObject({
		block: true,
	});
	plan(j);
	act(j, "approve-plan");
	expect(j.authorization()).toBeNull();
	act(j, "authorize-task");
	expect(j.authorization()).toMatchObject({ version: 1, maxCalls: 192, maxAutoResumes: 3 });
	expect(j.snapshot().budget.calls).toBe(1);
	expect(
		j.guard({ toolName: "write", toolCallId: "w", input: { path: "report.csv", content: "x" } }),
	).toBeNull();
});
it("one consent crosses normal stages without more user actions, preserving total budget", async () => {
	const { j } = setup();
	plan(j);
	act(j, "authorize-task");
	const approvedAt = j.authorization().approvedAt;
	for (let i = 0; i < LIMITS.totalCalls; i++) await read(j, String(i));
	expect(j.snapshot().stage).toBeGreaterThan(2);
	expect(j.snapshot().executionConsent.approvedAt).toBe(approvedAt);
	expect(j.snapshot().budget.calls).toBe(192);
	expect(j.guard({ toolName: "read", input: { path: "more" } })).toMatchObject({ block: true });
	act(j, "authorize-task");
	expect(j.snapshot().budget.calls).toBe(192);
	expect(j.reserveContinuation("tool-loop-stopped")).toBe(false);
});
it("status spam and fabricated result events cannot buy automatic stages", async () => {
	const { j } = setup();
	plan(j);
	act(j, "authorize-task");
	await j.observe({ toolName: "read", toolCallId: "never-allowed", input: { path: "fake" } });
	for (let i = 0; i < 48; i++)
		expect(j.guard({ toolName: "set_status", toolCallId: String(i), input: {} })).toBeNull();
	expect(j.advanceStage()).toBe(false);
	expect(j.guard({ toolName: "set_status", input: {} })).toMatchObject({ block: true });
});
it("recovery is bounded and never triggered for aborts, model failures or repeated non-progress", async () => {
	const { j } = setup();
	plan(j);
	act(j, "authorize-task");
	await read(j, "one");
	expect(j.reserveContinuation("interrupted")).toBe(false);
	expect(j.reserveContinuation("model-error")).toBe(false);
	expect(j.reserveContinuation("source-unread")).toBe(true);
	expect(j.reserveContinuation("source-unread")).toBe(false);
	await read(j, "two");
	expect(j.reserveContinuation("source-unread")).toBe(true);
	await read(j, "three");
	expect(j.reserveContinuation("tool-loop-stopped")).toBe(true);
	await read(j, "four");
	expect(j.reserveContinuation("source-unread")).toBe(false);
	expect(j.snapshot().budget.autoResumes).toBe(3);
});
it("consent does not transfer to another goal, binding or cancelled task", () => {
	const { j, entries } = setup();
	plan(j);
	act(j, "authorize-task");
	const copy = structuredClone(entries);
	copy.at(-1).data.tasks[0].authorizationSummary = "changed scope";
	const changed = createTaskWorkbench();
	changed.attach("session-a", copy);
	expect(changed.authorization()).toBeNull();
	j.begin("继续", [], "changed-binding");
	expect(j.authorization()).toBeNull();
	act(j, "cancel");
	expect(j.authorization()).toBeNull();
	j.begin("另一个项目");
	expect(j.authorization()).toBeNull();
});
it("unknown writes and pending human actions prevent automatic recovery", async () => {
	const { j, entries } = setup();
	plan(j);
	act(j, "authorize-task");
	await read(j, "progress");
	j.guard({ toolName: "write", toolCallId: "uncertain", input: { path: "report.csv", content: "x" } });
	const restored = createTaskWorkbench();
	restored.attach("session-a", entries);
	expect(restored.reserveContinuation("source-unread")).toBe(false);
	expect(restored.authorization(true)).toBeNull();
});
it("write directories must be actual project directories, not missing paths or a filesystem root", async () => {
	const dir = await mkdtemp(join(tmpdir(), "drone-consent-"));
	dirs.push(dir);
	expect(await resolveWriteRoots(dir, [".", "."])).toHaveLength(1);
	await expect(resolveWriteRoots(dir, ["does-not-exist"])).rejects.toThrow();
	await expect(resolveWriteRoots(dir, [process.platform === "win32" ? "C:/" : "/"])).rejects.toThrow();
});
async function registered({ withPlan = true } = {}) {
	const dir = await mkdtemp(join(tmpdir(), "drone-consent-ui-"));
	dirs.push(dir);
	const events = {},
		commands = {},
		entries = [];
	// 可切换的空闲状态：回合执行中为 false（模型已发出 tool_calls，结果未回）
	const idle = { value: true };
	const pi = {
		on: (name, cb) => {
			events[name] = cb;
		},
		registerCommand: (name, value) => {
			commands[name] = value;
		},
		registerTool: vi.fn(),
		appendEntry: (customType, data) => entries.push({ customType, data }),
		sendMessage: vi.fn(),
		sendUserMessage: vi.fn(),
		events: { on: vi.fn(), emit: vi.fn() },
	};
	const ctx = {
		cwd: dir,
		ui: { select: vi.fn(async () => "同意本次请求") },
		isIdle: () => idle.value,
		sessionManager: { getSessionId: () => "session-a", getBranch: () => entries },
	};
	const j = registerWorkbench(pi);
	events.session_start({}, ctx);
	j.begin("分析数据");
	if (withPlan) plan(j);
	const approve = () =>
		commands["task-action"].handler(
			Buffer.from(
				JSON.stringify({ taskId: j.snapshot().id, revision: j.view().revision, action: "authorize-task" }),
			).toString("base64url"),
			ctx,
		);
	return { j, pi, ctx, events, commands, approve, idle };
}
it("one card approval starts one hidden host continuation, not a forged user reply", async () => {
	const { j, pi, approve } = await registered();
	vi.useFakeTimers();
	const id = j.snapshot().id;
	await approve();
	await vi.runOnlyPendingTimersAsync();
	const runs = pi.sendMessage.mock.calls.filter(([, o]) => o?.triggerTurn);
	expect(runs).toHaveLength(1);
	expect(runs[0][0]).toMatchObject({ customType: "drone-task-autocontinue", display: false });
	expect(pi.sendUserMessage).not.toHaveBeenCalled();
	expect(j.snapshot().id).toBe(id);
	expect(j.isAutoContinuation({ ...runs[0][0], role: "custom" })).toBe(true);
	expect(
		j.isAutoContinuation({ ...runs[0][0], role: "custom", details: { taskId: id, nonce: "forged" } }),
	).toBe(false);
});
it("no status card is injected between tool_calls and their results (400 invalid_request regression)", async () => {
	const { pi, ctx, events, approve, idle } = await registered();
	vi.useFakeTimers();
	await approve();
	await vi.runOnlyPendingTimersAsync();
	pi.sendMessage.mockClear();
	// 回合执行中：模型已发出 tool_calls，tool 结果尚未写回
	idle.value = false;
	// tool_call 钩子内触发阶段推进 → onCheckpoint → send()
	events.tool_call({ toolName: "read", toolCallId: "call_a", input: { path: "a.txt" } });
	await events.tool_result(
		{
			toolName: "read",
			toolCallId: "call_a",
			content: [{ type: "text", text: "fixture" }],
		},
		ctx,
	);
	// 关键断言：执行窗口内一条 custom 消息都不能注入，否则 assistant(tool_calls)
	// 与 tool 结果被拆开，DeepSeek/OpenAI 兼容端点返回 400。
	expect(pi.sendMessage).not.toHaveBeenCalled();
});
it("a status card held during the turn is still delivered at agent_end", async () => {
	const { pi, ctx, events, approve, idle } = await registered();
	vi.useFakeTimers();
	await approve();
	await vi.runOnlyPendingTimersAsync();
	pi.sendMessage.mockClear();
	idle.value = false;
	// 执行窗口内触发阶段推进：卡片被挂起，不得注入
	events.tool_call({ toolName: "read", toolCallId: "call_h", input: { path: "h.txt" } });
	await events.tool_result(
		{
			toolName: "read",
			toolCallId: "call_h",
			content: [{ type: "text", text: "fixture" }],
		},
		ctx,
	);
	expect(pi.sendMessage).not.toHaveBeenCalled();
	// 回合结束：挂起的卡片必须补发，内容不丢
	idle.value = true;
	await events.agent_end({ messages: [{ role: "assistant", stopReason: "endTurn" }] }, ctx);
	const cards = pi.sendMessage.mock.calls.filter(([m]) => m?.customType === "drone-task-status");
	expect(cards.length).toBeGreaterThan(0);
});
it.each(["input", "session_shutdown", "abort"])(
	"%s cancels queued automatic continuation",
	async (action) => {
		const { pi, ctx, events, approve } = await registered();
		vi.useFakeTimers();
		await approve();
		if (action === "input") await events.input({ text: "改为另一个任务" }, ctx);
		else if (action === "abort")
			await events.agent_end({ messages: [{ role: "assistant", stopReason: "aborted" }] }, ctx);
		else events.session_shutdown();
		await vi.runOnlyPendingTimersAsync();
		expect(pi.sendMessage.mock.calls.filter(([, o]) => o?.triggerTurn)).toHaveLength(0);
	},
);

it("the single authorization proposal is available after bounded preflight, without granting effects", async () => {
	const { j } = setup();
	for (let i = 0; i < LIMITS.stageCalls; i++) await read(j, `pre-${i}`);
	expect(j.guard({ toolName: "task_plan", toolCallId: "plan", input: {} })).toBeNull();
	plan(j);
	expect(j.guard({ toolName: "write", toolCallId: "w", input: { path: "x", content: "x" } })).toMatchObject({
		block: true,
	});
	act(j, "authorize-task");
	expect(j.snapshot().budget.calls).toBe(LIMITS.stageCalls);
	await read(j, "execution");
});
it("readback can verify a user-approved data directory outside the session cwd, but still checks read policy", async () => {
	const project = await mkdtemp(join(tmpdir(), "consent-project-"));
	const data = await mkdtemp(join(tmpdir(), "consent-data-"));
	dirs.push(project, data);
	const root = await realpath(data),
		output = join(root, "report.csv");
	await writeFile(output, "value\n1");
	const handlers = {},
		entries = [];
	let readChecks = 0;
	const pi = {
		on: (name, cb) => {
			handlers[name] = cb;
		},
		registerTool: vi.fn(),
		registerCommand: vi.fn(),
		sendMessage: vi.fn(),
		appendEntry: (customType, value) => entries.push({ customType, data: value }),
		events: {
			on() {},
			emit(name, request) {
				if (name === "drone:task-read-check") {
					readChecks++;
					request.claim();
					request.resolve(true);
				}
			},
		},
	};
	const ctx = { cwd: project, sessionManager: { getSessionId: () => "s", getBranch: () => entries } };
	const j = registerWorkbench(pi);
	handlers.session_start({}, ctx);
	j.begin("分析指定数据目录");
	j.plan({
		summary: "只在已选数据目录写入报告",
		writeRoots: [root],
		milestones: [{ id: "report", title: "报告", acceptance: { kind: "file", path: output } }],
	});
	act(j, "authorize-task");
	await j.reconcile(project);
	expect(readChecks).toBeGreaterThan(0);
	expect(j.snapshot().milestones[0].state).toBe("completed");
	expect(j.snapshot().milestones[0].evidence.kind).toBe("file-observed");
	pi.events.emit = (name, request) => {
		if (name === "drone:task-read-check") {
			request.claim();
			request.resolve(false);
		}
	};
	await j.reconcile(project);
	expect(j.snapshot().milestones[0].state).not.toBe("completed");
});

it("a late preparation failure cannot reopen a task cancelled during the async handoff", async () => {
	const { j, pi, ctx, commands, approve } = await registered();
	vi.useFakeTimers();
	let rejectBinding;
	// Authorization checks the binding before and after the user answer; the third read is the handoff under test.
	readKnowledgeBinding
		.mockResolvedValueOnce(null)
		.mockResolvedValueOnce(null)
		.mockReturnValueOnce(
			new Promise((_resolve, reject) => {
				rejectBinding = reject;
			}),
		);
	await approve();
	vi.advanceTimersByTime(0);
	await commands["task-action"].handler(
		Buffer.from(
			JSON.stringify({ taskId: j.snapshot().id, revision: j.view().revision, action: "cancel" }),
		).toString("base64url"),
		ctx,
	);
	rejectBinding(new Error("late fixture failure"));
	await Promise.resolve();
	await Promise.resolve();
	expect(j.snapshot().state).toBe("cancelled");
	expect(j.snapshot().reason).toBe("user-cancelled");
	expect(pi.sendMessage.mock.calls.filter(([, o]) => o?.triggerTurn)).toHaveLength(0);
});

it.each([true, false])("task_plan opens ask_user immediately; approved=%s", async (approved) => {
	const { j, pi, ctx } = await registered({ withPlan: false });
	ctx.ui.select.mockResolvedValue(approved ? "同意本次请求" : undefined);
	const tool = pi.registerTool.mock.calls.map(([tool]) => tool).find((tool) => tool.name === "task_plan");
	const result = await tool.execute(
		"plan",
		{
			summary: "Create report",
			milestones: [{ id: "report", title: "Report", acceptance: { kind: "file", path: "report.csv" } }],
		},
		undefined,
		undefined,
		ctx,
	);
	expect(ctx.ui.select).toHaveBeenCalledOnce();
	expect(JSON.parse(result.content[0].text).authorized).toBe(approved);
	expect(!!j.authorization()).toBe(approved);
	expect(pi.sendUserMessage).not.toHaveBeenCalled();
});
it("task_wait authorization opens ask_user rather than leaving an inert authorization card", async () => {
	const { j, pi, ctx } = await registered();
	ctx.ui.select.mockResolvedValue(undefined);
	const tool = pi.registerTool.mock.calls.map(([tool]) => tool).find((tool) => tool.name === "task_wait");
	await tool.execute(
		"wait",
		{ kind: "authorization", title: "A bounded action", reason: "Needs explicit user consent" },
		undefined,
		undefined,
		ctx,
	);
	expect(ctx.ui.select).toHaveBeenCalledOnce();
	expect(j.snapshot().actions[0].state).toBe("pending");
	expect(j.authorization()).toBeFalsy();
});
