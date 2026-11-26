import type { AskRequest, CreateSessionOptions, SessionEvent, SessionMeta } from "@drone/shared";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type {
	AgentSession,
	CreateAgentSessionOptions,
	CreateAgentSessionResult,
} from "@earendil-works/pi-coding-agent";
import { CapabilityResourceLoader, SkillVisibility } from "../capabilities/resource-loader";
import { CapabilityRuntime } from "../capabilities/runtime";
import { createLogger } from "../log";
import type { PermissionConfirm } from "../permissions/extension";
import type { PluginNativeBootstrap } from "../plugins/coordinator";
import type { ProjectResourceLoader } from "../project/trust-loader";
import { AskGate } from "../session/ask-gate";
import { inboxFor, observeInbox } from "../session/durable-inbox";
import { createSessionExtensionDiagnostics } from "../session/extension-errors";
import { bindToolIntentJournal, createSessionCausalityContext } from "../session/intent-binding";
import {
	AUTO_RESUME_WINDOW_MS,
	type InterruptedToolCall,
	repairInterruptedToolCalls,
	shouldAutoResume,
} from "../session/interrupted-tools";
import { autoNameSession } from "../session/naming";
import type { SessionRegistry } from "../session/registry";
import type { SessionTraces } from "../session/traces";
import { makeUiContext } from "../session/ui-context";
import { excludedBuiltinTools } from "../session-engine/builtin-tools";
import { getAgentDir, type ModelRuntime, type SessionEngine } from "../session-engine/engine";
import {
	buildSessionCustomTools,
	makeCapabilitySessionExtension,
	type SessionExtensionDependencies,
} from "../session-engine/extensions";
import type { SessionServiceOptions } from "../session-service";
import type { StorageRegistry } from "../storage/registry";
import { agentWorkRoot } from "../tools/channel-watch";
import { globalToolManifest } from "../tools/manifest";
import { isSubagentSessionPath } from "../tools/subagent";
import { applySubagentMutex } from "../tools/subagent/mutex";
import type { ApprovalService } from "./approvals";
import { SessionPackageSources } from "./session-package-sources";
import { capturedPackageVersions, type SessionPackageVersions } from "./session-package-versions";
import type { SessionPermissionService } from "./session-permissions";

const log = createLogger("backend");

