import { reportedUsage, sanitizeProviderError } from "@drone/shared";
import type { Model, ModelThinkingLevel, Tool } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels, validateToolArguments } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { PluginModelGenerateInput, PluginModelGenerateResult } from "@gyoungwe/plugin-api/runtime";
import { Compile } from "typebox/compile";

/** Resolve supported thinking without claiming that an inherited or unavailable level is actual. */
export function resolvedModelThinking(model: Model<any>, requested: ModelThinkingLevel): ModelThinkingLevel {
	const supported = getSupportedThinkingLevels(model);
	if (!supported.includes(requested)) throw new Error("Selected model thinking level is unavailable");
	return requested;
}

/** The host supplies no executable tools; the sole declared tool returns schema-validated JSON. */
export async function generateStructuredModel(
	runtime: ModelRuntime,
	model: Model<any>,
	input: PluginModelGenerateInput,
	signal: AbortSignal,
	check: () => Promise<void>,
): Promise<PluginModelGenerateResult> {
	const tool: Tool = {
		name: "structured_result",
		description:
			"Return the requested structured result. This does not perform an action or authorize a write.",
		parameters: input.resultSchema as Tool["parameters"],
	};
	// Validate the declaration at the external plugin boundary before spending a model request.
	Compile(input.resultSchema);
	await check();
	let reply: Awaited<ReturnType<ModelRuntime["completeSimple"]>>;
	try {
		reply = await runtime.completeSimple(
			model,
			{
				systemPrompt: input.systemPrompt,
				messages: [{ role: "user", content: [{ type: "text", text: input.prompt }], timestamp: Date.now() }],
				tools: [tool],
			},
			{
				signal,
				maxTokens: input.maxTokens,
				maxRetries: 0,
				...(input.selection.thinkingLevel === "off"
					? {}
					: { reasoning: input.selection.thinkingLevel as Exclude<ModelThinkingLevel, "off"> }),
			},
		);
	} catch (error) {
		// Only provider error text crosses this boundary; provider stacks/details remain private.
		throw new Error(sanitizeProviderError(error instanceof Error ? error.message : String(error)));
	}
	await check();
	if (["error", "aborted", "length"].includes(reply.stopReason))
		throw new Error(`Structured model request did not complete (${reply.stopReason})`);
	const calls = reply.content.filter((block) => block.type === "toolCall");
	if (calls.length !== 1 || calls[0]?.name !== tool.name)
		throw new Error("Model must return exactly one structured_result call; no model tools were executed");
	const value = validateToolArguments(tool, calls[0]);
	const usage = reportedUsage(reply);
	// Pi 1.1.0's cache warmer likewise treats all-zero rates as unavailable economics.
	// Preserve observed charges; a default SDK cost zero with no usable rate is unknown.
	const priced = [model.cost, ...(model.cost.tiers ?? [])].some(
		(rates) => rates.input > 0 || rates.output > 0 || rates.cacheRead > 0 || rates.cacheWrite > 0,
	);
	const cost = usage?.cost;
	return {
		selection: input.selection,
		value,
		usage: {
			inputTokens: usage?.input ?? null,
			outputTokens: usage?.output ?? null,
			cost: cost !== undefined && cost !== null && (cost > 0 || priced) ? cost : null,
		},
	};
}
