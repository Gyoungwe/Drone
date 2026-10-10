import type {
	ContextUsageInfo,
	ImageInput,
	PermissionRequest,
	PromptReceipt,
	SessionStats,
} from "@drone/shared";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { CapabilityRuntime } from "../capabilities/runtime";
import { isTaskStatusQuery } from "../capabilities/runtime";
import { createLogger } from "../log";
import { inboxFor } from "../session/durable-inbox";
import type { ModelWaitMonitor } from "../session/model-wait";
import type { EventRateTracker } from "../session/rates";
import type { SessionRecovery } from "../session/recovery";
import type { SessionRegistry } from "../session/registry";
import type { ModelRuntime, SessionEngine } from "../session-engine/engine";
import type { ApprovalService } from "./approvals";

const log = createLogger("backend");

export interface SessionControlHost {
	readonly sessionEngine: SessionEngine;
	readonly recovery: SessionRecovery;
	readonly modelWait: ModelWaitMonitor;
	readonly eventRates: EventRateTracker;
	readonly registry: SessionRegistry;
	readonly capabilityRuntimes: Map<string, CapabilityRuntime>;
	readonly approvals: ApprovalService;
	getModelRuntime(): Promise<ModelRuntime>;
	requireSession(id: string): { session: AgentSession; readOnly?: boolean };
	log: { info: (message: string, ...args: unknown[]) => void };
}

export class SessionControlService {
	constructor(private readonly host: SessionControlHost) {}

	async prompt(
		sessionId: string,
		text: string,
		images?: ImageInput[],
		requestId?: string,
	): Promise<PromptReceipt> {
		const entry = this.host.requireSession(sessionId);
		if (entry.readOnly) throw new Error("Session is read-only (subagent transcript)");
		if (this.host.recovery.isRecovering(sessionId))
			throw new Error("Wait for answer recovery to finish or stop it before sending a new task");
		if (!images?.length && isTaskStatusQuery(text) && entry.session.extensionRunner.getCommand("task-status"))
			text = "/task-status";
		log.info("prompt", sessionId, {
			text: text.slice(0, 120),
			images: images?.length ?? 0,
		});
		// Extension commands execute before the SDK emits `input`, so lazy capability loading
		// must happen here as well; otherwise /obsidian-setup cannot see research-vault.
		this.host.capabilityRuntimes.get(sessionId)?.prepareForPrompt(text, entry.session.isStreaming);
		// Own prompt lifecycle classification at this seam. The renderer cannot know which
		// slash commands are extension commands, and extension commands emit no agent events.
		const spaceIndex = text.indexOf(" ");
		const commandName = text.startsWith("/") ? text.slice(1, spaceIndex === -1 ? undefined : spaceIndex) : "";
		const isExtensionCommand = !!commandName && !!entry.session.extensionRunner.getCommand(commandName);
		const receipt: PromptReceipt = isExtensionCommand
			? { kind: "command" }
			: entry.session.isStreaming
				? { kind: "queued" }
				: { kind: "agent" };
		// 持久化队列 + requestId 去重：排队消息崩溃后可恢复；重复提交（双击 / IPC 重试）不再二次投递。
		// 带图片的消息无法完整持久化，不进入持久队列。
		const sessionFile = entry.session.sessionFile;
		if (sessionFile && !isExtensionCommand && !images?.length && (receipt.kind === "queued" || requestId)) {
			try {
				if (!inboxFor(sessionFile).accept(text, requestId, receipt.kind === "queued")) {
					log.info("duplicate prompt ignored", sessionId, { requestId });
					return receipt;
				}
			} catch (error) {
				log.info("durable inbox unavailable", sessionId, { error: String(error) });
			}
		}
		// session.prompt() 非流式路径会 await 整个 run（直到 agent_settled）；渲染端只需要
		// “已受理/已入队”回执——用 preflightResult 提前返回，否则 IPC 挂一整轮，渲染端
		// sending 状态被占住，运行中的 followUp 排队发送被防重发守卫静默拦截。
		// preflight 前抛错（无模型/无 key/compaction 中）照常 reject 传给渲染端；
		// ack 之后 run 期错误不再回传（走事件流呈现），then 的 reject 在已 resolve 后为 no-op。
		// preflightResult(false) 只在 SDK catch 里紧随 throw 触发，不据此 reject，真实错误经 throw 传递。
		await new Promise<void>((resolve, reject) => {
			this.host.sessionEngine
				.prompt(entry.session, text, {
					// 运行中发送走 followUp 排队（agent 完成后自动投递；steer 打断暂不支持）
					// SDK 要求 streaming 时必传 streamingBehavior，否则抛错
					streamingBehavior: "followUp",
					images: images?.map((image) => ({
						type: "image" as const,
						data: image.data,
						mimeType: image.mimeType,
					})),
					preflightResult: (ok) => {
						if (ok) resolve();
					},
				})
				.then(
					() => resolve(),
					(err) => reject(err),
				);
		});
		return receipt;
	}

