import type { BackendServices, PiBackend } from "@drone/backend";
import type {
	CustomProviderInput,
	CustomProviderUpdateInput,
	ListProvidersOptions,
	SubagentThinkingLevel,
} from "@drone/shared";
import { IpcChannels, SettingsContract } from "@drone/shared";
import { bindContract, type ContractImplementation } from "./bind-contract";

/** 设置域：provider 设置 + MCP + 权限门控配置 + 项目信任应答 */
export function registerSettingsIpc(
	backend: PiBackend,
	services?: Pick<BackendServices, "settings" | "models" | "login" | "subagents">,
): void {
	// Prefer explicit domain services when the composition root is available. The
	// PiBackend fallback keeps older tests and embedders source-compatible while
	// the remaining approval/session methods migrate off the façade.
	const settings = services?.settings ?? backend.settings;
	const models = services?.models ?? backend.models;
	const login = services?.login ?? backend.login;
	const subagents =
		services?.subagents ??
		backend.subagents ??
		({
			listAvailable: () => backend.listSubagents(),
		} satisfies Pick<BackendServices["subagents"], "listAvailable">);
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
		listSubagents: () => subagents.listAvailable(),
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
}
