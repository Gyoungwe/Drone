import { describe, expect, it } from "vitest";
import {
	ANTIGRAVITY_MODEL_DEFINITIONS,
	parseDiscoveredModels,
	staticAntigravityModels,
} from "../src/session-engine/antigravity/catalog";
import { ANTIGRAVITY_PROVIDER_ID } from "../src/session-engine/antigravity/types";

describe("Antigravity catalog", () => {
	it("exposes a stable offline catalog", () => {
		const models = staticAntigravityModels();
		expect(models.length).toBe(ANTIGRAVITY_MODEL_DEFINITIONS.length);
		expect(models.every((model) => model.provider === ANTIGRAVITY_PROVIDER_ID)).toBe(true);
		expect(models.some((model) => model.reasoning)).toBe(true);
	});

	it("filters internal discovery rows and preserves image/reasoning metadata", () => {
		const models = parseDiscoveredModels({
			models: {
				public: {
					displayName: "Public",
					supportsImages: true,
					supportsThinking: true,
					maxTokens: 1000,
					maxOutputTokens: 200,
				},
				internal: { name: "Internal", isInternal: true },
				"gemini-2.5-pro": { displayName: "Retired" },
			},
		});
		expect(models).toHaveLength(1);
		expect(models[0]).toMatchObject({
			id: "public",
			input: ["text", "image"],
			reasoning: true,
			contextWindow: 1000,
			maxTokens: 200,
		});
	});
});
