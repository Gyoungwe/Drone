import { unlink } from "node:fs/promises";
import type {
	AskResponse,
	ContextUsageInfo,
	CreateSessionOptions,
	ImageInput,
	PermissionAnswer,
	PermissionRequest,
	PromptReceipt,
	SessionMessage,
	SessionMeta,
	SessionStats,
	TodoItem,
	TrustAnswer,
	WikiModelReviewInput,
	WikiModelReviewResult,
} from "@drone/shared";
import { createLogger } from "../log";
import { walkProjectFiles } from "../project/files";
import { TraceRecorder } from "../session/trace";
import type {
	AskHandler,
	EventHandler,
	LoginHandler,
	PermissionHandler,
	PermissionResolvedHandler,
	TrustHandler,
} from "./session-api-types";
import { SessionMessageService } from "./session-messages";
import type { ZoteroService } from "./zotero";

const log = createLogger("backend");

/** Compatibility API retained by the PiBackend façade; implementations live in focused services. */
import { SessionSettingsApi } from "./session-api-settings";

export class SessionServiceApi extends SessionSettingsApi {
	async init(): Promise<void> {
		await this.host.knowledge.connect();
		await this.host.getModelRuntime();
	}

	/** 项目文件列表（@ 补全数据源，相对路径、目录带尾 /，TTL 缓存） */
	async listProjectFiles(cwd?: string): Promise<string[]> {
		return walkProjectFiles(cwd || this.host.options.defaultCwd || process.cwd());
	}

	async createSession(options: CreateSessionOptions): Promise<SessionMeta> {
		return this.host.construction.createSession(options);
	}

	async openSession(filePath: string): Promise<SessionMeta> {
		return this.host.construction.openSession(filePath);
	}

	async listSessions(cwd?: string): Promise<SessionMeta[]> {
		return this.host.lifecycle.list(cwd);
	}

	/** 跨全部项目目录枚举会话（项目管理页用，含活跃会话） */
	async listAllSessions(): Promise<SessionMeta[]> {
		return this.host.lifecycle.listAll();
	}

	async closeSession(sessionId: string): Promise<void> {
		this.host.modelWait.cleanup(sessionId);
		this.host.knowledgeSession.disposeSession(sessionId);
		await this.host.lifecycle.close(sessionId, {
			// 面板派发的子会话随父会话关闭一起中止（登记表清空，不再推送事件）
			beforeDispose: (id: string) => this.host.subagentPanel.disposeSession(id),
			afterEngineDispose: (id: string) => {
				this.host.approvals.remove(id);
				for (const askGate of this.host.askGates.get(id) ?? []) askGate.dispose();
				this.host.askGates.delete(id);
				this.host.sessionPermissions.remove(id);
				this.host.capabilityRuntimes.delete(id);
				this.host.streamGuard.cleanup(id);
				this.host.eventRates.delete(id);
			},
			afterDispose: async (id: string) => {
				await this.host.traces.stop(id);
				log.info("session closed", id);
			},
		});
	}

	/** 删除历史会话（pi 无删除 API，会话即磁盘 jsonl，直接删文件） */
	async deleteSession(sessionId: string, sessionFile?: string): Promise<void> {
		const entry = this.host.registry.get(sessionId);
		const sessionDir = entry?.session.sessionManager.getSessionDir();
		const file = sessionFile ?? entry?.session.sessionManager.getSessionFile();
		if (entry) await this.host.closeSession(sessionId);
		if (!file) throw new Error(`Session file not found: ${sessionId}`);
		await unlink(file);
		if (sessionDir) await TraceRecorder.removeAll(sessionDir, sessionId);
		log.info("session deleted", sessionId);
	}

	/** @deprecated 通过 BackendServices.knowledgeSession.reviewWithModel 使用。 */
	async reviewKnowledgeWithModel(input: WikiModelReviewInput): Promise<WikiModelReviewResult> {
		return this.host.knowledgeSession.reviewWithModel(input);
	}

