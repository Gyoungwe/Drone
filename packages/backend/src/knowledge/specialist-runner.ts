import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
	LegacyKnowledgeSpecialistAnswer,
	LegacyKnowledgeSpecialistCapability,
	LegacyKnowledgeSpecialistLoop,
	LegacyKnowledgeSpecialistRequest,
	LegacyKnowledgeSpecialistResult,
} from "@gyoungwe/plugin-api";
import { completeModelToolStep } from "../session-engine/model-tool-step";
import { getSupportedThinkingLevels } from "../session-engine/sdk";

export type SpecialistCapability = LegacyKnowledgeSpecialistCapability;
export type SpecialistAnswer = LegacyKnowledgeSpecialistAnswer;
export type SpecialistResult = LegacyKnowledgeSpecialistResult;
export interface SpecialistRequest extends LegacyKnowledgeSpecialistRequest {
	parentModel?: Model<any>;
	parentThinkingLevel?: ModelThinkingLevel;
}
export interface SpecialistRunnerDeps {
	getRuntime(): Promise<ModelRuntime>;
	getModelPreference(name: string): Promise<string | undefined>;
	getThinkingPreference?(name: string): Promise<ModelThinkingLevel | undefined>;
	/** Temporary 0.3 source-owned adapter; remove with the legacy bridge after native cutover. */
	runModelLoop?: LegacyKnowledgeSpecialistLoop;
}

/** Genuine 1.x callers borrow the installed source algorithm; the host owns only SDK transport. */
export async function runKnowledgeSpecialist(
	deps: SpecialistRunnerDeps,
	request: SpecialistRequest,
): Promise<SpecialistResult> {
	if (!deps.runModelLoop)
		throw new Error("Installed knowledge host needs the 0.3 specialist loop capability");
	const { parentModel, parentThinkingLevel, ...sourceRequest } = request;
	const runtime = await deps.getRuntime();
	let selected: { model: Model<any>; thinkingLevel: ModelThinkingLevel };
	return deps.runModelLoop(
		{
			async select(profile) {
				const preference = await deps.getModelPreference(profile);
				let model = parentModel;
				if (preference) {
					const slash = preference.indexOf("/");
					const choices =
						slash > 0
							? [runtime.getModel(preference.slice(0, slash), preference.slice(slash + 1))]
							: runtime.getModels().filter((candidate) => candidate.id === preference);
					if (choices.length !== 1 || !choices[0])
						throw new Error("Configured specialist model is unavailable; no provider fallback was used");
					model = choices[0];
				}
				if (!model) throw new Error("No model is configured for this knowledge specialist");
				if (!runtime.hasConfiguredAuth(model.provider))
					throw new Error(
						"Configured specialist model has no usable credentials; no provider fallback was used",
					);
				const explicitThinking = await deps.getThinkingPreference?.(profile);
				const supported = getSupportedThinkingLevels(model);
				let thinkingLevel: ModelThinkingLevel = "off";
				if (explicitThinking) {
					if (!supported.includes(explicitThinking))
						throw new Error(
							`Configured specialist thinking level ${explicitThinking} is unavailable for ${model.provider}/${model.id}`,
						);
					thinkingLevel = explicitThinking;
				} else if (model.reasoning && parentThinkingLevel && supported.includes(parentThinkingLevel))
					thinkingLevel = parentThinkingLevel;
				else if (model.reasoning) thinkingLevel = supported.includes("medium") ? "medium" : supported[0]!;
				selected = { model, thinkingLevel };
				return { provider: model.provider, model: model.id, thinkingLevel };
			},
			step: (input, signal) =>
				completeModelToolStep(
					runtime,
					selected.model,
					{
						...input,
						selection: {
							provider: selected.model.provider,
							model: selected.model.id,
							thinkingLevel: selected.thinkingLevel,
						},
					},
					signal,
					async () => {
						signal.throwIfAborted();
						await request.check();
					},
				),
		},
		sourceRequest,
	);
}
