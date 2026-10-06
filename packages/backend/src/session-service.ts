import { join } from "node:path";
import type {
	AskRequest,
	DroneRuntime,
	HarnessUnit,
	LoginEventPayload,
	McpStatus,
	SessionEvent,
	TrustRequest,
	WikiModelReviewInput,
	WikiModelReviewResult,
} from "@drone/shared";
import type { Model } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { CapabilityRuntime } from "./capabilities/runtime";
import { runKnowledgeSpecialist, type SpecialistRequest } from "./knowledge/specialist-runner";
import { KnowledgeUiService } from "./knowledge/ui";
import { createLogger } from "./log";
import type { McpService } from "./mcp/service";
import type { ProjectResourceLoader } from "./project/trust-loader";
import { addAllowedPattern, addWorkspaceRoot } from "./project/workspace-store";
import type { ApprovalDecision, ApprovalService } from "./services/approvals";
import { InstitutionalService } from "./services/institutional";
import type { KnowledgeReviewControl, KnowledgeSessionService } from "./services/knowledge-session";
import type { PackageService } from "./services/packages";
import type { PermissionSettingsService } from "./services/permissions";
import type { ProjectTrustService } from "./services/project-trust";
import { SessionServiceApi } from "./services/session-api";
import { initializeSessionComposition } from "./services/session-composition";
import type { SessionConstructionService } from "./services/session-construction";
import type { SessionControlService } from "./services/session-control";
import type { SessionExtensionsService } from "./services/session-extensions";
import type { SessionLifecycleService } from "./services/session-lifecycle";
import type { SessionMessageService } from "./services/session-messages";
import type { SessionModelsService } from "./services/session-models";
import { SessionPermissionService } from "./services/session-permissions";
import type { SessionResourceService } from "./services/session-resources";
import type { SessionSettingsBoundary } from "./services/session-settings-boundary";
import type { SubagentService } from "./services/subagents";
import { ZoteroService } from "./services/zotero";
import type { AskGate } from "./session/ask-gate";
import { ModelWaitMonitor } from "./session/model-wait";
import { EventRateTracker } from "./session/rates";
import { SessionRecovery } from "./session/recovery";
import { type EventForwarder, SessionRegistry } from "./session/registry";
import { StreamGuard } from "./session/stream-guard";
import { SessionTraces } from "./session/traces";
import { getAgentDir, type ModelRuntime, SessionEngine } from "./session-engine/engine";
import type { SessionExtensionDependencies } from "./session-engine/extensions";
import { LoginService } from "./settings/login";
import { ModelSettingsService } from "./settings/models";
import { SettingsService } from "./settings/settings";
import type { StorageRegistry } from "./storage/registry";
import { SubagentPanelService } from "./tools/subagent";
import { withNativeSubagentSlot } from "./tools/subagent/slots";

const _log = createLogger("backend");

export interface SessionServiceOptions {
	/** 已登记的远程主机目录（由组合根接到计算主机登记表），供 ssh / ssh_hosts 工具使用 */
	listSshHosts?: () => Promise<import("./tools/ssh").SshHostEntry[]>;
	/** 默认工作目录（createSession 未指定时使用） */
	defaultCwd?: string;
	/** 每会话工具白名单；缺省用 pi 默认（read/bash/edit/write） */
	tools?: string[];
	/** 额外自定义工具 */
	customTools?: ToolDefinition[];
	/** Tool/Skill 能力按需暴露（默认 true）；false 保留 SDK 全量工具行为，供兼容/测试。 */
	lazyCapabilities?: boolean;
	/** 是否启用权限确认门控（false 时 confirm 直接通过） */
	permissionGates?: boolean;
	/** 是否注册内置权限门控扩展（false 时逐工具规则不生效；用户换用自己的权限扩展时关闭）。permissionGates=false 时强制不注册 */
	permissionExtension?: boolean;
	/** 是否注册模型上下文合同与 compact checkpoint 扩展（默认 true）。 */
	harnessContext?: boolean;
	/** 独立 harness 单元开关；缺省全部启用，harnessContext=false 仍优先关闭全部。 */
	harness?: Partial<Record<HarnessUnit, boolean>>;
	/** 是否启用项目信任门控（false 时所有项目自动信任，项目资源直接加载；供无人值守场景用） */
	projectTrust?: boolean;
	/** 是否内置 webfetch 工具（默认 true）；传对象可配置 CIDR 放行 */
	webFetch?: boolean | { allowRanges?: string[] };
	/** 内置 subagent 优先于第三方 subagent 扩展（默认 true） */
	subagentPreferBuiltin?: boolean;
	/** 桌面端 userData 根目录，用于诊断存储清单；不读取其中的文件内容。 */
	userDataDir?: string;
	/** Host-owned runtime container; omitted only for direct compatibility construction. */
	runtime?: DroneRuntime;
	/** Optional project research-state root registered for the inquiry adapter. */
	inquiryDir?: string;
	/** Host-wide root for per-project inquiry ledgers. */
	projectsDir?: string;
	/** Existing v0.19.0 single ledger, mounted read-only for preservation. */
	legacyInquiryDir?: string;
	/** Host-owned permission settings service; omitted for direct compatibility construction. */
	permissions?: PermissionSettingsService;
	/**
	 * 桌面端集成（Electron 专用；纯 CLI 环境不传）：
	 * appendSystemPrompt = 追加进每次会话系统提示词的段落（如「你运行在 Drone 桌面端，界面可被 UI 插件定制」）；
	 * additionalSkillPaths = 额外技能目录（如随包分发的 drone-ui-plugin skill，描述原生进可用技能清单）。
	 */
	desktopIntegration?: {
		appendSystemPrompt: string[];
		additionalSkillPaths: string[];
		additionalExtensionPaths?: string[];
		additionalPromptTemplatePaths?: string[];
		academicPiRoot?: string;
	};
}

