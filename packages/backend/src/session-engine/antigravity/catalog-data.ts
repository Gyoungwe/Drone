import type { AntigravityModelDefinition } from "./types";

const TEXT_ONLY = ["text"] as const;
const TEXT_IMAGE = ["text", "image"] as const;

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
	{
		id: "gemini-3.7-flash",
		name: "Gemini 3.7 Flash (Antigravity)",
		wireId: "gemini-3.7-flash-low",
		reasoning: true,
		input: [...TEXT_IMAGE],
		contextWindow: 1_000_000,
		maxTokens: 64_000,
		thinkingLevelMap: {
			off: null,
			minimal: "low",
			low: "low",
			medium: "medium",
			high: "high",
		},
		wireThinkingLevelMap: {
			off: "gemini-3.7-flash-low",
			minimal: "gemini-3.7-flash-low",
			low: "gemini-3.7-flash-low",
			medium: "gemini-3.7-flash-medium",
			high: "gemini-3.7-flash-high",
		},
	},
	{
		id: "claude-sonnet-4-5-thinking",
		name: "Claude Sonnet 4.5 Thinking (Antigravity)",
		wireId: "claude-sonnet-4-5-thinking",
		reasoning: true,
		input: [...TEXT_IMAGE],
		contextWindow: 1_000_000,
		maxTokens: 64_000,
		thinkingBudgets: { minimal: 1_024, low: 4_096, medium: 8_192, high: 16_384 },
	},
	{
		id: "claude-opus-4-5-thinking",
		name: "Claude Opus 4.5 Thinking (Antigravity)",
		wireId: "claude-opus-4-5-thinking",
		reasoning: true,
		input: [...TEXT_IMAGE],
		contextWindow: 200_000,
		maxTokens: 64_000,
		thinkingBudgets: { minimal: 1_024, low: 4_096, medium: 8_192, high: 16_384 },
	},
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
