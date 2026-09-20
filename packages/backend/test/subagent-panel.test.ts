import type { SessionEvent, SubagentPanelRun } from "@drone/shared";
import { SUBAGENT_DISPATCH_CUSTOM_TYPE, SUBAGENT_RESULT_CUSTOM_TYPE } from "@drone/shared";
import { describe, expect, it, vi } from "vitest";
import { PermissionGate } from "../src/permissions/gate";
import { toSessionMessages } from "../src/session/messages";
import type { SubagentDefinition } from "../src/tools/subagent/agents";
import { formatSubagentFollowUp, SubagentPanelService } from "../src/tools/subagent/panel";
import type { RunSubagentDeps, RunSubagentInput, SingleResult } from "../src/tools/subagent/runner";

const SCOUT: SubagentDefinition = {
	name: "scout",
	description: "read-only recon",
	tools: ["read", "grep", "find", "ls", "webfetch"],
	mcpAccess: "read-local",
	systemPrompt: "scout",
	source: "builtin",
};
const CHECKER: SubagentDefinition = {
	name: "data-checker",
	description: "project checker",
	tools: ["read", "bash"],
	mcpAccess: "none",
	systemPrompt: "checker",
	source: "project",
	path: "/proj/.pi/agents/data-checker.md",
};

function usage(tokens = 0) {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens: { tokens } };
}

interface FakeRun {
	input: RunSubagentInput;
	deps: RunSubagentDeps;
	/** 模拟子会话已创建（首个 onProgress = 运行槽已拿到） */
	start: (overrides?: Partial<SingleResult>) => void;
	/** 模拟结束 */
	finish: (overrides?: Partial<SingleResult>) => void;
	fail: (error: Error) => void;
}

/** 可控的假 runner：每次调用产出一个 FakeRun 句柄；signal abort → 与真 runner 一致地以 exitCode 1 返回 */
function fakeRunner() {
	const runs: FakeRun[] = [];
	const waiters: Array<() => boolean> = [];
	let cursor = 0;
	const run = (deps: RunSubagentDeps, input: RunSubagentInput): Promise<SingleResult> =>
		new Promise<SingleResult>((resolve, reject) => {
			let started = false;
			const base = (): SingleResult => ({
				agent: input.agent.name,
				task: input.task,
				exitCode: -1,
				usage: usage(),
				artifactPaths: {},
			});
			const handle: FakeRun = {
				input,
				deps,
				start: (overrides = {}) => {
					started = true;
					input.onProgress?.({
						...base(),
						sessionId: `child-${runs.indexOf(handle) + 1}`,
						artifactPaths: { jsonlPath: `/tmp/sessions-subagents/${input.agent.name}.jsonl` },
						startedAt: 1000,
						...overrides,
					});
				},
				finish: (overrides = {}) =>
					resolve({
						...base(),
						sessionId: started ? `child-${runs.indexOf(handle) + 1}` : undefined,
						exitCode: 0,
						content: "conclusion",
						usage: usage(42),
						artifactPaths: started ? { jsonlPath: `/tmp/sessions-subagents/${input.agent.name}.jsonl` } : {},
						...overrides,
					}),
				fail: reject,
			};
			input.signal?.addEventListener("abort", () => {
				if (started) resolve({ ...base(), exitCode: 1, error: "aborted" });
				else reject(new Error("Native subagent cancelled while queued"));
			});
			runs.push(handle);
			const waiter = waiters.shift();
			if (waiter) waiter();
		});
	/** 按创建顺序取下一个 FakeRun（尚未创建时等待） */
	const next = () =>
		new Promise<FakeRun>((resolve) => {
			const deliver = () => {
				const handle = runs[cursor];
				if (!handle) return false;
				cursor++;
				resolve(handle);
				return true;
			};
			if (!deliver()) waiters.push(deliver);
		});
	return { run, runs, next };
}

function fakeSession(options: { streaming?: boolean } = {}) {
	const entries: Array<{ customType: string; data: unknown }> = [];
	const custom: Array<{ message: unknown; options: unknown }> = [];
	return {
		entries,
		custom,
		context: {
			session: {
				isStreaming: options.streaming === true,
				model: undefined,
				sendCustomMessage: vi.fn(async (message: unknown, opts: unknown) => {
					custom.push({ message, options: opts });
				}),
				sessionManager: {
					appendCustomEntry: (customType: string, data: unknown) => {
						entries.push({ customType, data });
						return "entry";
					},
				},
			} as never,
			cwd: "/proj",
			readOnly: false,
			projectTrusted: true,
			gate: new PermissionGate(() => {}),
		},
	};
}