type LoginHandler = (payload: LoginEventPayload) => void;
type AskHandler = (req: AskRequest) => void;
type TrustHandler = (req: TrustRequest) => void;
type DecisionHandler = (event: unknown) => void;

/**
 * PiBackend：pi SDK 的唯一适配层（门面）。不依赖 Electron，
 * 主进程与（未来的）独立 server 均可复用。
 *
 * 领域实现拆在同包模块（各文件单一职责）：
 * - slash-commands.ts     斜杠命令清单（内置/模板/skill/扩展）
 * - session-messages.ts   pi 消息 → SessionMessage 解析与 entryId 配对（fork/recall/回放共用）
 * - package-admin.ts      社区包安装/卸载/搜索 + 会话热重载
 * - project-trust-loader.ts 两阶段项目资源加载 + 信任决策
 * - session-trace.ts      会话事件 trace 生命周期
 */
export class SessionService extends SessionServiceApi {
	readonly runtime!: DroneRuntime;
	readonly knowledge = new KnowledgeUiService();
	/** Session-bound knowledge actions exposed through BackendServices. */
	readonly knowledgeSession!: KnowledgeSessionService;
	readonly registry = new SessionRegistry();
	readonly askHandlers = new Set<AskHandler>();
	readonly trustHandlers = new Set<TrustHandler>();
	readonly loginHandlers = new Set<LoginHandler>();
	readonly mcpHandlers = new Set<(cwd: string, status: McpStatus) => void>();
	readonly decisionHandlers = new Set<DecisionHandler>();
	readonly liveSubagents = new Map<
		string,
		{
			steer: (message: string, mode?: "steer" | "followUp") => Promise<void>;
			reply: (requestId: string, message: string) => boolean;
		}
	>();
	readonly mcp!: McpService;
	/** Permission settings domain service exposed by the composition root. */
	readonly permissions!: PermissionSettingsService;
	/** Approval registry and host event boundary exposed by the composition root. */
	readonly approvals!: ApprovalService;
	/** Zotero integration status service exposed by the composition root. */
	readonly zotero = new ZoteroService();
	/** Institutional access configuration/status service exposed by the composition root. */
	readonly institutional = new InstitutionalService();
	/** Per-session permission mode boundary; modes stay in memory and reset on close/restart. */
	readonly sessionPermissions = new SessionPermissionService();
	/** 项目信任决策记录（~/.pi/agent/trust.json，与 CLI 共享）+ 信任请求门控 */
	readonly projectTrust!: ProjectTrustService;
	/** Durable-state inventory used by the metadata-only diagnostics endpoint. */
	/** Durable storage inventory shared with host domain services (compute, diagnostics). */
	readonly storage!: StorageRegistry;
	/** Host-facing subagent boundary; the panel implementation remains private. */
	readonly subagents!: SubagentService;
	readonly capabilityRuntimes = new Map<string, CapabilityRuntime>();
	readonly askGates = new Map<string, Set<AskGate>>();
	readonly traces = new SessionTraces();
	readonly subagentPanel = new SubagentPanelService({
		runner: {
			getModelRuntime: () => this.getModelRuntime(),
			getSubagentModel: (agentName) => this.modelSettings.getSubagentModel(agentName),
			traces: this.traces,
			onEvent: (sessionId, event) => this.emitEvent(sessionId, event),
			registerLiveChild: (sessionId, control) => {
				this.liveSubagents.set(sessionId, control);
				return () => {
					if (this.liveSubagents.get(sessionId) === control) this.liveSubagents.delete(sessionId);
				};
			},
		},
		resolveSession: (sessionId) => {
			const entry = this.registry.get(sessionId);
			const gate = this.approvals?.getGate(sessionId);
			if (!entry || !gate) return undefined;
			return {
				session: entry.session,
				cwd: entry.cwd,
				readOnly: entry.readOnly === true,
				projectTrusted: entry.session.settingsManager.isProjectTrusted(),
				gate,
			};
		},
		emit: (sessionId, event) => this.emitEvent(sessionId, event),
		log: createLogger("backend"),
	});
	readonly streamGuard = new StreamGuard();
	readonly recovery = new SessionRecovery();
	readonly modelWait = new ModelWaitMonitor(
		(sessionId, event) => this.emitEvent(sessionId, event),
		(sessionId) => this.abort(sessionId),
	);
	readonly eventRates = new EventRateTracker();
	private eventService!: {
		emit: (sessionId: string, event: SessionEvent) => void;
		onEvent: (handler: (sessionId: string, event: SessionEvent) => void) => () => void;
		clear: () => void;
	};
	messageService!: SessionMessageService;
	control!: SessionControlService;
	modelsService!: SessionModelsService;
	settingsBoundary!: SessionSettingsBoundary;
	resources!: SessionResourceService;
	construction!: SessionConstructionService;
	extensions!: SessionExtensionsService;
	projectLoader!: ProjectResourceLoader;
	/** Session lifecycle and Pi SDK runtime boundary (A3-3). */
	/** Explicit session lifecycle service exposed by createBackend during A3 migration. */
	readonly sessionEngine = new SessionEngine();
	/** Host-owned list/close lifecycle coordination; create/open setup remains here during migration. */
	readonly lifecycle!: SessionLifecycleService;
	/**
	 * Compatibility injection seam for host adapters and SDK fixtures.
	 *
	 * The session engine owns the default runtime, while older integrations
	 * assign this field to provide a faux/native runtime. Keeping the seam on
	 * the façade lets those callers migrate without changing session behavior.
	 */
	/** @deprecated pass a runtime through the session-engine composition root. */
	modelRuntime?: ModelRuntime;
	/** 设置页（provider/模型/凭证配置）服务 */
	readonly settings = new SettingsService(() => this.getModelRuntime());
	/** 用户级模型可见性与子代理模型偏好（独立于 CLI 共用 settings.json）。 */
	readonly models = new ModelSettingsService(join(getAgentDir(), "model-prefs.json"));
	/** provider 交互登录服务（OAuth + api_key 交互，如 Google Vertex），事件经 onLoginEvent 分发 */
	readonly login = new LoginService({
		getRuntime: () => this.getModelRuntime(),
		send: (payload) => this.dispatchLoginEvent(payload),
	});
	/** 社区包管理（安装/卸载 + 会话热重载）；供 BackendServices 直接消费。 */
	readonly packages!: PackageService;

