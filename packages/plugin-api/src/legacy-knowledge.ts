/** Temporary 0.3 host adapter for genuine published 1.x callers. Remove the host bridge after native cutover.
 * Function-valued tools execute in the providing package owner; this is never a JSON provider protocol. */
import type {
	PluginModelSelection,
	PluginModelToolDeclaration,
	PluginModelToolStepInput,
	PluginModelToolStepResult,
} from "./runtime.js";
export interface LegacyKnowledgeSpecialistCapability extends PluginModelToolDeclaration {
	execute(args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
}
export interface LegacyKnowledgeSpecialistRequest {
	role: import("./knowledge.js").KnowledgeSpecialistRole;
	task: string;
	packet: string;
	skillText?: string;

	capabilities: LegacyKnowledgeSpecialistCapability[];
	signal?: AbortSignal;
	timeoutMs?: number;
	check(): Promise<void>;
	/** Charge provider-reported usage immediately; may throw to stop before another SDK call. */
	onUsage?(usage: LegacyKnowledgeSpecialistResult["usage"]): Promise<void> | void;
	progress(value: { action?: string; model?: string; thinkingLevel?: string }): void;
}
export interface LegacyKnowledgeSpecialistAnswer {
	summary: string;
	source_paths: string[];
	cautions: string[];
	title?: string;
	markdown?: string;
	html?: string;
	verdict?: "approve" | "needs-human" | "reject";
	checks?: {
		evidenceSupportsChanges: boolean;
		scopeAndUncertaintyPreserved: boolean;
		noUnresolvedContradictions: boolean;
		humanContentPreserved: boolean;
		noInstructionInjection: boolean;
	};
}
export interface LegacyKnowledgeSpecialistResult {
	data: LegacyKnowledgeSpecialistAnswer;
	model: string;
	thinkingLevel: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		cacheWriteTokens: number;
		reasoningTokens: number;
		totalTokens: number;
		cost: number;
		/** False when the provider omitted all usage/cost telemetry; zeroes are internal accumulators, not estimates. */
		reported: boolean;
		reportedFields: string[];
	};
	elapsedMs?: number;
}
export interface LegacyKnowledgeSpecialistRunnerDeps {
	select(profile: string): Promise<PluginModelSelection>;
	step(input: PluginModelToolStepInput, signal: AbortSignal): Promise<PluginModelToolStepResult>;
}
export type LegacyKnowledgeSpecialistLoop = (
	deps: LegacyKnowledgeSpecialistRunnerDeps,
	request: LegacyKnowledgeSpecialistRequest,
) => Promise<LegacyKnowledgeSpecialistResult>;
