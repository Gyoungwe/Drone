import type { DroneRuntime, McpStatus, SessionEvent } from "@drone/shared";
import type { SessionTraces } from "../session/traces";
import type { ModelRuntime } from "../session-engine/engine";
import type { SessionExtensionDependencies } from "../session-engine/extensions";
import type { SessionServiceOptions } from "../session-service";
import type { ModelSettingsService } from "../settings/models";
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
		};
	}
}
