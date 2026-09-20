import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
	isSubagentRunSettled,
	PROTECTED_KNOWLEDGE_AGENTS,
	type SessionEvent,
	SUBAGENT_DISPATCH_CUSTOM_TYPE,
	SUBAGENT_PANEL_MAX_TASKS,
	SUBAGENT_RESULT_CUSTOM_TYPE,
	type SubagentDispatchInput,
	type SubagentDispatchReceipt,
	type SubagentDispatchRecord,
	type SubagentPanelAgent,
	type SubagentPanelRun,
	type SubagentPanelSnapshot,
	type SubagentResultRecord,
	subagentResultRecordFromUnknown,
} from "@drone/shared";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { PermissionGate, type PermissionRequestMeta } from "../../permissions/gate";
import { discoverAgents as discoverAgentsDefault, type SubagentDefinition } from "./agents";
import {
	assertSubagentTools,
	type RunSubagentDeps,
	type RunSubagentInput,
	resolveSubagentMcpAccess,
	runSubagent as runSubagentDefault,
	type SingleResult,
} from "./runner";
import { nativeSubagentProjectLimit } from "./slots";

/** 结论写进记录 / 上下文的上限（与 subagent 工具 MAX_CONTENT 同量级，IPC 事件不带巨块） */
const MAX_RESULT_CONTENT = 50_000;
/** 每个 run 的进度事件最小间隔（子会话每个工具事件都会 onProgress；状态翻转不受节流） */
const PROGRESS_THROTTLE_MS = 120;

/** 面板派发所需的父会话上下文（PiBackend 从 registry 解析） */
export interface SubagentPanelSessionContext {
	session: Pick<AgentSession, "sendCustomMessage" | "sessionManager" | "isStreaming" | "model">;
	cwd: string;
	readOnly: boolean;
	projectTrusted: boolean;
	gate: PermissionGate;
}

export interface SubagentPanelServiceOptions {
	/** runner 依赖（gate 由每次派发按父会话注入并包一层归因） */
	runner: Omit<RunSubagentDeps, "gate">;
	resolveSession: (sessionId: string) => SubagentPanelSessionContext | undefined;
	/** 推送 `subagent_run` 事件到父会话订阅方 */
	emit: (sessionId: string, event: Extract<SessionEvent, { type: "subagent_run" }>) => void;
	/** 可注入（测试）：运行器 / 发现器 / 时钟 / 目录 */
	run?: (deps: RunSubagentDeps, input: RunSubagentInput) => Promise<SingleResult>;
	discover?: typeof discoverAgentsDefault;
	projectLimit?: (cwd: string) => Promise<number>;
	now?: () => number;
	agentDir?: string;
	log?: { warn: (message: string, ...args: unknown[]) => void };
}

interface RunRecord {
	run: SubagentPanelRun;
	controller: AbortController;
	lastEmitAt: number;
	pendingEmit: ReturnType<typeof setTimeout> | null;
}

/**
 * 把子会话的权限确认归因到某个面板运行：confirm 经父会话 gate（同一审批坞、同一份项目记忆），
 * 这里只记录「此刻挂在 gate 上的请求 id 属于哪个 run」，让运行卡与审批坞能互相指向。
 */
class RunScopedGate extends PermissionGate {
	private pendingIds: string[] = [];

	constructor(
		private readonly inner: PermissionGate,
		private readonly onPending: (ids: string[]) => void,
	) {
		super(() => {});
	}

	override confirm(title: string, message: string, meta?: PermissionRequestMeta): Promise<boolean> {
		const before = new Set(this.inner.listPending().map((request) => request.id));
		const promise = this.inner.confirm(title, message, meta);
		const added = this.inner
			.listPending()
			.map((request) => request.id)
			.filter((id) => !before.has(id));
		if (added.length === 0) return promise;
		this.pendingIds.push(...added);
		this.onPending([...this.pendingIds]);
		return promise.finally(() => {
			this.pendingIds = this.pendingIds.filter((id) => !added.includes(id));
			this.onPending([...this.pendingIds]);
		});
	}
}

function truncateContent(text: string | undefined): string | undefined {
	if (!text) return text;
	return text.length <= MAX_RESULT_CONTENT ? text : `${text.slice(0, MAX_RESULT_CONTENT)}\n[truncated]`;
}

