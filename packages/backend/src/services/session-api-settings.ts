import type {
	AvailableModel,
	ContextManagerMode,
	LoadedResources,
	McpStatus,
	ModelPrefs,
	PermissionAuditTailEntry,
	PermissionMode,
	PermissionProbeInput,
	PermissionProbeResult,
	PermissionSettingsSaveInput,
	PermissionSettingsSaveResult,
	PermissionSettingsSnapshot,
	SlashCommandInfo,
	SubagentThinkingLevel,
} from "@drone/shared";

import { SessionApiDiagnostics } from "./session-api-diagnostics";

export class SessionSettingsApi extends SessionApiDiagnostics {
	async listSlashCommands(sessionId: string): Promise<SlashCommandInfo[]> {
		return this.host.resources.listSlashCommands(sessionId);
	}
	async listSlashCommandsForCwd(cwd?: string): Promise<SlashCommandInfo[]> {
		return this.host.resources.listSlashCommandsForCwd(cwd);
	}
	async ensureProjectTrust(cwd: string): Promise<boolean> {
		return this.host.resources.ensureProjectTrust(cwd);
	}
	async getLoadedResources(sessionId: string): Promise<LoadedResources> {
		return this.host.resources.getLoadedResources(sessionId);
	}
	onMcpStatus(handler: (cwd: string, status: McpStatus) => void): () => void {
		return this.host.resources.onMcpStatus(handler);
	}
	setMcpStatus(cwd: string, status: McpStatus): void {
		this.host.resources.setMcpStatus(cwd, status);
	}
	reloadMcpSessions(cwd?: string): Promise<void> {
		return this.host.resources.reloadMcpSessions(cwd);
	}

	async listModels(): Promise<AvailableModel[]> {
		return this.host.modelsService.listModels();
	}
	async getModelPrefs(): Promise<ModelPrefs> {
		return this.host.modelsService.getModelPrefs();
	}
	async setModelHidden(provider: string, modelId: string, hidden: boolean): Promise<ModelPrefs> {
		return this.host.modelsService.setModelHidden(provider, modelId, hidden);
	}
	async setModelsHidden(provider: string, modelIds: string[], hidden: boolean): Promise<ModelPrefs> {
		return this.host.modelsService.setModelsHidden(provider, modelIds, hidden);
	}
	async setSubagentModel(agent: string, modelRef: string | null): Promise<ModelPrefs> {
		return this.host.modelsService.setSubagentModel(agent, modelRef);
	}
	async setSubagentThinking(agent: string, level: SubagentThinkingLevel | null): Promise<ModelPrefs> {
		return this.host.modelsService.setSubagentThinking(agent, level);
	}
	async setBackgroundReviewerModel(enabled: boolean): Promise<ModelPrefs> {
		return this.host.modelsService.setBackgroundReviewerModel(enabled);
	}

	getPermissionConfig(): { enabled: boolean } {
		return this.host.settingsBoundary.getPermissionConfig();
	}
	getPermissionSettings(): PermissionSettingsSnapshot {
		return this.host.settingsBoundary.getPermissionSettings();
	}
	savePermissionSettings(input: PermissionSettingsSaveInput): PermissionSettingsSaveResult {
		return this.host.settingsBoundary.savePermissionSettings(input);
	}
	resetPermissionSettings(): PermissionSettingsSnapshot {
		return this.host.settingsBoundary.resetPermissionSettings();
	}
	probePermission(input: PermissionProbeInput): PermissionProbeResult {
		return this.host.settingsBoundary.probePermission(input);
	}
	getPermissionAuditTail(limit?: number): PermissionAuditTailEntry[] {
		return this.host.settingsBoundary.getPermissionAuditTail(limit);
	}
	getSessionPermissionMode(sessionId: string): PermissionMode {
		return this.host.settingsBoundary.getSessionPermissionMode(sessionId);
	}
	setSessionPermissionMode(sessionId: string, mode: PermissionMode): void {
		this.host.settingsBoundary.setSessionPermissionMode(sessionId, mode);
	}
	getContextManagerConfig(): { mode: ContextManagerMode } {
		return this.host.settingsBoundary.getContextManagerConfig();
	}
	setContextManagerMode(mode: ContextManagerMode): void {
		this.host.settingsBoundary.setContextManagerMode(mode);
	}
	getChannelWatchConfig(): { enabled: boolean } {
		return this.host.settingsBoundary.getChannelWatchConfig();
	}
	setChannelWatchEnabled(enabled: boolean): void {
		this.host.settingsBoundary.setChannelWatchEnabled(enabled);
	}
}