	async retry(sessionId: string, requestId: string, expectedUserTimestamp?: number): Promise<PromptReceipt> {
		const entry = this.host.requireSession(sessionId);
		if (entry.readOnly) throw new Error("Session is read-only (subagent transcript)");
		return this.host.recovery.retry(entry.session, requestId, expectedUserTimestamp);
	}

	async abort(sessionId: string): Promise<void> {
		this.host.modelWait.cleanup(sessionId);
		const entry = this.host.registry.get(sessionId);
		if (!entry) return;
		log.info("abort", sessionId);
		await this.host.sessionEngine.abort(entry.session);
	}

	/** LAN 远程写端点前置检查（registry 直查，无磁盘 IO）。 */
	checkSessionWritable(sessionId: string): "ok" | "not_found" | "read_only" {
		const entry = this.host.registry.get(sessionId);
		if (!entry) return "not_found";
		if (entry.readOnly) return "read_only";
		return "ok";
	}

	/** 清空运行中排队消息（steer+followUp 都清），返回被清内容；无会话返回空 */
	async clearQueue(sessionId: string): Promise<{ steering: string[]; followUp: string[] }> {
		const entry = this.host.registry.get(sessionId);
		if (!entry) return { steering: [], followUp: [] };
		log.info("clearQueue", sessionId);
		return this.host.sessionEngine.clearQueue(entry.session);
	}

	/** 当前排队的 followUp 消息文本；无会话返回空 */
	async getFollowUpMessages(sessionId: string): Promise<string[]> {
		const entry = this.host.registry.get(sessionId);
		if (!entry) return [];
		return [...entry.session.getFollowUpMessages()];
	}

	async setModel(sessionId: string, provider: string, modelId: string): Promise<void> {
		const entry = this.host.requireSession(sessionId);
		if (entry.readOnly) throw new Error("Session is read-only (subagent transcript)");
		const runtime = await this.host.getModelRuntime();
		const model = runtime.getModel(provider, modelId);
		if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
		await this.host.sessionEngine.setModel(entry.session, model);
	}

	async setThinkingLevel(sessionId: string, level: string): Promise<void> {
		const entry = this.host.requireSession(sessionId);
		if (entry.readOnly) throw new Error("Session is read-only (subagent transcript)");
		this.host.sessionEngine.setThinkingLevel(entry.session, level as ThinkingLevel);
	}

	async compact(sessionId: string, customInstructions?: string): Promise<void> {
		const entry = this.host.requireSession(sessionId);
		if (entry.readOnly) throw new Error("Cannot compact a read-only subagent transcript");
		log.info("compact", sessionId);
		await this.host.sessionEngine.compact(entry.session, customInstructions);
	}

	async getStats(sessionId: string): Promise<SessionStats> {
		const entry = this.host.requireSession(sessionId);
		const stats = entry.session.getSessionStats();
		return {
			inputTokens: stats.tokens.input,
			outputTokens: stats.tokens.output,
			cacheReadTokens: stats.tokens.cacheRead,
			cacheWriteTokens: stats.tokens.cacheWrite,
			totalTokens: stats.tokens.total,
			requests: stats.assistantMessages,
			scope: "sdk-session",
			cost: stats.cost,
		};
	}

	/** 每会话事件速率快照（心跳/临终快照数据源）：最近 60s 每秒事件数 + 最近事件时刻。
	 * 顺带回收已结束会话（subagent 子会话不走 closeSession）的残留条目。 */
	getEventRates(): Map<string, { window60s: number[]; lastEventAt: number }> {
		this.host.eventRates.prune((id) => this.host.registry.has(id));
		return this.host.eventRates.snapshot();
	}

	/** 全部活跃会话的运行态快照（只读观察者用）。 */
	listActiveSessionRuntime(): {
		sessionId: string;
		streaming: boolean;
		compacting: boolean;
	}[] {
		return this.host.registry.list().map(({ session }) => ({
			sessionId: session.sessionId,
			streaming: session.isStreaming,
			compacting: session.isCompacting,
		}));
	}

	/** 全部未决权限请求的只读快照（LAN Observer 等被动观察者用）。 */
	/** 全部未决权限请求快照（含 requestId；LAN 观察/远程应答与桌面共用） */
	/** @deprecated 通过 BackendServices.approvals.listPending 使用。 */
	getPendingPermissionRequests(): PermissionRequest[] {
		return this.host.approvals.listPending();
	}

	/** 当前模型上下文使用情况；刚压缩后 tokens 未知（null），会话无模型时 percent 为 null */
	async getContextUsage(sessionId: string): Promise<ContextUsageInfo | null> {
		const entry = this.host.requireSession(sessionId);
		const usage = entry.session.getContextUsage();
		if (!usage) return null;
		return {
			tokens: usage.tokens,
			contextWindow: usage.contextWindow,
			percent: usage.percent,
		};
	}
}