/** 主模型可见的 followUp 文本：状态 + 任务 + 结论（不是整份子会话记录） */
export function formatSubagentFollowUp(run: SubagentPanelRun): string {
	const status =
		run.status === "done" ? "completed" : run.status === "aborted" ? "aborted by the user" : "failed";
	const lines = [
		`Subagent result (dispatched by the user from the subagent panel, not by you)`,
		`Agent: ${run.agent} · Status: ${status}${run.model ? ` · Model: ${run.model}` : ""}`,
		`Task: ${run.task}`,
	];
	if (run.error) lines.push(`Error: ${run.error}`);
	if (run.sessionFile) lines.push(`Child session: ${run.sessionFile}`);
	lines.push("---");
	lines.push(run.content?.trim() || "(no conclusion text)");
	lines.push("---");
	lines.push("Integrate what is useful into the current work and tell the user briefly what changed.");
	return lines.join("\n");
}

/**
 * 子智能体面板服务：会话内专属派发的登记表 + 调度 + 结果入会话。
 *
 * - 派发走 runSubagent（与模型调用 subagent 工具同一条运行时路径：权限 gate、互斥、
 *   required_tools 校验、运行槽排队、子会话文件），只多一层「谁派发的」登记。
 * - 排队 = withNativeSubagentSlot 的排队；首个 onProgress（子会话已创建）即 running。
 * - 完成后：followUp 勾选 → drone-subagent-result custom 消息进入上下文（主模型忙则排 followUp 队列）；
 *   未勾选 / 失败 / 中止 → 只落 custom entry（模型不可见），结果卡靠回放解释。
 * - 中止 = AbortController → 排队中取消 / 运行中 session.abort()，父会话得到「已中止」结果，不算失败。
 */
export class SubagentPanelService {
	private readonly records = new Map<string, RunRecord>();
	private readonly run: (deps: RunSubagentDeps, input: RunSubagentInput) => Promise<SingleResult>;
	private readonly discover: typeof discoverAgentsDefault;
	private readonly projectLimit: (cwd: string) => Promise<number>;
	private readonly now: () => number;

	constructor(private readonly options: SubagentPanelServiceOptions) {
		this.run = options.run ?? runSubagentDefault;
		this.discover = options.discover ?? discoverAgentsDefault;
		this.projectLimit = options.projectLimit ?? nativeSubagentProjectLimit;
		this.now = options.now ?? (() => Date.now());
	}

	/** 会话可见的子智能体：内置 + 用户级 + 项目级（未信任项目仍列出但 trusted=false）；知识专家不出现 */
	async listAgents(sessionId: string): Promise<SubagentPanelSnapshot> {
		const ctx = this.requireContext(sessionId);
		const agentDir = this.options.agentDir ?? getAgentDir();
		// projectTrusted:true 只为「看见」项目级定义（不执行）；可派发与否由 trusted 标记与派发校验决定
		const all = await this.discover(ctx.cwd, { projectTrusted: true, agentDir });
		const visible = all.filter(
			(agent) => !PROTECTED_KNOWLEDGE_AGENTS.some((item) => item.name === agent.name),
		);
		const agents: SubagentPanelAgent[] = await Promise.all(
			visible.map(async (agent) => ({
				name: agent.name,
				description: agent.description,
				source: agent.source,
				tools: [...agent.tools],
				model: agent.model,
				mcpAccess: await resolveSubagentMcpAccess(ctx.cwd, agent, ctx.projectTrusted),
				trusted: agent.source !== "project" || ctx.projectTrusted,
				path: agent.path,
			})),
		);
		return {
			sessionId,
			cwd: ctx.cwd,
			agents,
			maxConcurrent: await this.projectLimit(ctx.cwd),
			projectTrusted: ctx.projectTrusted,
			userAgentsDir: join(agentDir, "agents"),
			projectAgentsDir: join(ctx.cwd, ".pi", "agents"),
			readOnly: ctx.readOnly,
		};
	}

	listRuns(sessionId: string): SubagentPanelRun[] {
		return [...this.records.values()]
			.filter((record) => record.run.parentSessionId === sessionId)
			.map((record) => ({ ...record.run }))
			.sort((a, b) => a.createdAt - b.createdAt);
	}

	getRun(runId: string): SubagentPanelRun | undefined {
		const record = this.records.get(runId);
		return record ? { ...record.run } : undefined;
	}