	constructor(readonly options: SessionServiceOptions = {}) {
		super();
		this.bindHost(this);
		initializeSessionComposition(this, options);
	}

	get modelSettings(): ModelSettingsService {
		return this.models;
	}
	/** Compatibility seam retained for tests and host adapters that inject model preferences. */
	get modelPrefs(): ModelSettingsService {
		return this.models;
	}

	sessionExtensionDependencies(): SessionExtensionDependencies {
		return {
			runtime: this.runtime,
			permissionGates: this.options.permissionGates,
			permissionExtension: this.options.permissionExtension,
			harnessContext: this.options.harnessContext,
			harness: this.options.harness,
			subagentPreferBuiltin: this.options.subagentPreferBuiltin,
			webFetch: this.options.webFetch,
			tools: this.options.tools,
			customTools: this.options.customTools,
			desktopIntegration: this.options.desktopIntegration,
			getModelRuntime: () => this.getModelRuntime(),
			getSubagentModel: (agentName) => this.modelSettings.getSubagentModel(agentName),
			getSubagentThinking: (agentName) => this.modelSettings.getSubagentThinking(agentName),
			traces: this.traces,
			onEvent: (sessionId, event) => this.emitEvent(sessionId, event),
			registerLiveChild: (sessionId, control) => {
				this.liveSubagents.set(sessionId, control);
				return () => {
					if (this.liveSubagents.get(sessionId) === control) this.liveSubagents.delete(sessionId);
				};
			},
			setMcpStatus: (cwd, status) => this.setMcpStatus(cwd, status),
			onDecision: (sessionId, event) => {
				for (const handler of this.decisionHandlers) {
					try {
						const value = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
						const projectId =
							typeof value.projectId === "string" && value.projectId.trim()
								? value.projectId
								: this.registry.get(sessionId)?.cwd;
						handler({ ...value, ...(projectId ? { projectId } : {}) });
					} catch {
						// Decision journaling is observational and must not interrupt a session.
					}
				}
			},
		};
	}

