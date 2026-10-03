import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { channelOf } from "./define";
import { SettingsContract } from "./settings";

describe("SettingsContract", () => {
	it("keeps provider and model preference channels stable", () => {
		expect(channelOf(SettingsContract, "listProviders")).toBe("settings:listProviders");
		expect(channelOf(SettingsContract, "setModelHidden")).toBe("settings:setModelHidden");
		expect(Check(SettingsContract.methods.listProviders.args, [])).toBe(true);
		expect(Check(SettingsContract.methods.listProviders.args, [{ forceNetwork: true }])).toBe(true);
		expect(Check(SettingsContract.methods.listProviders.args, [{ forceNetwork: "yes" }])).toBe(false);
		expect(Check(SettingsContract.methods.setModelHidden.args, ["openai", "gpt-5", true])).toBe(true);
		expect(Check(SettingsContract.methods.setModelHidden.args, ["", "gpt-5", true])).toBe(false);
		expect(Check(SettingsContract.methods.setSubagentModel.args, ["reviewer", null])).toBe(true);
	});

	it("rejects malformed provider inputs before backend invocation", () => {
		expect(
			Check(SettingsContract.methods.addCustomProvider.args, [
				{ id: "x", baseUrl: "https://x", api: "openai", models: [] },
			]),
		).toBe(true);
		expect(
			Check(SettingsContract.methods.addCustomProvider.args, [
				{ id: "x", baseUrl: "file:///x", api: "openai" },
			]),
		).toBe(false);
	});
});
