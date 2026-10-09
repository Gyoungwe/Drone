import type { AntigravityModelDefinition } from "./types";

const TEXT_ONLY = ["text"] as const;
const TEXT_IMAGE = ["text", "image"] as const;

function flashDefinition(version: string): AntigravityModelDefinition {
	const id = `gemini-${version}-flash`;
	return {
		id,
		name: `Gemini ${version} Flash (Antigravity)`,
		wireId: `${id}-low`,
		reasoning: true,
		input: [...TEXT_IMAGE],
		contextWindow: 1_000_000,
		maxTokens: 64_000,
		thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high" },
		wireThinkingLevelMap: {
			off: `${id}-low`,
			minimal: `${id}-low`,
			low: `${id}-low`,
			medium: `${id}-medium`,
			high: `${id}-high`,
		},
	};
}

function claudeDefinition(id: string, name: string, contextWindow: number): AntigravityModelDefinition {
	return {
		id,
		name,
		wireId: id,
		reasoning: true,
		input: [...TEXT_IMAGE],
		contextWindow,
		maxTokens: 64_000,
		thinkingBudgets: { minimal: 1_024, low: 4_096, medium: 8_192, high: 16_384 },
	};
}

/**
 * Conservative offline catalog. Discovery may add newer entries after login,
 * but these entries remain available when the discovery endpoint is offline.
 */
export const ANTIGRAVITY_MODEL_DEFINITIONS: readonly AntigravityModelDefinition[] = [
	{
		id: "gemini-3.1-pro",
		name: "Gemini 3.1 Pro (Antigravity)",
		wireId: "gemini-3.1-pro-low",
		reasoning: true,
		input: [...TEXT_IMAGE],
		contextWindow: 1_000_000,
		maxTokens: 64_000,
		thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "low", high: "high" },
		thinkingBudgets: { minimal: 1_001, low: 1_001, medium: 1_001, high: 10_001 },
		wireThinkingLevelMap: {
			off: "gemini-3.1-pro-low",
			minimal: "gemini-3.1-pro-low",
			low: "gemini-3.1-pro-low",
			medium: "gemini-3.1-pro-low",
			high: "gemini-pro-agent",
		},
	},
	flashDefinition("3.8"),
	flashDefinition("3.7"),
	flashDefinition("3.6"),
	claudeDefinition("claude-sonnet-5-5-thinking", "Claude Sonnet 5.5 Thinking (Antigravity)", 1_000_000),
	claudeDefinition("claude-opus-5-5-thinking", "Claude Opus 5.5 Thinking (Antigravity)", 200_000),
	claudeDefinition("claude-sonnet-4-6-thinking", "Claude Sonnet 4.6 Thinking (Antigravity)", 1_000_000),
	claudeDefinition("claude-opus-4-6-thinking", "Claude Opus 4.6 Thinking (Antigravity)", 200_000),
	claudeDefinition("claude-sonnet-4-5-thinking", "Claude Sonnet 4.5 Thinking (Antigravity)", 1_000_000),
	claudeDefinition("claude-opus-4-5-thinking", "Claude Opus 4.5 Thinking (Antigravity)", 200_000),
	{
		id: "gpt-oss-120b-medium",
		name: "GPT-OSS 120B (Antigravity)",
		wireId: "gpt-oss-120b-medium",
		reasoning: true,
		input: [...TEXT_ONLY],
		contextWindow: 131_072,
		maxTokens: 32_768,
		thinkingBudgets: { minimal: 1_024, low: 4_096, medium: 8_192, high: 16_384 },
	},
];

/** Suffix rule for Flash models the static table has not listed yet. */
export function flashWireId(modelId: string, thinking?: string): string | undefined {
	if (!/^gemini-\d+(?:\.\d+)?-flash$/.test(modelId)) return undefined;
	const level = thinking === "xhigh" || thinking === "max" ? "high" : thinking;
	if (level === "medium") return `${modelId}-medium`;
	if (level === "high") return `${modelId}-high`;
	return `${modelId}-low`;
}
