import type { BackendServices, PiBackend } from "@drone/backend";
import type {
	AskResponse,
	CustomProviderInput,
	CustomProviderUpdateInput,
	ListProvidersOptions,
	PermissionAnswer,
	SubagentThinkingLevel,
} from "@drone/shared";
import { IpcChannels, SettingsContract } from "@drone/shared";
import { ipcMain, shell } from "electron";
import { bindContract, type ContractImplementation } from "./bind-contract";

/** 设置域：provider 设置 + MCP + 权限门控配置 + 项目信任应答 */
export function registerSettingsIpc(
	backend: PiBackend,
	services?: Pick<BackendServices, "settings" | "models" | "login">,
): void {
	// Prefer explicit domain services when the composition root is available. The
	// PiBackend fallback keeps older tests and embedders source-compatible while
	// the remaining approval/session methods migrate off the façade.
	const settings = services?.settings ?? backend.settings;
	const models = services?.models ?? backend.models;
	const login = services?.login ?? backend.login;
	const implementation: ContractImplementation<typeof SettingsContract> = {
		listProviders: (...args) => settings.listProviders(args[0] as ListProvidersOptions | undefined),
		saveApiKey: (providerId, key) => settings.saveApiKey(providerId, key),
		removeCredential: (providerId) => settings.removeCredential(providerId),
		addCustomProvider: (input) => settings.addCustomProvider(input as CustomProviderInput),
		updateCustomProvider: (input) => settings.updateCustomProvider(input as CustomProviderUpdateInput),
		removeCustomProvider: (providerId) => settings.removeCustomProvider(providerId),
		setProviderBaseUrl: (...args) => settings.setProviderBaseUrl(args[0], args[1], args[2]),
		testProvider: (...args) => settings.testProvider(args[0], args[1]),
		getModelPrefs: () => models.getPrefs(),
		setModelHidden: (provider, modelId, hidden) => models.setModelHidden(provider, modelId, hidden),
		setModelsHidden: (provider, modelIds, hidden) => models.setModelsHidden(provider, modelIds, hidden),
		setSubagentModel: (agent, modelRef) => models.setSubagentModel(agent, modelRef),
		setSubagentThinking: (agent, level) =>
			models.setSubagentThinking(agent, level as SubagentThinkingLevel | null),
		listSubagents: () => backend.listSubagents(),
		startProviderLogin: (loginId, providerId) => login.startLogin(loginId, providerId),
		cancelProviderLogin: (loginId) => login.cancel(loginId),
		respondProviderLogin: (loginId, promptId, value) => login.respond(loginId, promptId, value),
	};
	bindContract(SettingsContract, implementation, {
		channelForMethod: (_contract, method) =>
			({
				listProviders: IpcChannels.SettingsListProviders,
				saveApiKey: IpcChannels.SettingsSaveApiKey,
				removeCredential: IpcChannels.SettingsRemoveCredential,
				addCustomProvider: IpcChannels.SettingsAddCustomProvider,
				updateCustomProvider: IpcChannels.SettingsUpdateCustomProvider,
				removeCustomProvider: IpcChannels.SettingsRemoveCustomProvider,
				setProviderBaseUrl: IpcChannels.SettingsSetProviderBaseUrl,
				testProvider: IpcChannels.SettingsTestProvider,
				getModelPrefs: IpcChannels.SettingsGetModelPrefs,
				setModelHidden: IpcChannels.SettingsSetModelHidden,
				setModelsHidden: IpcChannels.SettingsSetModelsHidden,
				setSubagentModel: IpcChannels.SettingsSetSubagentModel,
				setSubagentThinking: IpcChannels.SettingsSetSubagentThinking,
				listSubagents: IpcChannels.SettingsListSubagents,
				startProviderLogin: IpcChannels.SettingsLoginStart,
				cancelProviderLogin: IpcChannels.SettingsLoginCancel,
				respondProviderLogin: IpcChannels.SettingsLoginRespond,
			})[method as keyof typeof SettingsContract.methods],
	});

	ipcMain.handle(IpcChannels.McpGetStatus, (_e, cwd?: string) => backend.getMcpStatus(cwd));
	ipcMain.handle(IpcChannels.McpGetConfig, (_e, cwd?: string) => backend.getMcpConfig(cwd));
	ipcMain.handle(IpcChannels.McpSetServerEnabled, (_e, name: string, enabled: boolean, cwd?: string) =>
		backend.setMcpServerEnabled(name, enabled, cwd),
	);
	ipcMain.handle(IpcChannels.McpOpenConfig, async (_e, cwd?: string) => {
		const config = await backend.getMcpConfig(cwd);
		await shell.openPath(config.path);
	});
	ipcMain.handle(IpcChannels.AskRespond, (_e, requestId: string, response: AskResponse) =>
		backend.respondAsk(requestId, response),
	);
	ipcMain.handle(IpcChannels.PermissionRespond, (_e, requestId: string, answer: PermissionAnswer) =>
		backend.respondPermission(requestId, answer),
	);
	ipcMain.handle(IpcChannels.PermissionGetConfig, () => backend.getPermissionConfig());
	ipcMain.handle(IpcChannels.PermissionGetMode, (_e, sessionId: string) =>
		backend.getSessionPermissionMode(sessionId),
	);
	ipcMain.handle(IpcChannels.PermissionSetMode, (_e, sessionId: string, mode: unknown) => {
		if (mode !== "default" && mode !== "strict" && mode !== "fullAccess")
			throw new Error(`invalid permission mode: ${String(mode)}`);
		backend.setSessionPermissionMode(sessionId, mode);
	});
	ipcMain.handle(IpcChannels.ContextManagerGetConfig, () => backend.getContextManagerConfig());
	ipcMain.handle(IpcChannels.ContextManagerSetMode, (_e, mode: unknown) => {
		if (mode !== "evaporation" && mode !== "off")
			throw new Error(`invalid context manager mode: ${String(mode)}`);
		backend.setContextManagerMode(mode);
	});
	ipcMain.handle(IpcChannels.ChannelWatchGetConfig, () => backend.getChannelWatchConfig());
	ipcMain.handle(IpcChannels.ChannelWatchSetEnabled, (_e, enabled: boolean) =>
		backend.setChannelWatchEnabled(enabled),
	);
	ipcMain.handle(IpcChannels.TrustRespond, (_e, requestId: string, answer: number) =>
		backend.respondTrust(requestId, answer),
	);
}