function makeService(options: {
	runner: ReturnType<typeof fakeRunner>;
	session: ReturnType<typeof fakeSession>;
	agents?: SubagentDefinition[];
	projectTrusted?: boolean;
	readOnly?: boolean;
	limit?: number;
}) {
	const events: Array<{ sessionId: string; run: SubagentPanelRun }> = [];
	const agents = options.agents ?? [SCOUT, CHECKER];
	const ctx = {
		...options.session.context,
		projectTrusted: options.projectTrusted ?? true,
		readOnly: options.readOnly ?? false,
	};
	let now = 5000;
	const service = new SubagentPanelService({
		runner: {
			getModelRuntime: () => Promise.reject(new Error("unused")),
			getSubagentModel: async () => undefined,
			traces: {} as never,
		},
		resolveSession: (sessionId) => (sessionId === "parent" ? ctx : undefined),
		emit: (sessionId, event) => events.push({ sessionId, run: event.run }),
		run: options.runner.run,
		discover: async (_cwd, opts) =>
			agents.filter((agent) => agent.source !== "project" || opts.projectTrusted),
		projectLimit: async () => options.limit ?? 3,
		now: () => now++,
		agentDir: "/home/u/.pi/agent",
	});
	return { service, events, ctx };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const statuses = (events: Array<{ run: SubagentPanelRun }>, runId: string) =>
	events.filter((event) => event.run.runId === runId).map((event) => event.run.status);

describe("SubagentPanelService · 派发与状态机", () => {
	it("派发 → queued → running（首个 onProgress）→ done；followUp 走 custom 消息（空闲：triggerTurn）", async () => {
		const runner = fakeRunner();
		const session = fakeSession();
		const { service, events } = makeService({ runner, session });
		const receipt = await service.dispatch("parent", { tasks: [{ agent: "scout", task: "look around" }] });
		expect(receipt.runs).toHaveLength(1);
		const run = receipt.runs[0] as SubagentPanelRun;
		expect(run.status).toBe("queued");
		expect(run.queuePosition).toBe(1);
		// 派发条目：custom entry（模型不可见）
		expect(session.entries[0]?.customType).toBe(SUBAGENT_DISPATCH_CUSTOM_TYPE);

		const handle = await runner.next();
		expect(handle.input.requiredTools).toEqual([]);
		handle.start();
		expect(service.getRun(run.runId)?.status).toBe("running");
		expect(service.getRun(run.runId)?.childSessionId).toBe("child-1");
		expect(service.getRun(run.runId)?.queuePosition).toBeUndefined();

		handle.finish({ content: "rules: five fields" });
		await flush();
		const done = service.getRun(run.runId) as SubagentPanelRun;
		expect(done.status).toBe("done");
		expect(done.content).toBe("rules: five fields");
		expect(done.tokens).toBe(42);
		expect(done.contextState).toBe("pending");
		expect(session.custom).toHaveLength(1);
		expect(session.custom[0]?.options).toEqual({ triggerTurn: true });
		const message = session.custom[0]?.message as {
			customType: string;
			content: string;
			details: { run: SubagentPanelRun };
		};
		expect(message.customType).toBe(SUBAGENT_RESULT_CUSTOM_TYPE);
		expect(message.content).toContain("rules: five fields");
		expect(message.details.run.runId).toBe(run.runId);
		expect(statuses(events, run.runId)).toEqual(["queued", "running", "done"]);

		// 主模型消费（message_end）→ 已进入上下文
		service.observe("parent", {
			type: "message_end",
			message: {
				role: "custom",
				customType: SUBAGENT_RESULT_CUSTOM_TYPE,
				content: "",
				display: true,
				details: message.details,
			},
		} as unknown as SessionEvent);
		expect(service.getRun(run.runId)?.contextState).toBe("delivered");
		expect(events.at(-1)?.run.contextState).toBe("delivered");
	});

	it("主模型正在生成：followUp 进队列（deliverAs followUp），不直接追加", async () => {
		const runner = fakeRunner();
		const session = fakeSession({ streaming: true });
		const { service } = makeService({ runner, session });
		await service.dispatch("parent", { tasks: [{ agent: "scout", task: "t" }] });
		const handle = await runner.next();
		handle.start();
		handle.finish();
		await flush();
		expect(session.custom[0]?.options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
	});

	it("未勾选 followUp：结果只落 custom entry（模型不可见），contextState=none", async () => {
		const runner = fakeRunner();
		const session = fakeSession();
		const { service } = makeService({ runner, session });
		const receipt = await service.dispatch("parent", {
			tasks: [{ agent: "scout", task: "t" }],
			followUp: false,
		});
		const handle = await runner.next();
		handle.start();
		handle.finish();
		await flush();
		expect(session.custom).toHaveLength(0);
		expect(session.entries.map((entry) => entry.customType)).toEqual([
			SUBAGENT_DISPATCH_CUSTOM_TYPE,
			SUBAGENT_RESULT_CUSTOM_TYPE,
		]);
		expect(service.getRun((receipt.runs[0] as SubagentPanelRun).runId)?.contextState).toBe("none");
	});

	it("排队中取消 → aborted（不算失败，不注入 followUp）；运行中中止 → aborted", async () => {
		const runner = fakeRunner();
		const session = fakeSession();
		const { service, events } = makeService({ runner, session });
		const receipt = await service.dispatch("parent", {
			tasks: [
				{ agent: "scout", task: "a" },
				{ agent: "scout", task: "b" },
			],
		});
		const [first, second] = receipt.runs as [SubagentPanelRun, SubagentPanelRun];
		expect(second.queuePosition).toBe(2);
		const h1 = await runner.next();
		await runner.next();
		expect(service.abort(second.runId)).toBe(true);
		await flush();
		expect(service.getRun(second.runId)?.status).toBe("aborted");
		expect(service.getRun(second.runId)?.error).toBeUndefined();

		h1.start();
		expect(service.abort(first.runId)).toBe(true);
		await flush();
		expect(service.getRun(first.runId)?.status).toBe("aborted");
		expect(session.custom).toHaveLength(0);
		// 终态不能再中止；未知 runId 返回 false
		expect(service.abort(first.runId)).toBe(false);
		expect(service.abort("nope")).toBe(false);
		expect(statuses(events, first.runId)).toEqual(["queued", "running", "aborted"]);
	});

	it("运行失败 → error，带诊断；results 记录仍落 entry 供回放", async () => {
		const runner = fakeRunner();
		const session = fakeSession();
		const { service } = makeService({ runner, session });
		const receipt = await service.dispatch("parent", { tasks: [{ agent: "scout", task: "t" }] });
		const handle = await runner.next();
		handle.start();
		handle.finish({ exitCode: 1, error: "MCP server zotero not connected" });
		await flush();
		const run = service.getRun((receipt.runs[0] as SubagentPanelRun).runId) as SubagentPanelRun;
		expect(run.status).toBe("error");
		expect(run.error).toBe("MCP server zotero not connected");
		expect(session.custom).toHaveLength(0);
		expect(session.entries.at(-1)?.customType).toBe(SUBAGENT_RESULT_CUSTOM_TYPE);
	});

	it("子会话的权限确认归因到运行：waiting_approval + pendingApprovalIds，应答后回到 running", async () => {
		const runner = fakeRunner();
		const session = fakeSession();
		const requests: string[] = [];
		session.context.gate = new PermissionGate((req) => requests.push(req.id));
		const { service } = makeService({ runner, session });
		const receipt = await service.dispatch("parent", { tasks: [{ agent: "scout", task: "t" }] });
		const runId = (receipt.runs[0] as SubagentPanelRun).runId;
		const handle = await runner.next();
		handle.start();
		const confirm = handle.deps.gate.confirm("[scout] write", "notes/map.md", { kind: "path" });
		expect(requests).toHaveLength(1);
		const run = service.getRun(runId) as SubagentPanelRun;
		expect(run.status).toBe("waiting_approval");
		expect(run.pendingApprovalIds).toEqual(requests);
		session.context.gate.respond(requests[0] as string, "allow");
		await expect(confirm).resolves.toBe(true);
		await flush();
		expect(service.getRun(runId)?.status).toBe("running");
		expect(service.getRun(runId)?.pendingApprovalIds).toEqual([]);
	});

	it("上级请求待回复 → needs_reply；回复后回到 running", async () => {
		const runner = fakeRunner();
		const session = fakeSession();
		const { service } = makeService({ runner, session });
		const receipt = await service.dispatch("parent", { tasks: [{ agent: "scout", task: "t" }] });
		const runId = (receipt.runs[0] as SubagentPanelRun).runId;
		const handle = await runner.next();
		handle.start({
			supervisorRequest: { id: "q1", reason: "need_decision", message: "which version?", expectsReply: true },
		});
		expect(service.getRun(runId)?.status).toBe("needs_reply");
		handle.start({ supervisorRequest: null });
		expect(service.getRun(runId)?.status).toBe("running");
	});
});

describe("SubagentPanelService · 校验与边界", () => {
	it("未信任项目：项目级定义不可派发（明确报错）；信任项目但未勾选确认同样拒绝", async () => {
		const runner = fakeRunner();
		const session = fakeSession();
		const untrusted = makeService({ runner, session, projectTrusted: false });
		await expect(
			untrusted.service.dispatch("parent", { tasks: [{ agent: "data-checker", task: "t" }] }),
		).rejects.toThrow(/project-level subagent and this project is not trusted/);
		const trusted = makeService({ runner, session });
		await expect(
			trusted.service.dispatch("parent", { tasks: [{ agent: "data-checker", task: "t" }] }),
		).rejects.toThrow(/confirm the project definitions/);
		await expect(
			trusted.service.dispatch("parent", {
				tasks: [{ agent: "data-checker", task: "t" }],
				trustProjectAgents: true,
			}),
		).resolves.toMatchObject({ runs: [{ agent: "data-checker", source: "project" }] });
		expect(runner.runs).toHaveLength(1);
	});

	it("required_tools 不在工具集 / 未知 agent / 空任务 / 超过 8 个 / 只读会话：整批拒绝，不启动任何子会话", async () => {
		const runner = fakeRunner();
		const session = fakeSession();
		const { service } = makeService({ runner, session });
		await expect(
			service.dispatch("parent", { tasks: [{ agent: "scout", task: "t", requiredTools: ["bash"] }] }),
		).rejects.toThrow(/missing required tools: bash/);
		await expect(service.dispatch("parent", { tasks: [{ agent: "ghost", task: "t" }] })).rejects.toThrow(
			/unknown subagent "ghost"/,
		);
		await expect(service.dispatch("parent", { tasks: [{ agent: "scout", task: "  " }] })).rejects.toThrow(
			/describe what scout should do/,
		);
		await expect(
			service.dispatch("parent", {
				tasks: Array.from({ length: 9 }, () => ({ agent: "scout", task: "t" })),
			}),
		).rejects.toThrow(/At most 8 tasks/);
		await expect(service.dispatch("parent", { tasks: [] })).rejects.toThrow(/at least one task/);
		await expect(service.dispatch("missing", { tasks: [{ agent: "scout", task: "t" }] })).rejects.toThrow(
			/Session not found/,
		);
		const readOnly = makeService({ runner, session, readOnly: true });
		await expect(
			readOnly.service.dispatch("parent", { tasks: [{ agent: "scout", task: "t" }] }),
		).rejects.toThrow(/Read-only/);
		expect(runner.runs).toHaveLength(0);
		expect(session.entries).toHaveLength(0);
	});

	it("listAgents：项目级定义在未信任项目里可见但 trusted=false；知识专家不出现；带并发上限与目录", async () => {
		const runner = fakeRunner();
		const session = fakeSession();
		const { service } = makeService({ runner, session, projectTrusted: false, limit: 2 });
		const snapshot = await service.listAgents("parent");
		expect(snapshot.maxConcurrent).toBe(2);
		expect(snapshot.projectTrusted).toBe(false);
		expect(snapshot.userAgentsDir).toMatch(/agents$/);
		expect(snapshot.agents.map((agent) => [agent.name, agent.trusted])).toEqual([
			["scout", true],
			["data-checker", false],
		]);
		expect(snapshot.agents[0]?.tools).toEqual(SCOUT.tools);
	});

	it("listRuns 按会话过滤且按创建序；disposeSession 中止未完成运行并清空登记", async () => {
		const runner = fakeRunner();
		const session = fakeSession();
		const { service } = makeService({ runner, session });
		await service.dispatch("parent", {
			tasks: [
				{ agent: "scout", task: "a" },
				{ agent: "scout", task: "b" },
			],
		});
		expect(service.listRuns("parent").map((run) => run.task)).toEqual(["a", "b"]);
		expect(service.listRuns("other")).toEqual([]);
		const handle = await runner.next();
		handle.start();
		service.disposeSession("parent");
		expect(handle.input.signal?.aborted).toBe(true);
		expect(service.listRuns("parent")).toEqual([]);
	});

	it("formatSubagentFollowUp：状态 / 任务 / 结论 / 子会话文件都在，且提示由用户派发", () => {
		const text = formatSubagentFollowUp({
			runId: "r",
			dispatchId: "d",
			parentSessionId: "p",
			agent: "scout",
			source: "builtin",
			task: "map the rules",
			cwd: "/proj",
			requiredTools: [],
			followUp: true,
			status: "done",
			contextState: "pending",
			createdAt: 1,
			content: "five fields",
			sessionFile: "/tmp/s.jsonl",
			pendingApprovalIds: [],
		});
		expect(text).toContain("dispatched by the user");
		expect(text).toContain("Agent: scout · Status: completed");
		expect(text).toContain("Task: map the rules");
		expect(text).toContain("five fields");
		expect(text).toContain("/tmp/s.jsonl");
	});
});

describe("toSessionMessages · 面板记录回放", () => {
	const base: SubagentPanelRun = {
		runId: "r1",
		dispatchId: "d1",
		parentSessionId: "p",
		agent: "scout",
		source: "builtin",
		task: "map",
		cwd: "/proj",
		requiredTools: [],
		followUp: true,
		status: "queued",
		contextState: "none",
		createdAt: 100,
		pendingApprovalIds: [],
	};
	const dispatchRaw = {
		role: "custom",
		customType: SUBAGENT_DISPATCH_CUSTOM_TYPE,
		details: { v: 1, dispatchId: "d1", runs: [base, { ...base, runId: "r2", task: "second" }] },
		timestamp: 100,
	};

	it("派发记录建一行（两个 run），结果记录原地更新同一 run；followUp 消息 = 已进入上下文", () => {
		const resultRaw = {
			role: "custom",
			customType: SUBAGENT_RESULT_CUSTOM_TYPE,
			details: {
				v: 1,
				run: { ...base, status: "done", content: "ok", contextState: "pending", endedAt: 200 },
			},
			timestamp: 200,
		};
		const messages = toSessionMessages([dispatchRaw, resultRaw], { liveSubagentRunIds: new Set(["r2"]) });
		expect(messages).toHaveLength(1);
		const row = messages[0];
		if (row?.role !== "subagent") throw new Error("expected subagent row");
		expect(row.runs).toHaveLength(2);
		expect(row.runs[0]?.panel?.status).toBe("done");
		expect(row.runs[0]?.panel?.contextState).toBe("delivered");
		expect(row.runs[0]?.status).toBe("done");
		// r2 仍在进程内运行：保持 queued
		expect(row.runs[1]?.panel?.status).toBe("queued");
	});

	it("未到终态且不在进程内的运行按已中止显示（进程重启后的历史）", () => {
		const messages = toSessionMessages([dispatchRaw]);
		const row = messages[0];
		if (row?.role !== "subagent") throw new Error("expected subagent row");
		expect(row.runs.map((run) => run.panel?.status)).toEqual(["aborted", "aborted"]);
	});

	it("只有结果记录（派发条目缺失）也能单独建行；非面板 custom 消息忽略", () => {
		const messages = toSessionMessages([
			{ role: "custom", customType: "todo-reminder", content: "x", timestamp: 1 },
			{
				role: "custom",
				customType: SUBAGENT_RESULT_CUSTOM_TYPE,
				details: { v: 1, run: { ...base, status: "error", error: "boom", followUp: false } },
				timestamp: 300,
			},
		]);
		expect(messages).toHaveLength(1);
		const row = messages[0];
		if (row?.role !== "subagent") throw new Error("expected subagent row");
		expect(row.runs[0]?.status).toBe("error");
		expect(row.runs[0]?.panel?.contextState).toBe("none");
	});
});
