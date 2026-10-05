import { createLogger } from "../log";
import { McpService } from "../mcp/service";
import { PackageAdmin } from "../packages/admin";
import { ProjectResourceLoader } from "../project/trust-loader";
import { createDroneRuntime } from "../runtime";
import { getAgentDir } from "../session-engine/engine";
import { buildSessionExtensionFactories } from "../session-engine/extensions";
import type { SessionServiceOptions } from "../session-service";
import { createDefaultStorageRegistry } from "../storage/registry";
import { ApprovalService } from "./approvals";
import { DeliverableReviewerService } from "./deliverable-reviewer";
import { KnowledgeSessionService } from "./knowledge-session";
import { PermissionSettingsService } from "./permissions";
import { ProjectTrustService } from "./project-trust";
import { SessionConstructionService } from "./session-construction";
import { SessionControlService } from "./session-control";
import { SessionEventService } from "./session-events";
import { SessionExtensionsService } from "./session-extensions";
import type { SessionHost } from "./session-host";
import { SessionLifecycleService } from "./session-lifecycle";
import { SessionMessageService } from "./session-messages";
import { SessionModelsService } from "./session-models";
import { SessionResourceService } from "./session-resources";
import { SessionSettingsBoundary } from "./session-settings-boundary";
import { SubagentService } from "./subagents";

const log = createLogger("backend");

