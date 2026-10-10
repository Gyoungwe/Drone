import type {
	AskRequest,
	CreateSessionOptions,
	DroneRuntime,
	SessionEvent,
	SessionMeta,
} from "@drone/shared";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { CapabilityResourceLoader, SkillVisibility } from "../capabilities/resource-loader";
import { CapabilityRuntime, type CapabilityRuntime as CapabilityRuntimeType } from "../capabilities/runtime";
import type { KnowledgeUiService } from "../knowledge/ui";
import { createLogger } from "../log";
import type { PermissionConfirm } from "../permissions/extension";
import type { ProjectResourceLoader } from "../project/trust-loader";
import { AskGate } from "../session/ask-gate";
import { bindToolIntentJournal } from "../session/intent-binding";
import {
	type InterruptedToolCall,
	repairInterruptedToolCalls,
	shouldAutoResume,
} from "../session/interrupted-tools";
import { autoNameSession } from "../session/naming";
import type { SessionRegistry } from "../session/registry";
import type { SessionTraces } from "../session/traces";
import { makeUiContext } from "../session/ui-context";
import { excludedBuiltinTools } from "../session-engine/builtin-tools";
import type { ModelRuntime, SessionEngine } from "../session-engine/engine";
import type { SessionExtensionDependencies } from "../session-engine/extensions";
import { buildSessionCustomTools, makeCapabilitySessionExtension } from "../session-engine/extensions";
import type { SessionServiceOptions } from "../session-service";
import type { StorageRegistry } from "../storage/registry";
import { agentWorkRoot } from "../tools/channel-watch";
import { globalToolManifest } from "../tools/manifest";
import { isSubagentSessionPath } from "../tools/subagent";
import { applySubagentMutex } from "../tools/subagent/mutex";
import type { ApprovalService } from "./approvals";
import type { SessionPermissionService } from "./session-permissions";

const log = createLogger("backend");

export interface SessionConstructionHost {
	readonly options: SessionServiceOptions;
	readonly runtime: DroneRuntime;
	readonly sessionEngine: SessionEngine;
	readonly registry: SessionRegistry;
	readonly approvals: ApprovalService;
	readonly sessionPermissions: SessionPermissionService;
	readonly capabilityRuntimes: Map<string, CapabilityRuntimeType>;
	readonly traces: SessionTraces;
	readonly storage: Pick<StorageRegistry, "registerDiscoveredRoot">;
	readonly projectLoader: ProjectResourceLoader;
	readonly knowledge: Pick<KnowledgeUiService, "notify">;
	getModelRuntime(): Promise<ModelRuntime>;
	sessionExtensionDependencies(): SessionExtensionDependencies;
	registerAskGate(sessionId: string, gate: AskGate): void;
	dispatchAskRequest(req: AskRequest): boolean;
	emitEvent(sessionId: string, event: SessionEvent): void;
	toMetaOrThrow(sessionId: string): SessionMeta;
	resumeInterrupted?(session: AgentSession, calls: InterruptedToolCall[]): Promise<unknown>;
}

export class SessionConstructionService {
	constructor(private readonly host: SessionConstructionHost) {}

