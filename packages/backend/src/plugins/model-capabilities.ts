import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
	PluginModelGenerateInput,
	PluginModelSelection,
	PluginModelSelectionInput,
	PluginModelToolStepInput,
} from "@gyoungwe/plugin-api/runtime";
import { hostText } from "../reply-language";
import type { SessionDirectory } from "../session/registry";
import { completeModelToolStep } from "../session-engine/model-tool-step";
import { generateStructuredModel, resolvedModelThinking } from "../session-engine/structured-model";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";
import { requirePluginSession } from "./session-caller";

export interface PluginModelCapabilitiesDependencies {
	registry: SessionDirectory;
	getRuntime(): Promise<ModelRuntime>;
	getProfileModel(profile: string): Promise<string | undefined>;
	getProfileThinking(profile: string): Promise<ModelThinkingLevel | undefined>;
}
const text = { type: "string", minLength: 1, maxLength: 512 };
const selectionProperties = {
	provider: text,
	model: text,
	thinkingLevel: text,
	profile: text,
	optionalProfile: text,
};
const selectionSchema = {
	type: "object",
	properties: selectionProperties,
	required: ["provider", "model", "thinkingLevel"],
	not: { required: ["profile", "optionalProfile"] },
	additionalProperties: false,
};
const nullableNumber = { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] };

