import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { JsonStoreCorruptedError } from "../json-store";
import { createDefaultStorageRegistry } from "../storage/registry";
import { createP5BackgroundSettings, P5_BACKGROUND_SETTINGS_STORAGE } from "./p5-background-settings";

const workspaceId = "workspace-1";

function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "drone-p5-settings-"));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "p5-background-settings.json");
	const open = () => createP5BackgroundSettings({ path });
	return { path, open };
}

it("matches the registered settings storage descriptor", () => {
	const agentDir = "/tmp/drone-agent";
	const registry = createDefaultStorageRegistry({ agentDir });
	expect(registry.assertRegistered("agent-p5-background-settings")).toEqual({
		...P5_BACKGROUND_SETTINGS_STORAGE,
		path: join(agentDir, "p5-background-settings.json"),
	});
});

it("is disabled by default and uses the default limit when enabled", () => {
	const { open } = fixture();
	const settings = open();
	expect(settings.get(workspaceId)).toStrictEqual({ enabled: false, dailyTokenLimit: 10_000_000 });
	expect(settings.isEnabled(workspaceId)).toBe(false);
	expect(settings.limitFor(workspaceId)).toBeUndefined();
	expect(settings.setEnabled(workspaceId, true)).toStrictEqual({
		enabled: true,
		dailyTokenLimit: 10_000_000,
	});
	expect(settings.isEnabled(workspaceId)).toBe(true);
	expect(settings.limitFor(workspaceId)).toBe(10_000_000);
});

it("persists independent enablement and limits across reopen", () => {
	const { open } = fixture();
	const settings = open();
	settings.setEnabled(workspaceId, true);
	expect(settings.setDailyTokenLimit(workspaceId, 2_000_000)).toStrictEqual({
		enabled: true,
		dailyTokenLimit: 2_000_000,
	});
	expect(settings.limitFor(workspaceId)).toBe(2_000_000);
	settings.setDailyTokenLimit("workspace-2", 4_000_000);
	const reopened = open();
	expect(reopened.get(workspaceId)).toStrictEqual({ enabled: true, dailyTokenLimit: 2_000_000 });
	expect(reopened.get("workspace-2")).toStrictEqual({ enabled: false, dailyTokenLimit: 4_000_000 });
	expect(reopened.limitFor("workspace-2")).toBeUndefined();
});

it("removes a workspace row when both settings return to defaults", () => {
	const { path, open } = fixture();
	const settings = open();
	settings.setEnabled("workspace-2", true);
	const original = readFileSync(path);
	settings.setEnabled(workspaceId, true);
	settings.setDailyTokenLimit(workspaceId, 2_000_000);
	expect(settings.setEnabled(workspaceId, false)).toStrictEqual({
		enabled: false,
		dailyTokenLimit: 2_000_000,
	});
	settings.setDailyTokenLimit(workspaceId, 10_000_000);
	expect(readFileSync(path)).toStrictEqual(original);
});

it.each([0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])(
	"rejects an invalid limit %s without writing",
	(limit) => {
		const { path, open } = fixture();
		const settings = open();
		settings.setEnabled(workspaceId, true);
		const original = readFileSync(path);
		expect(() => settings.setDailyTokenLimit(workspaceId, limit)).toThrow(
			"Invalid P5 background daily token limit",
		);
		expect(readFileSync(path)).toStrictEqual(original);
	},
);

it.each([
	"{",
	'{"workspace-1":{"enabled":true,"dailyTokenLimit":0}}',
	'{"workspace\\nname":{"enabled":true,"dailyTokenLimit":0}}',
])("refuses to read or update corrupt settings and denies background work: %s", (text) => {
	const { path, open } = fixture();
	const original = Buffer.from(text);
	writeFileSync(path, original);
	const settings = open();
	expect(() => settings.get(workspaceId)).toThrow(JsonStoreCorruptedError);
	expect(() => settings.setEnabled(workspaceId, true)).toThrow(JsonStoreCorruptedError);
	expect(() => settings.setDailyTokenLimit(workspaceId, 2_000_000)).toThrow(JsonStoreCorruptedError);
	expect(settings.isEnabled(workspaceId)).toBe(false);
	expect(settings.limitFor(workspaceId)).toBeUndefined();
	expect(readFileSync(path)).toStrictEqual(original);
});
