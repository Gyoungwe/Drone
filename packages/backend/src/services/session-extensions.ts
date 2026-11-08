import type { DroneRuntime, McpStatus, SessionEvent } from "@drone/shared";
import type { SessionTraces } from "../session/traces";
import type { ModelRuntime } from "../session-engine/engine";
import type { SessionExtensionDependencies } from "../session-engine/extensions";
import type { SessionServiceOptions } from "../session-service";
import type { ModelSettingsService } from "../settings/models";
import { type AgentMode, maxParallelSubagents } from "../tools/agent-mode";
import type { LiveSubagentControl } from "./session-host";

export interface SessionExtensionsHost {
	readonly options: SessionServiceOptions;
	readonly runtime: DroneRuntime;
	readonly modelSettings: ModelSettingsService;
	readonly traces: SessionTraces;
	readonly liveSubagents: Map<string, LiveSubagentControl>;
	getModelRuntime(): Promise<ModelRuntime>;
	emitEvent(sessionId: string, event: SessionEvent): void;
	setMcpStatus(cwd: string, status: McpStatus): void;
	/** H1：会话当前的单体/主从/集群模式（未绑定能力运行时则 undefined） */
	agentModeOf?(sessionId: string): AgentMode | undefined;
}

/** Builds the host-owned extension dependency port used by session construction. */
export class SessionExtensionsService {
	constructor(private readonly host: SessionExtensionsHost) {}

	dependencies(): SessionExtensionDependencies {
		return {
			runtime: this.host.runtime,
			permissionGates: this.host.options.permissionGates,
			permissionExtension: this.host.options.permissionExtension,
			subagentPreferBuiltin: this.host.options.subagentPreferBuiltin,
			webFetch: this.host.options.webFetch,
			tools: this.host.options.tools,
			customTools: this.host.options.customTools,
			desktopIntegration: this.host.options.desktopIntegration,
			getModelRuntime: () => this.host.getModelRuntime(),
			getSubagentModel: (agentName) => this.host.modelSettings.getSubagentModel(agentName),
			getSubagentThinking: (agentName) => this.host.modelSettings.getSubagentThinking(agentName),
			traces: this.host.traces,
			onEvent: (sessionId, event) => this.host.emitEvent(sessionId, event),
			registerLiveChild: (sessionId, control) => {
				this.host.liveSubagents.set(sessionId, control);
				return () => {
					if (this.host.liveSubagents.get(sessionId) === control) this.host.liveSubagents.delete(sessionId);
				};
			},
			setMcpStatus: (cwd, status) => this.host.setMcpStatus(cwd, status),
			// H1：subagent 并发上限随模式走（主从 1 / 集群 4），不再写死 3
			subagentMaxConcurrency: (sessionId) => {
				const mode = this.host.agentModeOf?.(sessionId);
				return mode ? maxParallelSubagents(mode) : undefined;
			},
			...(this.host.options.listSshHosts ? { listSshHosts: this.host.options.listSshHosts } : {}),
			...(this.host.options.memory ? { memory: this.host.options.memory } : {}),
		};
	}
}