	onDecision(handler: DecisionHandler): () => void {
		this.decisionHandlers.add(handler);
		return () => this.decisionHandlers.delete(handler);
	}

	async getModelRuntime(): Promise<ModelRuntime> {
		return this.modelRuntime ?? this.sessionEngine.getModelRuntime();
	}

	private dispatchLoginEvent(payload: LoginEventPayload): void {
		for (const handler of this.loginHandlers) {
			try {
				handler(payload);
			} catch {
				// 忽略单个处理器异常
			}
		}
	}

	getEventService(): {
		emit: (sessionId: string, event: SessionEvent) => void;
		onEvent: (handler: (sessionId: string, event: SessionEvent) => void) => () => void;
		clear: () => void;
	} {
		return this.eventService;
	}

	setEventService(service: {
		emit: (sessionId: string, event: SessionEvent) => void;
		onEvent: (handler: (sessionId: string, event: SessionEvent) => void) => () => void;
		clear: () => void;
	}): void {
		this.eventService = service;
	}

	emitEvent(sessionId: string, event: SessionEvent): void {
		this.eventService.emit(sessionId, event);
	}

	requireSession(sessionId: string) {
		const entry = this.registry.get(sessionId);
		if (!entry) throw new Error(`Session not found: ${sessionId}`);
		return entry;
	}

	toMetaOrThrow(sessionId: string) {
		const entry = this.registry.get(sessionId);
		if (!entry) throw new Error(`Session not found: ${sessionId}`);
		return this.registry.toMeta(entry);
	}

	registerAskGate(sessionId: string, gate: AskGate): void {
		const gates = this.askGates.get(sessionId) ?? new Set<AskGate>();
		gates.add(gate);
		this.askGates.set(sessionId, gates);
	}

	dispatchAskRequest(req: AskRequest): boolean {
		if (this.askHandlers.size === 0) return false;
		for (const handler of this.askHandlers) handler(req);
		return true;
	}

	dispatchTrustRequest(req: TrustRequest): void {
		for (const handler of this.trustHandlers) {
			try {
				handler(req);
			} catch {
				// Ignore an individual observer failure.
			}
		}
	}

	persistPermissionDecision(decision: ApprovalDecision): void {
		const entry = this.registry.get(decision.sessionId);
		if (!entry) return;
		try {
			const agentDir = getAgentDir();
			if (decision.answer === "allowDir" && decision.meta?.suggestDir)
				addWorkspaceRoot(agentDir, entry.cwd, decision.meta.suggestDir);
			else if (decision.answer === "allowAlways" && decision.meta)
				addAllowedPattern(agentDir, entry.cwd, decision.title);
		} catch (error) {
			_log.error("权限决策持久化失败（agent 已放行，本次决策不记忆）", decision.requestId, error);
		}
	}

	reapplyCapabilities(sessionId: string): void {
		const runtime = this.capabilityRuntimes.get(sessionId);
		if (!runtime || !this.registry.get(sessionId)) return;
		const changed = runtime.activate([]);
		_log.info("capability tools reapplied after reload", sessionId, changed.state.footprint);
	}

	setMcpStatus(cwd: string, status: McpStatus): void {
		this.mcp.setStatus(status, cwd);
		for (const handler of this.mcpHandlers) handler(cwd, status);
	}

	async evaluateKnowledgeReview(
		input: WikiModelReviewInput,
		control: KnowledgeReviewControl,
	): Promise<WikiModelReviewResult> {
		const entry = this.requireSession(input.sessionId);
		return this.knowledge.reviewWithModel(input, {
			signal: control.signal,
			check: control.check,
			evaluate: (request: SpecialistRequest) =>
				withNativeSubagentSlot(entry.cwd, control.signal, () =>
					runKnowledgeSpecialist(
						{
							getRuntime: () => this.getModelRuntime(),
							getModelPreference: (name) => this.modelSettings.getSubagentModel(name),
							getThinkingPreference: (name) => this.modelSettings.getSubagentThinking(name),
						},
						{
							...request,
							parentModel: entry.session.model,
							parentThinkingLevel: entry.session.thinkingLevel,
							signal: control.signal,
						},
					),
				),
		});
	}
}

export type { EventForwarder, Model };
