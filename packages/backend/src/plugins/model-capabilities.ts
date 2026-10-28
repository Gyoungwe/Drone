import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
	PluginModelGenerateInput,
	PluginModelSelection,
	PluginModelSelectionInput,
} from "@gyoungwe/plugin-api/runtime";
import { hostText } from "../reply-language";
import type { SessionRegistry } from "../session/registry";
import { generateStructuredModel, resolvedModelThinking } from "../session-engine/structured-model";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";
import { requirePluginSession } from "./session-caller";

export interface PluginModelCapabilitiesDependencies {
	registry: SessionRegistry;
	getRuntime(): Promise<ModelRuntime>;
	getProfileModel(profile: string): Promise<string | undefined>;
	getProfileThinking(profile: string): Promise<ModelThinkingLevel | undefined>;
}
const text = { type: "string", minLength: 1, maxLength: 512 };
const selectionProperties = { provider: text, model: text, thinkingLevel: text, profile: text };
const selectionSchema = {
	type: "object",
	properties: selectionProperties,
	required: ["provider", "model", "thinkingLevel"],
	additionalProperties: false,
};
const nullableNumber = { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] };

/** Only the caller's live session can select its model; plugin input cannot select another account/model. */
export function modelCapabilityHandlers(deps: PluginModelCapabilitiesDependencies): {
	"model.selection": PluginCapabilityHandler;
	"model.generate": PluginCapabilityHandler;
} {
	const entryFor = (context: PluginCapabilityContext) => requirePluginSession(deps.registry, context);
	async function resolve(context: PluginCapabilityContext, profile?: string) {
		const entry = entryFor(context);
		if (entry.readOnly || !entry.session.settingsManager.isProjectTrusted())
			throw new Error("Model capabilities require a writable trusted session");
		const parentModel = entry.session.model,
			parentThinking = entry.session.thinkingLevel;
		const runtime = await deps.getRuntime();
		let model = parentModel,
			thinking: ModelThinkingLevel = parentThinking;
		if (profile !== undefined) {
			const ref = await deps.getProfileModel(profile);
			if (!ref) throw new Error("Named model preference is not configured");
			const slash = ref.indexOf("/");
			const matches =
				slash > 0
					? [runtime.getModel(ref.slice(0, slash), ref.slice(slash + 1))]
					: runtime.getModels().filter((candidate) => candidate.id === ref);
			if (matches.length !== 1 || !matches[0])
				throw new Error("Configured model preference is unavailable; no provider fallback was used");
			model = matches[0];
			thinking = (await deps.getProfileThinking(profile)) ?? parentThinking;
		}
		if (!model || !runtime.hasConfiguredAuth(model.provider))
			throw new Error("Selected model is unavailable or has no configured credentials");
		const selectedModel: Model<any> = model;
		const selection: PluginModelSelection = {
			provider: model.provider,
			model: model.id,
			thinkingLevel: resolvedModelThinking(model, thinking),
			...(profile === undefined ? {} : { profile }),
		};
		if (
			entryFor(context) !== entry ||
			entry.session.model !== parentModel ||
			entry.session.thinkingLevel !== parentThinking
		)
			throw new Error("Session model selection changed during the request");
		return { entry, model: selectedModel, runtime, selection, parentModel, parentThinking };
	}
	return {
		"model.selection": {
			effect: "read",
			inputSchema: { type: "object", properties: { profile: text }, additionalProperties: false },
			resultSchema: selectionSchema,
			execute: async (input, context) =>
				(await resolve(context, (input as PluginModelSelectionInput).profile)).selection,
		},
		"model.generate": {
			effect: "write",
			inputSchema: {
				type: "object",
				properties: {
					selection: selectionSchema,
					systemPrompt: { type: "string", minLength: 1, maxLength: 16000 },
					prompt: { type: "string", minLength: 1, maxLength: 64000 },
					resultSchema: { type: "object" },
					maxTokens: { type: "integer", minimum: 1, maximum: 8192 },
				},
				required: ["selection", "systemPrompt", "prompt", "resultSchema", "maxTokens"],
				additionalProperties: false,
			},
			resultSchema: {
				type: "object",
				properties: {
					selection: selectionSchema,
					value: {},
					usage: {
						type: "object",
						properties: { inputTokens: nullableNumber, outputTokens: nullableNumber, cost: nullableNumber },
						required: ["inputTokens", "outputTokens", "cost"],
						additionalProperties: false,
					},
				},
				required: ["selection", "value", "usage"],
				additionalProperties: false,
			},
			approvalDetail: (raw) => {
				const input = raw as PluginModelGenerateInput;
				return hostText(
					`将把本次请求的数据发送给所选模型，可能产生费用。\nprovider/model: ${input.selection.provider}/${input.selection.model}\nthinking: ${input.selection.thinkingLevel}\n最大输出 token: ${input.maxTokens}\n实际模型必须与此选择完全一致，否则不发起请求。费用未知，不代表免费。`,
					`This request sends its supplied data to the selected model and may incur charges.\nprovider/model: ${input.selection.provider}/${input.selection.model}\nthinking: ${input.selection.thinkingLevel}\nMaximum output tokens: ${input.maxTokens}\nThe actual model must match this selection or no request is made. Cost is unknown, not a claim of free usage.`,
				);
			},
			async execute(raw, context) {
				const input = raw as PluginModelGenerateInput;
				if (Buffer.byteLength(JSON.stringify(input)) > 160000)
					throw new Error("Structured model request exceeds the bounded input size");
				const initial = await resolve(context, input.selection.profile);
				const check = async () => {
					const current = await resolve(context, input.selection.profile);
					if (
						current.entry !== initial.entry ||
						current.model !== initial.model ||
						current.selection.provider !== input.selection.provider ||
						current.selection.model !== input.selection.model ||
						current.selection.thinkingLevel !== input.selection.thinkingLevel ||
						current.selection.profile !== input.selection.profile
					)
						throw new Error("Model selection changed or does not match the authorized request");
				};
				await check();
				return generateStructuredModel(initial.runtime, initial.model, input, context.signal, check);
			},
		},
	};
}