	/** @deprecated 通过 BackendServices.knowledgeSession.cancelModelReview 使用。 */
	async cancelKnowledgeModelReview({
		sessionId,
		requestId,
	}: {
		sessionId: string;
		requestId: string;
	}): Promise<void> {
		await this.host.knowledgeSession.cancelModelReview({
			sessionId,
			requestId,
		});
	}

	/** @deprecated 通过 BackendServices.knowledgeSession.startSetup 使用。 */
	async startKnowledgeSetup(input: { sessionId: string; path?: string }): Promise<void> {
		await this.host.knowledgeSession.startSetup(input);
	}

	getZoteroStatus(): ReturnType<ZoteroService["getStatus"]> {
		return this.host.zotero.getStatus();
	}
	/** @deprecated 通过 BackendServices.knowledgeSession.resumeCheck 使用。 */
	async resumeKnowledgeCheck(sessionId: string): Promise<void> {
		await this.host.knowledgeSession.resumeCheck(sessionId);
	}

	async prompt(sessionId: string, text: string, images?: ImageInput[]): Promise<PromptReceipt> {
		return this.host.control.prompt(sessionId, text, images);
	}
	async retry(sessionId: string, requestId: string, expectedUserTimestamp?: number): Promise<PromptReceipt> {
		return this.host.control.retry(sessionId, requestId, expectedUserTimestamp);
	}
	async abort(sessionId: string): Promise<void> {
		return this.host.control.abort(sessionId);
	}
	checkSessionWritable(sessionId: string): "ok" | "not_found" | "read_only" {
		return this.host.control.checkSessionWritable(sessionId);
	}
	async clearQueue(sessionId: string): Promise<{ steering: string[]; followUp: string[] }> {
		return this.host.control.clearQueue(sessionId);
	}
	async getFollowUpMessages(sessionId: string): Promise<string[]> {
		return this.host.control.getFollowUpMessages(sessionId);
	}
	async setModel(sessionId: string, provider: string, modelId: string): Promise<void> {
		return this.host.control.setModel(sessionId, provider, modelId);
	}
	async setThinkingLevel(sessionId: string, level: string): Promise<void> {
		return this.host.control.setThinkingLevel(sessionId, level);
	}
	async compact(sessionId: string, customInstructions?: string): Promise<void> {
		return this.host.control.compact(sessionId, customInstructions);
	}
	async getStats(sessionId: string): Promise<SessionStats> {
		return this.host.control.getStats(sessionId);
	}
	getEventRates(): Map<string, { window60s: number[]; lastEventAt: number }> {
		return this.host.control.getEventRates();
	}
	listActiveSessionRuntime(): {
		sessionId: string;
		streaming: boolean;
		compacting: boolean;
	}[] {
		return this.host.control.listActiveSessionRuntime();
	}
	getPendingPermissionRequests(): PermissionRequest[] {
		return this.host.control.getPendingPermissionRequests();
	}
	async getContextUsage(sessionId: string): Promise<ContextUsageInfo | null> {
		return this.host.control.getContextUsage(sessionId);
	}

	async steerSubagent(
		sessionId: string,
		message: string,
		mode: "steer" | "followUp" = "steer",
	): Promise<void> {
		const control = this.host.liveSubagents.get(sessionId);
		if (!control) throw new Error("Subagent is no longer running");
		const text = message.trim();
		if (!text) throw new Error("Steer message cannot be empty");
		await control.steer(text, mode);
	}

	replySubagentSupervisor(sessionId: string, requestId: string, message: string): void {
		const control = this.host.liveSubagents.get(sessionId);
		if (!control) throw new Error("Subagent is no longer running");
		const text = message.trim();
		if (!text) throw new Error("Supervisor reply cannot be empty");
		if (!control.reply(requestId, text)) throw new Error("Supervisor request is no longer pending");
	}