/** Only the caller's live session can select its model; plugin input cannot select another account/model. */
export function modelCapabilityHandlers(deps: PluginModelCapabilitiesDependencies): {
	"model.selection": PluginCapabilityHandler;
	"model.generate": PluginCapabilityHandler;
	"model.toolStep": PluginCapabilityHandler;
} {
	const entryFor = (context: PluginCapabilityContext) => requirePluginSession(deps.registry, context);
	async function resolve(context: PluginCapabilityContext, profile?: string, optionalProfile?: string) {
		const entry = entryFor(context);
		if (entry.readOnly || !entry.session.settingsManager.isProjectTrusted())
			throw new Error("Model capabilities require a writable trusted session");
		const parentModel = entry.session.model,
			parentThinking = entry.session.thinkingLevel;
		const runtime = await deps.getRuntime();
		let model = parentModel,
			thinking: ModelThinkingLevel = parentThinking;
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
		if (requestedProfile !== undefined)
			thinking = (await deps.getProfileThinking(requestedProfile)) ?? parentThinking;
		if (!model || !runtime.hasConfiguredAuth(model.provider))
			throw new Error("Selected model is unavailable or has no configured credentials");
		const selectedModel: Model<any> = model;
		const selection: PluginModelSelection = {
			provider: model.provider,
			model: model.id,
			thinkingLevel: resolvedModelThinking(model, thinking),
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
	async function executeRequest<T>(
		input: Pick<PluginModelGenerateInput, "selection">,
		context: PluginCapabilityContext,
		execute: (runtime: ModelRuntime, model: Model<any>, check: () => Promise<void>) => Promise<T>,
	) {
		const initial = await resolve(context, input.selection.profile, input.selection.optionalProfile);
		const check = async () => {
			context.signal.throwIfAborted();
			const current = await resolve(context, input.selection.profile, input.selection.optionalProfile);
			if (
				current.entry !== initial.entry ||
				current.model !== initial.model ||
				current.selection.provider !== input.selection.provider ||
				current.selection.model !== input.selection.model ||
				current.selection.thinkingLevel !== input.selection.thinkingLevel ||
				current.selection.profile !== input.selection.profile ||
				current.selection.optionalProfile !== input.selection.optionalProfile
			)
				throw new Error("Model selection changed or does not match the authorized request");
		};
		await check();
		return execute(initial.runtime, initial.model, check);
	}
	const approvalDetail = (raw: unknown) => {
		const input = raw as Pick<PluginModelGenerateInput, "selection" | "maxTokens">;
		return hostText(
			`将把本次请求的数据发送给所选模型，可能产生费用。\nprovider/model: ${input.selection.provider}/${input.selection.model}\nthinking: ${input.selection.thinkingLevel}\n最大输出 token: ${input.maxTokens}\n实际模型必须与此选择完全一致，否则不发起请求。费用未知，不代表免费。`,
			`This request sends its supplied data to the selected model and may incur charges.\nprovider/model: ${input.selection.provider}/${input.selection.model}\nthinking: ${input.selection.thinkingLevel}\nMaximum output tokens: ${input.maxTokens}\nThe actual model must match this selection or no request is made. Cost is unknown, not a claim of free usage.`,
		);
	};
	const privateMessage = {
		type: "object",
		properties: {
			role: { enum: ["user", "assistant", "toolResult"] },
			content: {
				type: "array",
				items: {
					type: "object",
					properties: { type: { enum: ["text", "thinking", "toolCall"] } },
					required: ["type"],
				},
			},
			timestamp: { type: "number" },
		},
		required: ["role", "content", "timestamp"],
	};

	return {
		"model.selection": {
			effect: "read",
			inputSchema: {
				type: "object",
				properties: { profile: text, optionalProfile: text },
				not: { required: ["profile", "optionalProfile"] },
				additionalProperties: false,
			},
			resultSchema: selectionSchema,
			execute: async (input, context) =>
				(
					await resolve(
						context,
						(input as PluginModelSelectionInput).profile,
						(input as PluginModelSelectionInput).optionalProfile,
					)
				).selection,
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
			approvalDetail,
			async execute(raw, context) {
				const input = raw as PluginModelGenerateInput;
				if (Buffer.byteLength(JSON.stringify(input)) > 160000)
					throw new Error("Structured model request exceeds the bounded input size");
				return executeRequest(input, context, (runtime, model, check) =>
					generateStructuredModel(runtime, model, input, context.signal, check),
				);
			},
		},
		"model.toolStep": {
			effect: "write",
			approvalDetail,
			inputSchema: {
				type: "object",
				properties: {
					selection: selectionSchema,
					systemPrompt: { type: "string", minLength: 1, maxLength: 32000 },
					messages: { type: "array", minItems: 1, maxItems: 32, items: privateMessage },
					tools: {
						type: "array",
						minItems: 1,
						maxItems: 8,
						items: {
							type: "object",
							properties: {
								name: text,
								description: { type: "string", maxLength: 8000 },
								parameters: { type: "object" },
							},
							required: ["name", "description", "parameters"],
							additionalProperties: false,
						},
					},
					maxTokens: { type: "integer", minimum: 1, maximum: 12000 },
				},
				required: ["selection", "systemPrompt", "messages", "tools", "maxTokens"],
				additionalProperties: false,
			},
			resultSchema: {
				type: "object",
				properties: {
					selection: selectionSchema,
					reply: {
						...privateMessage,
						properties: {
							...privateMessage.properties,
							role: { const: "assistant" },
							stopReason: { enum: ["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"] },
						},
						required: [...privateMessage.required, "stopReason"],
					},
					usage: {
						type: "object",
						properties: {
							inputTokens: nullableNumber,
							outputTokens: nullableNumber,
							cacheReadTokens: nullableNumber,
							cacheWriteTokens: nullableNumber,
							reasoningTokens: nullableNumber,
							totalTokens: nullableNumber,
							cost: nullableNumber,
							reportedFields: { type: "array", items: { type: "string" } },
						},
						required: [
							"inputTokens",
							"outputTokens",
							"cacheReadTokens",
							"cacheWriteTokens",
							"reasoningTokens",
							"totalTokens",
							"cost",
							"reportedFields",
						],
						additionalProperties: false,
					},
				},
				required: ["selection", "reply", "usage"],
				additionalProperties: false,
			},
			async execute(raw, context) {
				const input = raw as PluginModelToolStepInput;
				if (Buffer.byteLength(JSON.stringify(input)) > 160000)
					throw new Error("Private model request exceeds the bounded input size");
				return executeRequest(input, context, (runtime, model, check) =>
					completeModelToolStep(runtime, model, input, context.signal, check),
				);
			},
		},
	};
}
