import type { PluginRuntimeSchema } from "./runtime.js";

/** Actual resolved selection. A profile names an existing host model preference, never a fallback. */
export interface PluginModelSelection {
	readonly provider: string;
	readonly model: string;
	readonly thinkingLevel: string;
	readonly profile?: string;
	/** Preserve an unset optional preference's provenance for subsequent per-step checks. */
	readonly optionalProfile?: string;
}
export interface PluginModelSelectionInput {
	readonly profile?: string;
	/** Parent is used only when this exact preference is truly unset. Configured but unavailable stays closed. */
	readonly optionalProfile?: string;
}
/** One isolated structured result request; no parent transcript or executable tools are inherited. */
export interface PluginModelGenerateInput {
	readonly selection: PluginModelSelection;
	readonly systemPrompt: string;
	readonly prompt: string;
	readonly resultSchema: PluginRuntimeSchema;
	readonly maxTokens: number;
}
/** Missing telemetry or unknown pricing stays null, never an invented zero/free estimate. */
export interface PluginModelUsage {
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
	readonly cost: number | null;
}
export interface PluginModelGenerateResult {
	readonly selection: PluginModelSelection;
	readonly value: unknown;
	readonly usage: PluginModelUsage;
}

/** Private tool-step protocol, confined to the calling plugin owner and never public chat output. */
export type PluginModelJson =
	| null
	| boolean
	| number
	| string
	| readonly PluginModelJson[]
	| { readonly [key: string]: PluginModelJson };
export interface PluginModelToolBlock {
	readonly type: "text" | "thinking" | "toolCall";
	readonly [key: string]: PluginModelJson;
}
export interface PluginModelToolMessage {
	readonly role: "user" | "assistant" | "toolResult";
	readonly content: readonly PluginModelToolBlock[];
	readonly timestamp: number;
	readonly [key: string]: PluginModelJson | undefined;
}
export interface PluginModelToolDeclaration {
	readonly name: string;
	readonly description: string;
	readonly parameters: PluginRuntimeSchema;
}
export interface PluginModelToolStepInput {
	readonly selection: PluginModelSelection;
	readonly systemPrompt: string;
	readonly messages: readonly PluginModelToolMessage[];
	readonly tools: readonly PluginModelToolDeclaration[];
	readonly maxTokens: number;
}
export interface PluginModelToolStepUsage extends PluginModelUsage {
	readonly cacheReadTokens: number | null;
	readonly cacheWriteTokens: number | null;
	readonly reasoningTokens: number | null;
	readonly totalTokens: number | null;
	readonly reportedFields: readonly string[];
}
export interface PluginModelToolStepResult {
	readonly selection: PluginModelSelection;
	/** Actual SDK JSON protocol envelope, including private thinking/signatures and provider metadata. */
	readonly reply: PluginModelToolMessage & {
		readonly role: "assistant";
		readonly stopReason: "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";
	};
	readonly usage: PluginModelToolStepUsage;
}