export interface SessionConstructionHost {
	readonly options: SessionServiceOptions;
	readonly sessionEngine: SessionEngine;
	readonly registry: SessionRegistry;
	readonly approvals: ApprovalService;
	readonly sessionPermissions: SessionPermissionService;
	readonly capabilityRuntimes: Map<string, CapabilityRuntime>;
	readonly traces: SessionTraces;
	readonly storage: Pick<StorageRegistry, "registerDiscoveredRoot">;
	readonly projectLoader: ProjectResourceLoader;
	readonly packageVersions: SessionPackageVersions;
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
		const model =
			options.provider && options.modelId ? runtime.getModel(options.provider, options.modelId) : undefined;
		return this.host.packageVersions.withSelection(async () => {
			const session = await this.construct(cwd, false, (shared) =>
				this.host.sessionEngine.create(
					cwd,
					{
						...shared,
						model,
						thinkingLevel: options.thinkingLevel as ThinkingLevel | undefined,
						tools: this.host.options.tools,
					},
					runtime,
				),
			);
			log.info("session created", session.sessionId, { cwd });
			return this.host.toMetaOrThrow(session.sessionId);
		});
	}

	async openSession(filePath: string): Promise<SessionMeta> {
		return this.host.packageVersions.withSelection(async () => {
			const already = this.host.registry.list().find((entry) => entry.session.sessionFile === filePath);
			if (already) return this.host.registry.toMeta(already);
			const runtime = await this.host.getModelRuntime();
			const sessionManager = this.host.sessionEngine.openManager(filePath);
			const cwd = sessionManager.getCwd() || process.cwd();
			const readOnly = isSubagentSessionPath(filePath);
			const interrupted = readOnly ? [] : this.repairInterrupted(filePath, sessionManager);
			const session = await this.construct(cwd, readOnly, (shared) =>
				this.host.sessionEngine.open(filePath, shared, runtime),
			);
			log.info("session opened", session.sessionId, { file: filePath });
			this.resume(session, filePath, readOnly, interrupted);
			return this.host.toMetaOrThrow(session.sessionId);
		});
	}

	private prepare(cwd: string, readOnly: boolean) {
		this.host.storage.registerDiscoveredRoot(
			"project-work",
			agentWorkRoot(cwd),
			"tools/channel-watch",
			"private",
		);
		const gate = this.host.approvals.createGate();
		const askGate = new AskGate((req) => this.host.dispatchAskRequest(req));
		const confirm: PermissionConfirm = (title, message, meta) => gate.confirm(title, message, meta);
		const modeRef = this.host.sessionPermissions.createMode();
		const skillVisibility = new SkillVisibility();
		const desktop = this.host.options.desktopIntegration;
		const capabilities =
			this.host.options.lazyCapabilities === false && !desktop?.academicPiRoot
				? undefined
				: new CapabilityRuntime(skillVisibility);
		const nativeBootstrap = desktop?.nativeRuntime?.begin({ kind: "primary", readOnly });
		const extensionFactories = capabilities
			? [makeCapabilitySessionExtension(capabilities, desktop?.academicPiRoot)]
			: undefined;
		return {
			gate,
			askGate,
			confirm,
			modeRef,
			skillVisibility,
			capabilities,
			nativeBootstrap,
			extensionFactories,
		};
	}

	private async construct(
		cwd: string,
		readOnly: boolean,
		start: (options: CreateAgentSessionOptions) => Promise<CreateAgentSessionResult>,
	): Promise<AgentSession> {
		const prepared = this.prepare(cwd, readOnly);
		const { nativeBootstrap, gate, askGate, capabilities, skillVisibility } = prepared;
		const agentDir = getAgentDir();
		const packageSources = new SessionPackageSources(cwd, agentDir);
		let created: AgentSession | undefined;
		try {
			const { settingsManager, resourceLoader: baseLoader } = await this.host.projectLoader.load(cwd, {
				...prepared,
				packageSources,
			});
			const packageVersions = capturedPackageVersions(baseLoader, agentDir);
			packageSources.retainSkills(baseLoader);
			const resourceLoader = capabilities
				? new CapabilityResourceLoader(baseLoader, skillVisibility)
				: baseLoader;
			const { session, extensionsResult } = await start({
				settingsManager,
				resourceLoader,
				excludeTools: excludedBuiltinTools(),
				customTools: buildSessionCustomTools(
					this.host.sessionExtensionDependencies(),
					gate,
					askGate,
					capabilities,
				),
				...nativeDeliveryOptions(nativeBootstrap),
			});
			created = session;
			this.bindCapabilities(session, extensionsResult, capabilities);
			await this.register(session, cwd, readOnly, prepared, packageVersions, packageSources);
			return session;
		} catch (error) {
			packageSources.dispose();
			await this.failedConstruction(error, created, nativeBootstrap);
			throw error;
		}
	}

	private bindCapabilities(
		session: AgentSession,
		extensions: CreateAgentSessionResult["extensionsResult"],
		capabilities?: CapabilityRuntime,
	): void {
		const mutex = applySubagentMutex(session, extensions, this.host.options.subagentPreferBuiltin !== false);
		if (mutex.shadowed.length > 0) {
			log.info("third-party subagent tools shadowed", session.sessionId, mutex);
			for (const shadowed of mutex.shadowed)
				this.host.emitEvent(session.sessionId, {
					type: "subagent_mutex",
					extensionPath: shadowed.extensionPath,
					tools: shadowed.tools,
				});
		}
		if (!capabilities) return;
		capabilities.bind(session, {
			excludedToolNames: mutex.shadowed.flatMap((item) => item.tools),
			extraAlwaysOn: this.host.options.tools ?? [],
		});
		capabilities.setContextWindow(session.model?.contextWindow);
		this.host.capabilityRuntimes.set(session.sessionId, capabilities);
	}

	private async register(
		session: AgentSession,
		cwd: string,
		readOnly: boolean,
		{ gate, askGate, modeRef, nativeBootstrap }: ReturnType<SessionConstructionService["prepare"]>,
		packageVersions: ReturnType<typeof capturedPackageVersions>,
		packageSources: SessionPackageSources,
	): Promise<void> {
		const { sessionId } = session;
		gate.bindSession(sessionId);
		askGate.bindSession(sessionId);
		this.host.approvals.register(sessionId, gate);
		this.host.registerAskGate(sessionId, askGate);
		this.host.sessionPermissions.bind(sessionId, modeRef);
		const diagnostics = createSessionExtensionDiagnostics(session, this.host.traces);
		const unsubscribeEvents = this.subscribe(session);
		const registration = {
			session,
			cwd,
			packageVersions,
			readOnly: readOnly || undefined,
			questionGate: askGate,
			nativeDelivery: nativeBootstrap?.delivery,
			unsubscribe: () => {
				unsubscribeEvents();
				diagnostics.dispose();
				packageSources.dispose();
			},
		};
		this.host.registry.add(registration);
		const lifetime = this.host.registry.signalFor(registration);
		lifetime.addEventListener(
			"abort",
			() => this.host.emitEvent(sessionId, { type: "extension_status", key: null, text: null }),
			{ once: true },
		);
		nativeBootstrap?.bindSession(sessionId, () => this.host.sessionEngine.abort(session));
		if (!readOnly) await this.host.traces.start(sessionId, session.sessionManager.getSessionDir());
		await session.bindExtensions({
			onError: diagnostics.onError,
			...this.extensionUi(sessionId, lifetime, gate, askGate),
		});
	}

	private extensionUi(
		sessionId: string,
		lifetime: AbortSignal,
		gate: ReturnType<ApprovalService["createGate"]>,
		askGate: AskGate,
	) {
		if (this.host.options.permissionGates === false) return {};
		return {
			uiContext: makeUiContext(
				gate,
				askGate,
				(message, severity) => {
					if (!lifetime.aborted)
						this.host.emitEvent(sessionId, { type: "extension_notification", severity, message });
				},
				(key, text) => {
					if (!lifetime.aborted)
						this.host.emitEvent(sessionId, { type: "extension_status", key, text: text ?? null });
				},
			),
			mode: "rpc" as const,
		};
	}

	private subscribe(session: AgentSession) {
		const causality = createSessionCausalityContext();
		const recordIntent = bindToolIntentJournal(
			session,
			this.host.capabilityRuntimes.get(session.sessionId)?.tools,
			() => causality.current(),
		);
		return session.subscribe((event) => {
			causality.observe(event);
			recordIntent(event);
			observeInbox(session.sessionFile, event);
			autoNameSession(session, event);
			this.host.emitEvent(session.sessionId, event);
		});
	}

	private repairInterrupted(
		filePath: string,
		manager: ReturnType<SessionEngine["openManager"]>,
	): InterruptedToolCall[] {
		try {
			return repairInterruptedToolCalls(manager as never, (name) => globalToolManifest.replayPolicy(name));
		} catch (error) {
			log.error("interrupted tool repair failed", filePath, { error: String(error) });
			return [];
		}
	}

	private resume(
		session: AgentSession,
		filePath: string,
		readOnly: boolean,
		interrupted: InterruptedToolCall[],
	): void {
		const autoResume = this.host.options.autoResumeInterrupted !== false;
		let resumed: Promise<unknown> = Promise.resolve();
		if (interrupted.length) {
			log.info("interrupted tool calls repaired", session.sessionId, {
				calls: interrupted.map((call) => ({
					tool: call.toolName,
					replay: call.replay,
					started: call.started,
				})),
			});
			if (autoResume && shouldAutoResume(interrupted))
				resumed =
					this.host
						.resumeInterrupted?.(session, interrupted)
						?.catch((error) =>
							log.error("interrupted tool resume failed", session.sessionId, { error: String(error) }),
						) ?? resumed;
		}
		if (readOnly || !autoResume) return;
		const restored = restorableInbox(filePath);
		if (!restored.length) return;
		log.info("restoring queued messages", session.sessionId, { count: restored.length });
		void resumed.then(async () => {
			for (const item of restored)
				await this.host.sessionEngine
					.prompt(session, item.text, { streamingBehavior: "followUp" })
					.catch((error) =>
						log.error("restored message delivery failed", session.sessionId, { error: String(error) }),
					);
		});
	}

	private async failedConstruction(
		error: unknown,
		session?: AgentSession,
		bootstrap?: PluginNativeBootstrap,
	): Promise<void> {
		if (session) this.host.registry.delete(session.sessionId);
		const engine = await Promise.allSettled([
			session ? this.host.sessionEngine.dispose(session) : Promise.resolve(),
		]);
		const results = [...engine, ...(await Promise.allSettled([bootstrap?.dispose()]))];
		const failures = results.filter((result) => result.status === "rejected");
		if (failures.length)
			throw new AggregateError(
				[error, ...failures.map((result) => result.reason)],
				"Session creation and native plugin cleanup failed",
			);
	}
}

function nativeDeliveryOptions(bootstrap?: PluginNativeBootstrap): CreateAgentSessionOptions {
	const delivery = bootstrap?.delivery;
	if (!delivery) return {};
	return {
		hostDeliveryRunStart: (signal) => delivery.start(signal),
		hostExportIsOrdinary: () => delivery.isOrdinaryForExport(),
		hostExportBoundary: (input) => delivery.exportProjection(input),
		hostDeliveryBoundary: (event, signal) => delivery.finalize(event, signal),
	};
}

/** 取出可自动恢复的排队消息（最近 24 小时）；取出即清空，避免重复打开时二次投递。 */
function restorableInbox(sessionFile: string) {
	try {
		const inbox = inboxFor(sessionFile);
		const cutoff = Date.now() - AUTO_RESUME_WINDOW_MS;
		if (!inbox.pending().some((item) => item.ts > cutoff)) return [];
		return inbox.drain().filter((item) => item.ts > cutoff);
	} catch {
		return [];
	}
}