	async createSession(options: CreateSessionOptions): Promise<SessionMeta> {
		const runtime = await this.host.getModelRuntime();
		const cwd = options.cwd || this.host.options.defaultCwd || process.cwd();
		this.host.storage.registerDiscoveredRoot(
			"project-work",
			agentWorkRoot(cwd),
			"tools/channel-watch",
			"private",
		);
		const model =
			options.provider && options.modelId ? runtime.getModel(options.provider, options.modelId) : undefined;

		const gate = this.host.approvals.createGate();
		const askGate = new AskGate((req) => this.host.dispatchAskRequest(req));
		// 权限扩展的确认通道直接桥到 gate（携带 kind/suggestDir 元数据，驱动「允许此目录」/持久化）
		const confirmBridge: PermissionConfirm = (title, message, meta) => gate.confirm(title, message, meta);
		// 会话权限模式引用：新会话一律 default 起步（D1：不落盘、不继承），随工厂闭包注入求值链
		const modeRef = this.host.sessionPermissions.createMode();

		const skillVisibility = new SkillVisibility();
		const capabilities =
			this.host.options.lazyCapabilities === false && !this.host.options.desktopIntegration?.academicPiRoot
				? undefined
				: new CapabilityRuntime(skillVisibility);
		const { settingsManager, resourceLoader: baseResourceLoader } = await this.host.projectLoader.load(cwd, {
			confirm: confirmBridge,
			modeRef,
			...(capabilities
				? {
						extensionFactories: [
							makeCapabilitySessionExtension(
								capabilities,
								this.host.options.desktopIntegration?.academicPiRoot,
							),
						],
					}
				: {}),
		});
		const resourceLoader = capabilities
			? new CapabilityResourceLoader(baseResourceLoader, skillVisibility)
			: baseResourceLoader;
		const { session, extensionsResult } = await this.host.sessionEngine.create(
			cwd,
			{
				model,
				thinkingLevel: options.thinkingLevel as ThinkingLevel | undefined,
				tools: this.host.options.tools,
				excludeTools: excludedBuiltinTools(),
				customTools: buildSessionCustomTools(
					this.host.sessionExtensionDependencies(),
					gate,
					askGate,
					capabilities,
				),
				settingsManager,
				resourceLoader,
			},
			runtime,
		);
		const mutex = applySubagentMutex(
			session,
			extensionsResult,
			this.host.options.subagentPreferBuiltin !== false,
		);
		if (mutex.shadowed.length > 0) {
			log.info("third-party subagent tools shadowed", session.sessionId, mutex);
			for (const shadowed of mutex.shadowed) {
				this.host.emitEvent(session.sessionId, {
					type: "subagent_mutex",
					extensionPath: shadowed.extensionPath,
					tools: shadowed.tools,
				});
			}
		}

		if (capabilities) {
			capabilities.bind(session, {
				excludedToolNames: mutex.shadowed.flatMap((item) => item.tools),
				extraAlwaysOn: this.host.options.tools ?? [],
			});
			this.host.capabilityRuntimes.set(session.sessionId, capabilities);
		}

		gate.bindSession(session.sessionId);
		askGate.bindSession(session.sessionId);
		this.host.approvals.register(session.sessionId, gate);
		this.host.registerAskGate(session.sessionId, askGate);
		this.host.sessionPermissions.bind(session.sessionId, modeRef);
		if (this.host.options.permissionGates !== false) {
			await session.bindExtensions({
				uiContext: makeUiContext(gate, askGate, (text, type) => {
					void this.host.knowledge.notify(text, type, session.sessionId).catch(() => {});
				}),
				mode: "tui",
			});
		}

		const recordIntent = bindToolIntentJournal(
			session,
			this.host.capabilityRuntimes.get(session.sessionId)?.tools,
		);
		const unsubscribe = session.subscribe((event) => {
			recordIntent(event);
			autoNameSession(session, event);
			this.host.emitEvent(session.sessionId, event);
		});
		this.host.registry.add({ session, unsubscribe, cwd });
		await this.host.traces.start(session.sessionId, session.sessionManager.getSessionDir());

		log.info("session created", session.sessionId, { cwd });
		return this.host.toMetaOrThrow(session.sessionId);
	}

