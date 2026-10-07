import type { Model } from "@earendil-works/pi-ai";
import { ANTIGRAVITY_MODEL_DEFINITIONS } from "./catalog-data";
import type { AntigravityModelDefinition } from "./types";
import { ANTIGRAVITY_API } from "./types";

export { ANTIGRAVITY_MODEL_DEFINITIONS } from "./catalog-data";

export interface DiscoveredAntigravityModel {
	id: string;
	displayName?: string;
	name?: string;
	supportsImages?: boolean;
	supportsThinking?: boolean;
	maxTokens?: number;
	maxOutputTokens?: number;
	isInternal?: boolean;
}

const DISCOVERY_DENYLIST = new Set(["chat_20706", "chat_23310", "gemini-2.5-pro"]);

export interface AntigravityDiscoveryPayload {
	models?: Record<string, DiscoveredAntigravityModel>;
}

export function staticAntigravityModels(): Model<string>[] {
	return ANTIGRAVITY_MODEL_DEFINITIONS.map((definition) => toModel(definition));
}

export function toModel(definition: AntigravityModelDefinition): Model<string> {
	return {
		id: definition.id,
		name: definition.name,
		api: ANTIGRAVITY_API,
		provider: "google-antigravity",
		baseUrl: "https://daily-cloudcode-pa.googleapis.com",
		input: definition.input,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		reasoning: definition.reasoning,
		contextWindow: definition.contextWindow,
		maxTokens: definition.maxTokens,
		...(definition.thinkingLevelMap ? { thinkingLevelMap: definition.thinkingLevelMap } : {}),
		...(definition.wireThinkingLevelMap || definition.thinkingBudgets
			? {
					samplingParams: {
						...(definition.wireThinkingLevelMap
							? { antigravityWireThinkingLevelMap: definition.wireThinkingLevelMap }
							: {}),
						...(definition.thinkingBudgets ? { antigravityThinkingBudgets: definition.thinkingBudgets } : {}),
					},
				}
			: {}),
	};
}

export function parseDiscoveredModels(payload: unknown): Model<string>[] {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
	const rawModels = (payload as AntigravityDiscoveryPayload).models;
	if (!rawModels || typeof rawModels !== "object" || Array.isArray(rawModels)) return [];
	const models: Model<string>[] = [];
	for (const [id, raw] of Object.entries(rawModels)) {
		if (!raw || typeof raw !== "object" || raw.isInternal === true) continue;
		const modelId = id.trim();
		if (!modelId || DISCOVERY_DENYLIST.has(modelId)) continue;
		const displayName =
			typeof raw.displayName === "string" && raw.displayName.trim()
				? raw.displayName
				: typeof raw.name === "string" && raw.name.trim()
					? raw.name
					: modelId;
		models.push({
			id: modelId,
			name: displayName,
			api: ANTIGRAVITY_API,
			provider: "google-antigravity",
			baseUrl: "https://daily-cloudcode-pa.googleapis.com",
			input: raw.supportsImages === true ? ["text", "image"] : ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			reasoning: raw.supportsThinking === true,
			contextWindow: positiveNumber(raw.maxTokens, 200_000),
			maxTokens: positiveNumber(raw.maxOutputTokens, 64_000),
		});
	}
	return models.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function positiveNumber(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
