import { sanitizeProviderError } from "@drone/shared";
import type { Message, Model, ModelThinkingLevel, Tool } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { PluginModelToolStepInput, PluginModelToolStepResult } from "@gyoungwe/plugin-api/runtime";
import { Compile } from "typebox/compile";

/** One private SDK completion. Tool execution and every domain budget remain in the calling package. */
export async function completeModelToolStep(
	runtime: ModelRuntime,
	model: Model<any>,
	input: PluginModelToolStepInput,
	signal: AbortSignal,
	check: () => Promise<void>,
): Promise<PluginModelToolStepResult> {
	JSON.stringify(input, (_key, value: unknown) => {
		if (
			["function", "symbol", "bigint", "undefined"].includes(typeof value) ||
			(typeof value === "number" && !Number.isFinite(value))
		)
			throw new Error("Private model requests must contain only JSON data");
		return value;
	});
	if (
		Buffer.byteLength(input.systemPrompt) > 32000 ||
		Buffer.byteLength(JSON.stringify(input.messages)) > 80000
	)
		throw new Error("Private model context exceeds its bounded input size");
	const names = new Set<string>();
	for (const tool of input.tools) {
		if (names.has(tool.name)) throw new Error("Private model tool names must be unique");
		names.add(tool.name);
		Compile(tool.parameters);
	}
	await check();
	let reply: Awaited<ReturnType<ModelRuntime["completeSimple"]>>;
	try {
		reply = await runtime.completeSimple(
			model,
			{
				systemPrompt: input.systemPrompt,
				messages: input.messages as unknown as Message[],
				tools: input.tools as unknown as Tool[],
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
		throw new Error(sanitizeProviderError(error instanceof Error ? error.message : String(error)));
	}
	await check();
	const count = (value: unknown): number | null =>
		typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
	const priced = [model.cost, ...(model.cost.tiers ?? [])].some(
		(rates) => rates.input > 0 || rates.output > 0 || rates.cacheRead > 0 || rates.cacheWrite > 0,
	);
	const cost = count(reply.usage?.cost?.total);
	const fields = {
		inputTokens: count(reply.usage?.input),
		outputTokens: count(reply.usage?.output),
		cacheReadTokens: count(reply.usage?.cacheRead),
		cacheWriteTokens: count(reply.usage?.cacheWrite),
		reasoningTokens: count(reply.usage?.reasoning),
		totalTokens: count(reply.usage?.totalTokens),
		cost: cost !== null && (cost > 0 || priced) ? cost : null,
	};
	return {
		selection: input.selection,
		// The public port is JSON-only, matching SDK persistence; it never hands source objects to a plugin.
		reply: JSON.parse(JSON.stringify(reply)) as PluginModelToolStepResult["reply"],
		usage: {
			...fields,
			reportedFields: Object.entries(fields)
				.filter(([, value]) => value !== null)
				.map(([key]) => key),
		},
	};
}
