import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { channelOf } from "./define";
import { UiPluginsContract } from "./ui-plugins";

const config = {
	enabled: true,
	plugins: { "voice-alerts": { enabled: true, trusted: true } },
	assignments: { "chat.todo-panel": "voice-alerts" },
};

const info = {
	name: "voice-alerts",
	slots: {},
	contributions: [
		{
			id: "settings",
			region: "settings.panel",
			export: "SettingsPanel",
			title: "Voice alerts",
		},
	],
	enabled: true,
	trusted: true,
	built: true,
	builtin: true,
};

describe("UiPluginsContract", () => {
	it("keeps the legacy channels and optional openDir shape", () => {
		expect(channelOf(UiPluginsContract, "getConfig")).toBe("uiPlugins:getConfig");
		expect(channelOf(UiPluginsContract, "readCode")).toBe("uiPlugins:readCode");
		expect(Check(UiPluginsContract.methods.openDir.args, [])).toBe(true);
		expect(Check(UiPluginsContract.methods.openDir.args, ["voice-alerts"])).toBe(true);
		expect(Check(UiPluginsContract.methods.openDir.args, [""])).toBe(false);
		expect(Check(UiPluginsContract.methods.assignSlot.args, ["chat.todo-panel", null])).toBe(true);
	});

	it("validates plugin configuration and list payloads", () => {
		expect(Check(UiPluginsContract.methods.getConfig.result, config)).toBe(true);
		expect(Check(UiPluginsContract.methods.list.result, [info])).toBe(true);
		expect(Check(UiPluginsContract.methods.list.result, [{ ...info, extra: true }])).toBe(false);
	});

	it("accepts read and rebuild success/error envelopes", () => {
		const manifest = {
			name: "voice-alerts",
			droneUi: 1,
			main: "src/index.ts",
			headless: true,
		};
		expect(Check(UiPluginsContract.methods.readCode.result, { manifest, code: "export {};" })).toBe(true);
		expect(Check(UiPluginsContract.methods.readCode.result, { error: "unknown plugin" })).toBe(true);
		expect(Check(UiPluginsContract.methods.rebuild.result, { ok: true })).toBe(true);
		expect(Check(UiPluginsContract.methods.rebuild.result, { ok: false, error: "build failed" })).toBe(true);
		expect(Check(UiPluginsContract.methods.rebuild.result, { ok: false })).toBe(false);
	});
});