/** Composition-root initialization kept outside the compatibility façade. */
export function initializeSessionComposition(service: SessionHost, options: SessionServiceOptions): void {
	service.runtime = options.runtime ?? createDroneRuntime();
	service.lifecycle = new SessionLifecycleService(
		service.registry,
		service.sessionEngine,
		options.defaultCwd,
	);
	service.permissions = options.permissions ?? new PermissionSettingsService();
	service.mcp = new McpService({
		onServerEnabled: (cwd) => service.reloadMcpSessions(cwd),
	});
	service.knowledgeSession = new KnowledgeSessionService({
		getContext: (sessionId) => {
			const entry = service.registry.get(sessionId);
			if (!entry) return undefined;
			return {
				sessionId,
				identity: entry,
				cwd: entry.cwd,
				readOnly: entry.readOnly === true,
				streaming: entry.session.isStreaming,
				hasModel: Boolean(entry.session.model),
				projectTrusted: entry.session.settingsManager.isProjectTrusted(),
			};
		},
		prompt: (sessionId, text) => service.prompt(sessionId, text),
		evaluateReview: (input, control) => service.evaluateKnowledgeReview(input, control),
	});
	service.approvals = new ApprovalService({
		onDecision: (decision) => service.persistPermissionDecision(decision),
	});
	service.setEventService(
		new SessionEventService({
			runtime: service.runtime,
			streamGuard: service.streamGuard,
			eventRates: service.eventRates,
			modelWait: service.modelWait,
			traces: service.traces,
			approvals: service.approvals,
			capabilityRuntimes: service.capabilityRuntimes,
			subagentPanel: service.subagentPanel,
			hasSession: (sessionId) => service.registry.has(sessionId),
			abort: (sessionId) => service.abort(sessionId),
			log,
		}),
	);
	const reviewer = new DeliverableReviewerService({
		getCwd: (sessionId) => service.registry.get(sessionId)?.cwd,
		onResult: (sessionId, result, trigger) => {
			if (!result.findings.length) return;
			service.traces.recordCustom(sessionId, "reviewer_finding", {
				contentHash: result.contentHash,
				trigger,
				findings: result.findings,
			});
			for (const finding of result.findings)
				service.emitEvent(sessionId, {
					type: "reviewer_finding",
					finding: { ...finding, trigger, contentHash: result.contentHash },
				});
		},
	});
	service.runtime.knowledge.reviewer = {
		observe: (sessionId, event) => reviewer.observe(sessionId, event),
		schedule: (request) =>
			reviewer.schedule({
				sessionId: request.sessionId,
				snapshot: request.snapshot,
				trigger: request.trigger,
			}),
		getCached: (sessionId, snapshot) => reviewer.getCached(sessionId, snapshot),
		getFindings: (sessionId) => reviewer.getFindings(sessionId),
		clearSession: (sessionId) => reviewer.clearSession(sessionId),
	};
	service.runtime.registerDisposable?.(reviewer);
	service.messageService = new SessionMessageService({
		runtime: service.runtime,
		registry: service.registry,
		sessionEngine: service.sessionEngine,
		subagentPanel: service.subagentPanel,
		listAllSessions: () => service.listAllSessions(),
		openSession: (path) => service.openSession(path),
		requireSession: (id) => service.requireSession(id),
		log,
	});
	service.control = new SessionControlService({
		sessionEngine: service.sessionEngine,
		recovery: service.recovery,
		modelWait: service.modelWait,
		eventRates: service.eventRates,
		registry: service.registry,
		capabilityRuntimes: service.capabilityRuntimes,
		approvals: service.approvals,
		getModelRuntime: () => service.getModelRuntime(),
		requireSession: (id) => service.requireSession(id),
		log,
	});
	service.modelsService = new SessionModelsService({
		settings: service.settings,
		getModelPrefsService: () => service.modelPrefs,
		getModelRuntime: () => service.getModelRuntime(),
	});
	service.settingsBoundary = new SessionSettingsBoundary({
		permissions: service.permissions,
		sessionPermissions: service.sessionPermissions,
		log,
	});
	service.subagents = new SubagentService(service.subagentPanel, options.defaultCwd);
	service.storage = createDefaultStorageRegistry({
		agentDir: getAgentDir(),
		userDataDir: options.userDataDir,
		knowledgeDir: process.env.DRONE_KNOWLEDGE_DIR,
		inquiryDir: options.inquiryDir,
		logDir: process.env.PI_LOG_DIR,
	});
	service.projectTrust = new ProjectTrustService({
		onRequest: (request) => service.dispatchTrustRequest(request),
	});
	service.packages = new PackageAdmin({
		registry: service.registry,
		defaultCwd: options.defaultCwd,
		onSessionReloaded: (sessionId) => service.reapplyCapabilities(sessionId),
	});
	service.projectLoader = new ProjectResourceLoader({
		trustStore: service.projectTrust.store,
		ask: (dir, opts) => service.projectTrust.ask(dir, opts),
		canAsk: () => service.trustHandlers.size > 0,
		buildExtensions: (cwd, confirm, modeRef) =>
			buildSessionExtensionFactories(service.sessionExtensionDependencies(), cwd, confirm, modeRef),
		projectTrust: options.projectTrust,
		desktopIntegration: options.desktopIntegration,
	});
	service.construction = new SessionConstructionService({
		options: service.options,
		runtime: service.runtime,
		sessionEngine: service.sessionEngine,
		registry: service.registry,
		approvals: service.approvals,
		sessionPermissions: service.sessionPermissions,
		capabilityRuntimes: service.capabilityRuntimes,
		traces: service.traces,
		storage: service.storage,
		projectLoader: service.projectLoader,
		knowledge: service.knowledge,
		getModelRuntime: () => service.getModelRuntime(),
		sessionExtensionDependencies: () => service.sessionExtensionDependencies(),
		registerAskGate: (id, gate) => service.registerAskGate(id, gate),
		dispatchAskRequest: (req) => service.dispatchAskRequest(req),
		emitEvent: (id, event) => service.emitEvent(id, event),
		toMetaOrThrow: (id) => service.toMetaOrThrow(id),
	});
	service.resources = new SessionResourceService({
		options: service.options,
		registry: service.registry,
		sessionEngine: service.sessionEngine,
		capabilityRuntimes: service.capabilityRuntimes,
		mcp: service.mcp,
		projectLoader: service.projectLoader,
		requireSession: (id) => service.requireSession(id),
		reapplyCapabilities: (id) => service.reapplyCapabilities(id),
		log,
	});
	service.extensions = new SessionExtensionsService({
		options: service.options,
		runtime: service.runtime,
		modelSettings: service.modelSettings,
		traces: service.traces,
		liveSubagents: service.liveSubagents,
		getModelRuntime: () => service.getModelRuntime(),
		emitEvent: (id, event) => service.emitEvent(id, event),
		setMcpStatus: (cwd, status) => service.setMcpStatus(cwd, status),
	});
}