	/** 校验 + 登记 + 启动；校验失败整批拒绝（不会启动任何子会话） */
	async dispatch(sessionId: string, input: SubagentDispatchInput): Promise<SubagentDispatchReceipt> {
		const ctx = this.requireContext(sessionId);
		if (ctx.readOnly) throw new Error("Read-only sessions cannot dispatch subagents");
		const tasks = Array.isArray(input?.tasks) ? input.tasks : [];
		if (tasks.length === 0) throw new Error("Nothing to dispatch: add at least one task");
		if (tasks.length > SUBAGENT_PANEL_MAX_TASKS)
			throw new Error(`At most ${SUBAGENT_PANEL_MAX_TASKS} tasks per dispatch`);
		const cwd = typeof input.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : ctx.cwd;
		const agentDir = this.options.agentDir ?? getAgentDir();
		const trustedAgents = await this.discover(cwd, { projectTrusted: ctx.projectTrusted, agentDir });
		const definitions: Array<{ agent: SubagentDefinition; task: string; requiredTools: string[] }> = [];
		for (const [index, item] of tasks.entries()) {
			const name = typeof item.agent === "string" ? item.agent.trim() : "";
			const task = typeof item.task === "string" ? item.task.trim() : "";
			if (!name) throw new Error(`Task ${index + 1}: choose a subagent`);
			if (!task) throw new Error(`Task ${index + 1}: describe what ${name} should do`);
			if (PROTECTED_KNOWLEDGE_AGENTS.some((agent) => agent.name === name))
				throw new Error(`Task ${index + 1}: ${name} is a knowledge specialist and cannot be dispatched here`);
			const agent = trustedAgents.find((candidate) => candidate.name === name);
			if (!agent) {
				if (!ctx.projectTrusted) {
					const projectAgents = await this.discover(cwd, { projectTrusted: true, agentDir });
					if (projectAgents.some((candidate) => candidate.name === name && candidate.source === "project"))
						throw new Error(
							`Task ${index + 1}: ${name} is a project-level subagent and this project is not trusted`,
						);
				}
				throw new Error(
					`Task ${index + 1}: unknown subagent "${name}". Available: ${trustedAgents
						.filter((candidate) => !PROTECTED_KNOWLEDGE_AGENTS.some((p) => p.name === candidate.name))
						.map((candidate) => candidate.name)
						.join(", ")}`,
				);
			}
			if (agent.source === "project" && input.trustProjectAgents !== true)
				throw new Error(
					`Task ${index + 1}: ${name} comes from this project's .pi/agents; confirm the project definitions before dispatching`,
				);
			const requiredTools = Array.isArray(item.requiredTools)
				? item.requiredTools.filter((tool): tool is string => typeof tool === "string" && tool.length > 0)
				: [];
			try {
				assertSubagentTools(agent.tools, requiredTools);
			} catch (error) {
				throw new Error(`Task ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
			}
			definitions.push({ agent, task, requiredTools });
		}

		const dispatchId = randomUUID();
		const createdAt = this.now();
		const followUp = input.followUp !== false;
		const runs: SubagentPanelRun[] = definitions.map(({ agent, task, requiredTools }, index) => ({
			runId: randomUUID(),
			dispatchId,
			parentSessionId: sessionId,
			agent: agent.name,
			source: agent.source,
			task,
			cwd,
			requiredTools,
			followUp,
			status: "queued",
			contextState: "none",
			queuePosition: index + 1,
			createdAt: createdAt + index,
			pendingApprovalIds: [],
		}));
		for (const run of runs) {
			this.records.set(run.runId, {
				run,
				controller: new AbortController(),
				lastEmitAt: 0,
				pendingEmit: null,
			});
		}
		// 派发条目：custom entry（模型不可见），重开会话仍能解释「这个子智能体是谁派发的」
		this.appendEntry(ctx, SUBAGENT_DISPATCH_CUSTOM_TYPE, {
			v: 1,
			dispatchId,
			runs: runs.map((run) => ({ ...run })),
		} satisfies SubagentDispatchRecord);
		this.refreshQueuePositions(sessionId);
		for (const run of runs) this.emitRun(run.runId, true);
		for (const [index, run] of runs.entries()) {
			const definition = definitions[index];
			if (definition) void this.execute(run.runId, definition.agent, ctx);
		}
		return { dispatchId, runs: runs.map((run) => ({ ...run })) };
	}

	/** 排队中 = 取消；运行中 = abort 子会话；终态 / 未知 → false */
	abort(runId: string): boolean {
		const record = this.records.get(runId);
		if (!record || isSubagentRunSettled(record.run.status)) return false;
		record.controller.abort();
		return true;
	}

	/** 父会话事件观察：结果 custom 消息被主模型消费（message_end）→ 已进入上下文 */
	observe(sessionId: string, event: SessionEvent): void {
		if (event.type !== "message_end") return;
		const message = event.message as { role?: string; customType?: string; details?: unknown };
		if (message.role !== "custom" || message.customType !== SUBAGENT_RESULT_CUSTOM_TYPE) return;
		const record = subagentResultRecordFromUnknown(message.details);
		if (!record) return;
		const entry = this.records.get(record.run.runId);
		if (!entry || entry.run.parentSessionId !== sessionId || entry.run.contextState === "delivered") return;
		entry.run.contextState = "delivered";
		this.emitRun(entry.run.runId, true);
	}

	/** 会话关闭：中止其全部未完成运行并清掉登记（不再推送事件） */
	disposeSession(sessionId: string): void {
		for (const [runId, record] of this.records) {
			if (record.run.parentSessionId !== sessionId) continue;
			if (!isSubagentRunSettled(record.run.status)) record.controller.abort();
			if (record.pendingEmit) clearTimeout(record.pendingEmit);
			this.records.delete(runId);
		}
	}

	private requireContext(sessionId: string): SubagentPanelSessionContext {
		const ctx = this.options.resolveSession(sessionId);
		if (!ctx) throw new Error(`Session not found: ${sessionId}`);
		return ctx;
	}

	private async execute(
		runId: string,
		agent: SubagentDefinition,
		ctx: SubagentPanelSessionContext,
	): Promise<void> {
		const record = this.records.get(runId);
		if (!record) return;
		const gate = new RunScopedGate(ctx.gate, (ids) => {
			const current = this.records.get(runId);
			if (!current || isSubagentRunSettled(current.run.status)) return;
			current.run.pendingApprovalIds = ids;
			this.applyLiveStatus(current.run);
			this.emitRun(runId, true);
		});
		let result: SingleResult | undefined;
		let failure: string | undefined;
		try {
			result = await this.run(
				{ ...this.options.runner, gate },
				{
					agent,
					task: record.run.task,
					requiredTools: record.run.requiredTools,
					cwd: record.run.cwd,
					projectTrusted: ctx.projectTrusted,
					model: ctx.session.model ?? undefined,
					signal: record.controller.signal,
					onProgress: (progress) => this.progress(runId, progress),
				},
			);
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		}
		const current = this.records.get(runId);
		if (!current) return; // 会话已关闭
		const run = current.run;
		if (result) this.copyProgress(run, result);
		run.endedAt = this.now();
		run.pendingApprovalIds = [];
		run.supervisorRequest = null;
		run.queuePosition = undefined;
		const aborted = current.controller.signal.aborted;
		if (aborted) {
			run.status = "aborted";
			run.error = undefined;
		} else if (failure || (result && (result.exitCode !== 0 || result.error))) {
			run.status = "error";
			run.error = failure ?? result?.error ?? `exit ${result?.exitCode ?? 1}`;
		} else {
			run.status = "done";
			run.error = undefined;
		}
		run.content = truncateContent(result?.content);
		this.refreshQueuePositions(run.parentSessionId);
		this.deliverResult(run, ctx);
		this.emitRun(runId, true);
	}

	/** 结果入会话：done + followUp → custom 消息（进上下文）；其余 → custom entry（模型不可见） */
	private deliverResult(run: SubagentPanelRun, ctx: SubagentPanelSessionContext): void {
		if (run.status === "done" && run.followUp) {
			run.contextState = "pending";
			const record: SubagentResultRecord = { v: 1, run: { ...run } };
			// 空闲：triggerTurn 立即开一轮（结果作为本轮消息）；忙碌：排 followUp 队列，本轮结束后进入。
			// 不 await 整轮生成——空闲路径的 sendCustomMessage 会等到 agent 结束才 resolve。
			const message = {
				customType: SUBAGENT_RESULT_CUSTOM_TYPE,
				content: formatSubagentFollowUp(run),
				display: true,
				details: record,
			};
			const options = ctx.session.isStreaming
				? { triggerTurn: true, deliverAs: "followUp" as const }
				: { triggerTurn: true };
			Promise.resolve()
				.then(() => ctx.session.sendCustomMessage(message, options))
				.catch((error: unknown) => {
					this.options.log?.warn("subagent follow-up failed", error);
					const current = this.records.get(run.runId);
					if (current && current.run.contextState === "pending") {
						current.run.contextState = "none";
						this.emitRun(run.runId, true);
					}
				});
			return;
		}
		run.contextState = "none";
		this.appendEntry(ctx, SUBAGENT_RESULT_CUSTOM_TYPE, {
			v: 1,
			run: { ...run },
		} satisfies SubagentResultRecord);
	}

	private appendEntry(ctx: SubagentPanelSessionContext, customType: string, data: unknown): void {
		try {
			ctx.session.sessionManager.appendCustomEntry(customType, data);
		} catch (error) {
			this.options.log?.warn("subagent panel entry not persisted", error);
		}
	}

	private progress(runId: string, progress: SingleResult): void {
		const record = this.records.get(runId);
		if (!record || isSubagentRunSettled(record.run.status)) return;
		const run = record.run;
		const wasQueued = run.status === "queued";
		this.copyProgress(run, progress);
		if (wasQueued) {
			// 首个 onProgress = 子会话已创建（运行槽已拿到）：离开排队态
			run.status = "running";
			run.queuePosition = undefined;
			run.startedAt = progress.startedAt ?? this.now();
			this.refreshQueuePositions(run.parentSessionId);
		}
		const before = run.status;
		this.applyLiveStatus(run);
		this.emitRun(runId, wasQueued || before !== run.status);
	}

	private copyProgress(run: SubagentPanelRun, progress: SingleResult): void {
		run.childSessionId = progress.sessionId ?? run.childSessionId;
		run.sessionFile = progress.artifactPaths.jsonlPath ?? run.sessionFile;
		run.model = progress.model ?? run.model;
		const total = progress.usage.totalTokens.tokens || progress.usage.input + progress.usage.output;
		if (total > 0) run.tokens = total;
		run.exitCode = progress.exitCode;
		run.statusText = progress.statusText;
		run.statusPhase = progress.statusPhase;
		run.currentAction = progress.currentAction;
		run.currentTool = progress.currentTool;
		run.lastSteerAt = progress.lastSteerAt;
		run.supervisorRequest = progress.supervisorRequest;
		if (progress.startedAt) run.startedAt = progress.startedAt;
	}

	/** running 子态：需要回复 > 等待审批 > 运行中 */
	private applyLiveStatus(run: SubagentPanelRun): void {
		if (run.status === "queued" || isSubagentRunSettled(run.status)) return;
		if (run.supervisorRequest?.expectsReply) run.status = "needs_reply";
		else if (run.pendingApprovalIds.length > 0) run.status = "waiting_approval";
		else run.status = "running";
	}

	private refreshQueuePositions(sessionId: string): void {
		const queued = [...this.records.values()]
			.filter((record) => record.run.parentSessionId === sessionId && record.run.status === "queued")
			.sort((a, b) => a.run.createdAt - b.run.createdAt);
		queued.forEach((record, index) => {
			record.run.queuePosition = index + 1;
		});
	}

	/** 推送整条记录；非状态翻转的进度按 PROGRESS_THROTTLE_MS 合并（尾沿必发） */
	private emitRun(runId: string, immediate: boolean): void {
		const record = this.records.get(runId);
		if (!record) return;
		const send = () => {
			record.pendingEmit = null;
			record.lastEmitAt = this.now();
			this.options.emit(record.run.parentSessionId, { type: "subagent_run", run: { ...record.run } });
		};
		if (immediate) {
			if (record.pendingEmit) {
				clearTimeout(record.pendingEmit);
				record.pendingEmit = null;
			}
			send();
			return;
		}
		if (record.pendingEmit) return;
		const wait = Math.max(0, PROGRESS_THROTTLE_MS - (this.now() - record.lastEmitAt));
		if (wait === 0) {
			send();
			return;
		}
		record.pendingEmit = setTimeout(send, wait);
	}
}