	async setSessionName(sessionId: string, name: string): Promise<void> {
		const entry = this.host.requireSession(sessionId);
		if (entry.readOnly) throw new Error("Cannot rename a read-only subagent transcript");
		this.host.sessionEngine.setSessionName(entry.session, name);
	}

	/** 导出会话内容（HTML/JSONL）；返回文件内容，由调用方保存 */
	async exportSession(sessionId: string, format: "html" | "jsonl"): Promise<string> {
		return this.host.messageService.exportSession(sessionId, format);
	}

	async getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
		return this.host.messageService.getSessionMessages(sessionId);
	}

	async peekSubagentMessages(filePath: string): Promise<SessionMessage[]> {
		return this.host.messageService.peekSubagentMessages(filePath);
	}

	async peekSessionMessages(sessionId: string): Promise<SessionMessage[] | null> {
		return this.host.messageService.peekSessionMessages(sessionId);
	}

	async getTodos(sessionId: string): Promise<TodoItem[]> {
		return this.host.messageService.getTodos(sessionId);
	}

	async forkSession(sessionId: string, ref: { entryId?: string; text?: string }): Promise<SessionMeta> {
		return this.host.messageService.forkSession(sessionId, ref);
	}

	static readonly RECALLED_MARKER_TYPE = SessionMessageService.RECALLED_MARKER_TYPE;

	async recallMessage(
		sessionId: string,
		ref: { entryId?: string; text?: string; timestamp?: number },
	): Promise<{ text: string; images: ImageInput[] }> {
		return this.host.messageService.recallMessage(sessionId, ref);
	}

	onEvent(handler: EventHandler): () => void {
		return this.host.getEventService().onEvent(handler);
	}

	onAskRequest(handler: AskHandler): () => void {
		this.host.askHandlers.add(handler);
		return () => this.host.askHandlers.delete(handler);
	}

	respondAsk(requestId: string, response: AskResponse): boolean {
		for (const gates of this.host.askGates.values()) {
			for (const gate of gates) {
				if (gate.respond(requestId, response)) return true;
			}
		}
		return false;
	}

	/** @deprecated 通过 BackendServices.approvals.onRequest 使用。 */
	onPermissionRequest(handler: PermissionHandler): () => void {
		return this.host.approvals.onRequest(handler);
	}

	/** 权限请求被桌面端实际应答后通知被动观察者。 */
	/** @deprecated 通过 BackendServices.approvals.onResolved 使用。 */
	onPermissionResolved(handler: PermissionResolvedHandler): () => void {
		return this.host.approvals.onResolved(handler);
	}

	onTrustRequest(handler: TrustHandler): () => void {
		this.host.trustHandlers.add(handler);
		return () => this.host.trustHandlers.delete(handler);
	}

	onLoginEvent(handler: LoginHandler): () => void {
		this.host.loginHandlers.add(handler);
		return () => this.host.loginHandlers.delete(handler);
	}

	/** @deprecated 通过 BackendServices.approvals.respond 使用。 */
	respondPermission(requestId: string, answer: PermissionAnswer): void {
		const sessionId = this.host.approvals.respond(requestId, answer);
		if (answer === "allowRun" && sessionId) log.info("permission allowRun", sessionId, { requestId });
	}

	respondTrust(requestId: string, answer: TrustAnswer): void {
		this.host.projectTrust.respond(requestId, answer);
	}

	dispose(): void {
		this.host.modelWait.dispose();
		for (const sessionId of this.host.registry.list().map((entry) => entry.session.sessionId))
			this.host.knowledgeSession.disposeSession(sessionId);
		this.host.knowledge.dispose();
		this.host.registry.disposeAll();
		this.host.getEventService().clear();
		this.host.approvals.dispose();
		this.host.sessionPermissions.dispose();
		this.host.trustHandlers.clear();
		this.host.projectTrust.dispose();
		this.host.traces.disposeAll();
		void this.host.runtime.dispose();
		log.info("backend disposed");
	}
}
