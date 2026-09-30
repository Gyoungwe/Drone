import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ModelSettingsService } from "../src/settings/models";

describe("ModelSettingsService", () => {
	it("delegates model visibility and subagent preferences to one durable store", async () => {
		const dir = await mkdtemp(join(tmpdir(), "drone-model-settings-"));
		const service = new ModelSettingsService(join(dir, "model-prefs.json"));

		expect(await service.getPrefs()).toEqual({
			hiddenModels: {},
			subagentModels: {},
			subagentThinking: {},
		});

		await service.setModelHidden("openai", "gpt-5", true);
		await service.setSubagentModel("researcher", "anthropic/claude-sonnet");
		await service.setSubagentThinking("researcher", "high");

		expect(await service.getSubagentModel("researcher")).toBe("anthropic/claude-sonnet");
		expect(await service.getSubagentThinking("researcher")).toBe("high");
		expect(await service.getPrefs()).toMatchObject({
			hiddenModels: { openai: ["gpt-5"] },
			subagentModels: { researcher: "anthropic/claude-sonnet" },
			subagentThinking: { researcher: "high" },
		});

		const raw = JSON.parse(await readFile(join(dir, "model-prefs.json"), "utf8"));
		expect(raw).toMatchObject({
			hiddenModels: { openai: ["gpt-5"] },
			subagentModels: { researcher: "anthropic/claude-sonnet" },
			subagentThinking: { researcher: "high" },
		});
	});

	it("preserves validation and removal semantics", async () => {
		const dir = await mkdtemp(join(tmpdir(), "drone-model-settings-"));
		const service = new ModelSettingsService(join(dir, "model-prefs.json"));

		await expect(service.setModelHidden("", "gpt-5", true)).rejects.toThrow("provider and modelId are required");
		await service.setModelHidden("openai", "gpt-5", true);
		await service.setModelHidden("openai", "gpt-5", false);
		await service.setSubagentModel("researcher", "claude");
		await service.setSubagentModel("researcher", null);
		await service.setSubagentThinking("researcher", "medium");
		await service.setSubagentThinking("researcher", null);

		expect(await service.getPrefs()).toEqual({
			hiddenModels: {},
			subagentModels: {},
			subagentThinking: {},
		});
	});
});
