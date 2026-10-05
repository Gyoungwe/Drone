import type { ModelPrefs, SubagentThinkingLevel } from "@drone/shared";
import { ModelPrefsService } from "./model-prefs";

/**
 * Model settings domain service.
 *
 * This service owns the durable, user-level model preferences store while
 * keeping the PiBackend compatibility methods intentionally small.  The
 * service has no session or Electron dependencies, so it can be reused by a
 * future standalone host without pulling the backend facade along.
 */
export interface ModelSettingsServicePort {
	getPrefs(): Promise<ModelPrefs>;
	setModelHidden(provider: string, modelId: string, hidden: boolean): Promise<ModelPrefs>;
	setModelsHidden(provider: string, modelIds: string[], hidden: boolean): Promise<ModelPrefs>;
	setSubagentModel(agent: string, modelRef: string | null): Promise<ModelPrefs>;
	getSubagentModel(agent: string): Promise<string | undefined>;
	setSubagentThinking(agent: string, level: SubagentThinkingLevel | null): Promise<ModelPrefs>;
	setBackgroundReviewerModel(enabled: boolean): Promise<ModelPrefs>;
	getSubagentThinking(agent: string): Promise<SubagentThinkingLevel | undefined>;
}

export class ModelSettingsService implements ModelSettingsServicePort {
	private readonly prefs: ModelPrefsService;

	constructor(configPath: string) {
		this.prefs = new ModelPrefsService(configPath);
	}

	getPrefs(): Promise<ModelPrefs> {
		return this.prefs.getPrefs();
	}

	setModelHidden(provider: string, modelId: string, hidden: boolean): Promise<ModelPrefs> {
		return this.prefs.setModelHidden(provider, modelId, hidden);
	}

	setModelsHidden(provider: string, modelIds: string[], hidden: boolean): Promise<ModelPrefs> {
		return this.prefs.setModelsHidden(provider, modelIds, hidden);
	}

	setSubagentModel(agent: string, modelRef: string | null): Promise<ModelPrefs> {
		return this.prefs.setSubagentModel(agent, modelRef);
	}

	getSubagentModel(agent: string): Promise<string | undefined> {
		return this.prefs.getSubagentModel(agent);
	}

	setSubagentThinking(agent: string, level: SubagentThinkingLevel | null): Promise<ModelPrefs> {
		return this.prefs.setSubagentThinking(agent, level);
	}

	getSubagentThinking(agent: string): Promise<SubagentThinkingLevel | undefined> {
		return this.prefs.getSubagentThinking(agent);
	}

	setBackgroundReviewerModel(enabled: boolean): Promise<ModelPrefs> {
		return this.prefs.setBackgroundReviewerModel(enabled);
	}
}
