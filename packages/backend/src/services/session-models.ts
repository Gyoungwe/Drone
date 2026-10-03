import type { AvailableModel, ModelPrefs } from "@drone/shared";
import type { ModelRuntime } from "../session-engine/engine";
import { getSupportedThinkingLevels } from "../session-engine/engine";
import type { ModelSettingsService } from "../settings/models";
import type { SettingsService } from "../settings/settings";

export interface SessionModelsHost {
	readonly settings: SettingsService;
	/** Resolve lazily so compatibility adapters can replace the façade's modelPrefs seam. */
	getModelPrefsService(): ModelSettingsService;
	getModelRuntime(): Promise<ModelRuntime>;
}
export class SessionModelsService {
	constructor(private readonly host: SessionModelsHost) {}
	async listModels(): Promise<AvailableModel[]> {
		const models = this.host.getModelPrefsService();
		const [providers, prefs, runtime] = await Promise.all([
			this.host.settings.listProviders(),
			models.getPrefs(),
			this.host.getModelRuntime(),
		]);
		return providers.flatMap((provider) =>
			provider.configured
				? provider.models
						.filter((model) => !prefs.hiddenModels[provider.id]?.includes(model.id))
						.map((model) => {
							// 该模型实际支持的思考深度（SDK 按 reasoning/thinkingLevelMap 判定；不推理的模型只有 off）
							// + 图片输入能力（input 含 image；查不到则缺省，UI fail-open）
							let thinkingLevels: string[] | undefined;
							let imageInput: boolean | undefined;
							try {
								const m = runtime.getModel(provider.id, model.id);
								if (m) {
									thinkingLevels = getSupportedThinkingLevels(m);
									imageInput = m.input.includes("image");
								}
							} catch {
								thinkingLevels = undefined;
								imageInput = undefined;
							}
							return {
								provider: provider.id,
								providerName: provider.name,
								id: model.id,
								label: model.name,
								authed: true,
								thinkingLevels,
								imageInput,
							};
						})
				: [],
		);
	}

	async getModelPrefs(): Promise<ModelPrefs> {
		return this.host.getModelPrefsService().getPrefs();
	}

	async setModelHidden(provider: string, modelId: string, hidden: boolean): Promise<ModelPrefs> {
		return this.host.getModelPrefsService().setModelHidden(provider, modelId, hidden);
	}

	async setModelsHidden(provider: string, modelIds: string[], hidden: boolean): Promise<ModelPrefs> {
		return this.host.getModelPrefsService().setModelsHidden(provider, modelIds, hidden);
	}

	async setSubagentModel(agent: string, modelRef: string | null): Promise<ModelPrefs> {
		return this.host.getModelPrefsService().setSubagentModel(agent, modelRef);
	}

	async setSubagentThinking(
		agent: string,
		level: import("@drone/shared").SubagentThinkingLevel | null,
	): Promise<ModelPrefs> {
		return this.host.getModelPrefsService().setSubagentThinking(agent, level);
	}
}