	async openSession(filePath: string): Promise<SessionMeta> {
		// Idempotent: StrictMode / duplicate restore must not bind the same jsonl twice.
		const already = this.host.registry.list().find((entry) => entry.session.sessionFile === filePath);
		if (already) return this.host.registry.toMeta(already);
		const runtime = await this.host.getModelRuntime();
		const sessionManager = this.host.sessionEngine.openManager(filePath);
		const cwd = sessionManager.getCwd() || process.cwd();
		// 进程在工具执行中途退出：先补齐悬空 toolResult（必须早于 createAgentSession 读转录）。
		let interrupted: InterruptedToolCall[] = [];
		if (!isSubagentSessionPath(filePath)) {
			try {
				interrupted = repairInterruptedToolCalls(sessionManager as never, (name) =>
					globalToolManifest.replayPolicy(name),
				);
			} catch (error) {
				log.error("interrupted tool repair failed", filePath, { error: String(error) });
			}
		}
		this.host.storage.registerDiscoveredRoot(
			"project-work",
			agentWorkRoot(cwd),
			"tools/channel-watch",
			"private",
		);
		const gate = this.host.approvals.createGate();
		const askGate = new AskGate((req) => this.host.dispatchAskRequest(req));
		const confirmBridge: PermissionConfirm = (title, message, meta) => gate.confirm(title, message, meta);
		// 重开历史会话同样 default 起步（D1：模式不随会话文件继承）
		const modeRef = this.host.sessionPermissions.createMode();
		const skillVisibility = new SkillVisibility();
		const capabilities =
			this.host.options.lazyCapabilities === false && !this.host.options.desktopIntegration?.academicPiRoot
				? undefined
				: new CapabilityRuntime(skillVisibility);
		const { settingsManager, resourceLoader: baseResourceLoader } = await this.host.projectLoader.load(cwd, {
			confirm: confirmBridge,
			modeRef,
			...(capabilities
				? {
						extensionFactories: [
							makeCapabilitySessionExtension(
								capabilities,
								this.host.options.desktopIntegration?.academicPiRoot,
							),
						],
					}
				: {}),
		});
		const resourceLoader = capabilities
			? new CapabilityResourceLoader(baseResourceLoader, skillVisibility)
			: baseResourceLoader;
		const { session, extensionsResult } = await this.host.sessionEngine.open(
			filePath,
			{
				settingsManager,
				resourceLoader,
				excludeTools: excludedBuiltinTools(),
				customTools: buildSessionCustomTools(
					this.host.sessionExtensionDependencies(),
					gate,
					askGate,
					capabilities,
				),
			},
			runtime,
		);
		const mutex = applySubagentMutex(
			session,
			extensionsResult,
			this.host.options.subagentPreferBuiltin !== false,
		);
		if (mutex.shadowed.length > 0) {
			log.info("third-party subagent tools shadowed", session.sessionId, mutex);
			for (const shadowed of mutex.shadowed) {
				this.host.emitEvent(session.sessionId, {
					type: "subagent_mutex",
					extensionPath: shadowed.extensionPath,
					tools: shadowed.tools,
				});
			}
		}

		if (capabilities) {
			capabilities.bind(session, {
				excludedToolNames: mutex.shadowed.flatMap((item) => item.tools),
				extraAlwaysOn: this.host.options.tools ?? [],
			});
			this.host.capabilityRuntimes.set(session.sessionId, capabilities);
		}

		gate.bindSession(session.sessionId);
		askGate.bindSession(session.sessionId);
		this.host.approvals.register(session.sessionId, gate);
		this.host.registerAskGate(session.sessionId, askGate);
		this.host.sessionPermissions.bind(session.sessionId, modeRef);
		if (this.host.options.permissionGates !== false) {
			await session.bindExtensions({
				uiContext: makeUiContext(gate, askGate, (text, type) => {
					void this.host.knowledge.notify(text, type, session.sessionId).catch(() => {});
				}),
				mode: "tui",
			});
		}
		const recordIntent = bindToolIntentJournal(
			session,
			this.host.capabilityRuntimes.get(session.sessionId)?.tools,
		);
		const unsubscribe = session.subscribe((event) => {
			recordIntent(event);
			autoNameSession(session, event);
			this.host.emitEvent(session.sessionId, event);
		});
		// 子代理产物目录下的会话文件 = 只读检视（spec §8.1：防能力静默漂移/递归绕过）。
		// 其运行 trace 由 runner 管理，检视页不可写，故不另建 recorder（避免覆盖运行中的 recorder）。
		const readOnly = isSubagentSessionPath(filePath);
		this.host.registry.add({
			session,
			unsubscribe,
			cwd,
			readOnly: readOnly || undefined,
		});
		if (!readOnly) await this.host.traces.start(session.sessionId, session.sessionManager.getSessionDir());
		log.info("session opened", session.sessionId, { file: filePath });
		if (interrupted.length) {
			log.info("interrupted tool calls repaired", session.sessionId, {
				calls: interrupted.map((c) => ({ tool: c.toolName, replay: c.replay, started: c.started })),
			});
			if (this.host.options.autoResumeInterrupted !== false && shouldAutoResume(interrupted))
				void this.host
					.resumeInterrupted?.(session, interrupted)
					?.catch((error) =>
						log.error("interrupted tool resume failed", session.sessionId, { error: String(error) }),
					);
		}
		return this.host.toMetaOrThrow(session.sessionId);
	}
}
