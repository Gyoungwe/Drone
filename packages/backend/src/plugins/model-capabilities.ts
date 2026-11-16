import type { Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
	PluginModelGenerateInput,
	PluginModelSelectionInput,
	PluginModelToolStepInput,
} from "@gyoungwe/plugin-api/runtime";
import { hostText } from "../reply-language";
import { completeModelToolStep } from "../session-engine/model-tool-step";
import { generateStructuredModel } from "../session-engine/structured-model";
import {
	assertModelSelection,
	type PluginModelCapabilitiesDependencies,
	resolveModelSelection,
} from "./model-selection";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";

export type { PluginModelCapabilitiesDependencies } from "./model-selection";

const text = { type: "string", minLength: 1, maxLength: 512 };
const selectionProperties = {
	provider: text,
	model: text,
	thinkingLevel: text,
	profile: text,
	optionalProfile: text,
	inheritedThinking: { enum: ["nearest-supported"] },
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
	async function executeRequest<T>(
		input: Pick<PluginModelGenerateInput, "selection">,
		context: PluginCapabilityContext,
		execute: (runtime: ModelRuntime, model: Model<any>, check: () => Promise<void>) => Promise<T>,
	) {
		const initial = await resolveModelSelection(
			deps,
			context,
			input.selection.profile,
			input.selection.optionalProfile,
			input.selection.inheritedThinking,
		);
		const check = async () => {
			context.signal.throwIfAborted();
			const current = await resolveModelSelection(
				deps,
				context,
				input.selection.profile,
				input.selection.optionalProfile,
				input.selection.inheritedThinking,
			);
			assertModelSelection(initial, current, input.selection);
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
				properties: {
					profile: text,
					optionalProfile: text,
					inheritedThinking: { enum: ["strict", "nearest-supported"] },
				},
				not: { required: ["profile", "optionalProfile"] },
				additionalProperties: false,
			},
			resultSchema: selectionSchema,
			execute: async (input, context) =>
				(
					await resolveModelSelection(
						deps,
						context,
						(input as PluginModelSelectionInput).profile,
						(input as PluginModelSelectionInput).optionalProfile,
						(input as PluginModelSelectionInput).inheritedThinking,
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
