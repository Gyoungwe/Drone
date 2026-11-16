import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { PluginModelSelection, PluginModelSelectionInput } from "@gyoungwe/plugin-api/runtime";
import type { SessionDirectory } from "../session/registry";
import { nearestSupportedThinking, resolvedModelThinking } from "../session-engine/structured-model";
import type { PluginCapabilityContext } from "./runtime-capabilities";
import { requirePluginSession } from "./session-caller";

export interface PluginModelCapabilitiesDependencies {
	registry: SessionDirectory;
	getRuntime(): Promise<ModelRuntime>;
	getProfileModel(profile: string): Promise<string | undefined>;
	getProfileThinking(profile: string): Promise<ModelThinkingLevel | undefined>;
}

export async function resolveModelSelection(
	deps: PluginModelCapabilitiesDependencies,
	context: PluginCapabilityContext,
	profile?: string,
	optionalProfile?: string,
	inheritedThinking?: PluginModelSelectionInput["inheritedThinking"],
) {
	const entryFor = (context: PluginCapabilityContext) => requirePluginSession(deps.registry, context);
	const entry = entryFor(context);
	if (entry.readOnly || !entry.session.settingsManager.isProjectTrusted())
		throw new Error("Model capabilities require a writable trusted session");
	const parentModel = entry.session.model,
		parentThinking = entry.session.thinkingLevel;
	const runtime = await deps.getRuntime();
	let model = parentModel;
	const requestedProfile = profile ?? optionalProfile;
	const ref = requestedProfile === undefined ? undefined : await deps.getProfileModel(requestedProfile);
	if (profile !== undefined && !ref) throw new Error("Named model preference is not configured");
	if (requestedProfile !== undefined && ref !== undefined) {
		const slash = ref.indexOf("/");
		const matches =
			slash > 0
				? [runtime.getModel(ref.slice(0, slash), ref.slice(slash + 1))]
				: runtime.getModels().filter((candidate) => candidate.id === ref);
		if (matches.length !== 1 || !matches[0])
			throw new Error("Configured model preference is unavailable; no provider fallback was used");
		model = matches[0];
	}
	const profileThinking =
		requestedProfile === undefined ? undefined : await deps.getProfileThinking(requestedProfile);
	const thinking = profileThinking ?? parentThinking;
	if (!model || !runtime.hasConfiguredAuth(model.provider))
		throw new Error("Selected model is unavailable or has no configured credentials");
	const selectedModel: Model<any> = model;
	const selection: PluginModelSelection = {
		provider: model.provider,
		model: model.id,
		thinkingLevel:
			profileThinking === undefined && inheritedThinking === "nearest-supported"
				? nearestSupportedThinking(model, thinking)
				: resolvedModelThinking(model, thinking),
		...(inheritedThinking === "nearest-supported" ? { inheritedThinking } : {}),
		...(ref !== undefined
			? { profile: requestedProfile }
			: optionalProfile === undefined
				? {}
				: { optionalProfile }),
	};
	if (
		entryFor(context) !== entry ||
		entry.session.model !== parentModel ||
		entry.session.thinkingLevel !== parentThinking
	)
		throw new Error("Session model selection changed during the request");
	return { entry, model: selectedModel, runtime, selection, parentModel, parentThinking };
}

type ResolvedModelSelection = Awaited<ReturnType<typeof resolveModelSelection>>;

export function assertModelSelection(
	initial: ResolvedModelSelection,
	current: ResolvedModelSelection,
	selection: PluginModelSelection,
) {
	if (
		current.entry !== initial.entry ||
		current.model !== initial.model ||
		current.selection.provider !== selection.provider ||
		current.selection.model !== selection.model ||
		current.selection.thinkingLevel !== selection.thinkingLevel ||
		current.selection.profile !== selection.profile ||
		current.selection.optionalProfile !== selection.optionalProfile ||
		current.selection.inheritedThinking !== selection.inheritedThinking
	)
		throw new Error("Model selection changed or does not match the authorized request");
}
