import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	credentialCapabilityHandlers,
	credentialHeader,
	type PluginCredentialSlot,
	PluginCredentialStore,
} from "./plugin-credentials";
import type { PluginRuntimeSource } from "./plugin-source";

const source: PluginRuntimeSource = {
	pluginId: "@gyoungwe/pi-research",
	packageRoot: "/pkg",
	entrypoint: "/pkg/runtime.mjs",
};
const context = { signal: new AbortController().signal } as Parameters<
	ReturnType<typeof credentialCapabilityHandlers>["credentials.status"]["execute"]
>[1];
const t = {} as { dir: string; store: PluginCredentialStore };
beforeEach(() => {
	t.dir = mkdtempSync(join(tmpdir(), "host-kept-credentials-"));
	t.store = new PluginCredentialStore(join(t.dir, "plugin-credentials.json"));
});
afterEach(() => rmSync(t.dir, { recursive: true, force: true }));

const localSlot: PluginCredentialSlot = {
	slot: "zotero-local",
	label: { zh: "Zotero local writes", en: "Zotero local writes" },
	hosts: ["127.0.0.1:23119"],
	header: "Zotero-API-Key",
	fields: ["serverId"],
};
const localSource: PluginRuntimeSource = { ...source, credentials: [localSlot] };
const localUrl = new URL("http://127.0.0.1:23119/api/users/0/items/X");

beforeEach(() => {
	vi.stubEnv("ZOTERO_LOCAL_API_KEY", "FakeLocalKey123");
	vi.stubEnv("ZOTERO_LOCAL_SERVER_ID", "FakeServer123");
});
afterEach(() => vi.unstubAllEnvs());

it("attaches the current host-kept key to the declared local host", async () => {
	expect(await credentialHeader(t.store, localSource, "zotero-local", localUrl)).toEqual({
		"Zotero-API-Key": "FakeLocalKey123",
	});
});

it("reports the current server id without exposing the host-kept key", async () => {
	const status = credentialCapabilityHandlers(t.store, localSource)["credentials.status"];
	const result = await status.execute(null, context);
	expect(result).toEqual({
		slots: { "zotero-local": { configured: true, fields: { serverId: "FakeServer123" } } },
	});
	expect(JSON.stringify(result)).not.toContain("FakeLocalKey123");
});

it("uses updated environment values without recreating the status handler", async () => {
	const status = credentialCapabilityHandlers(t.store, localSource)["credentials.status"];
	await status.execute(null, context);
	vi.stubEnv("ZOTERO_LOCAL_API_KEY", "FakeUpdatedLocalKey123");
	vi.stubEnv("ZOTERO_LOCAL_SERVER_ID", "FakeUpdatedServer123");
	expect(await credentialHeader(t.store, localSource, "zotero-local", localUrl)).toEqual({
		"Zotero-API-Key": "FakeUpdatedLocalKey123",
	});
	const result = await status.execute(null, context);
	expect(result).toEqual({
		slots: { "zotero-local": { configured: true, fields: { serverId: "FakeUpdatedServer123" } } },
	});
	expect(JSON.stringify(result)).not.toContain("FakeUpdatedLocalKey123");
});

it.each([undefined, ""])("does not use a stored key when the environment key is %s", async (key) => {
	await t.store.save(source.pluginId, localSlot, "FakeStoredLocalKey123", {
		serverId: "FakeStoredServer123",
	});
	vi.stubEnv("ZOTERO_LOCAL_API_KEY", key);
	expect(
		await credentialCapabilityHandlers(t.store, localSource)["credentials.status"].execute(null, context),
	).toEqual({ slots: { "zotero-local": { configured: false, fields: {} } } });
	await expect(credentialHeader(t.store, localSource, "zotero-local", localUrl)).rejects.toThrow(
		"Credential zotero-local is not configured; add it in Drone settings",
	);
});

it("does not share the host-kept key with another plugin", async () => {
	const otherSource = { ...localSource, pluginId: "@other/plugin" };
	const status = credentialCapabilityHandlers(t.store, otherSource)["credentials.status"];
	expect(await status.execute(null, context)).toEqual({
		slots: { "zotero-local": { configured: false, fields: {} } },
	});
	await expect(credentialHeader(t.store, otherSource, "zotero-local", localUrl)).rejects.toThrow(
		"not configured",
	);
	await t.store.save(otherSource.pluginId, localSlot, "FakeOtherPluginKey123", {
		serverId: "FakeOtherServer123",
	});
	expect(await credentialHeader(t.store, otherSource, "zotero-local", localUrl)).toEqual({
		"Zotero-API-Key": "FakeOtherPluginKey123",
	});
	expect(await status.execute(null, context)).toEqual({
		slots: { "zotero-local": { configured: true, fields: { serverId: "FakeOtherServer123" } } },
	});
});

it.each<{ change: string; definition: Partial<PluginCredentialSlot> }>([
	{ change: "slot name", definition: { slot: "other-local" } },
	{ change: "host", definition: { hosts: ["evil.example"] } },
	{ change: "extra host", definition: { hosts: ["127.0.0.1:23119", "evil.example"] } },
	{ change: "header", definition: { header: "Authorization" } },
	{ change: "fields", definition: { fields: ["libraryId"] } },
	{ change: "extra field", definition: { fields: ["serverId", "libraryId"] } },
])("uses the normal store after changing the $change", async ({ definition }) => {
	const changedSlot = { ...localSlot, ...definition };
	const changedSource = { ...localSource, credentials: [changedSlot] };
	const url = new URL(`http://${changedSlot.hosts[0]}/api/users/0/items/X`);
	const status = credentialCapabilityHandlers(t.store, changedSource)["credentials.status"];
	expect(await status.execute(null, context)).toEqual({
		slots: { [changedSlot.slot]: { configured: false, fields: {} } },
	});
	await expect(credentialHeader(t.store, changedSource, changedSlot.slot, url)).rejects.toThrow(
		"not configured",
	);
	const savedFields = Object.fromEntries(changedSlot.fields.map((name) => [name, "FakeStoredField123"]));
	await t.store.save(source.pluginId, changedSlot, "FakeChangedSlotKey123", savedFields);
	expect(await credentialHeader(t.store, changedSource, changedSlot.slot, url)).toEqual({
		[changedSlot.header]: "FakeChangedSlotKey123",
	});
	expect(await status.execute(null, context)).toEqual({
		slots: { [changedSlot.slot]: { configured: true, fields: savedFields } },
	});
});

it("allows a different label without changing the host-kept binding", async () => {
	const relabeled = {
		...localSource,
		credentials: [{ ...localSlot, label: { zh: "Local writes", en: "Local writes" } }],
	};
	expect(await credentialHeader(t.store, relabeled, "zotero-local", localUrl)).toEqual({
		"Zotero-API-Key": "FakeLocalKey123",
	});
});

it("refuses to send the host-kept key to the web API", async () => {
	await expect(
		credentialHeader(t.store, localSource, "zotero-local", new URL("https://api.zotero.org/")),
	).rejects.toThrow("Credential zotero-local may not be sent to api.zotero.org");
});
