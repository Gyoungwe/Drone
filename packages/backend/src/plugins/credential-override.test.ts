import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Check } from "typebox/value";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolvePluginCredential } from "./credential-override";
import {
	credentialCapabilityHandlers,
	credentialHeader,
	type PluginCredentialSlot,
	PluginCredentialStore,
} from "./plugin-credentials";
import type { PluginRuntimeSource } from "./plugin-source";

const pluginId = "@gyoungwe/pi-knowledge";
const slot: PluginCredentialSlot = {
	slot: "webdav",
	label: { zh: "WebDAV 密码", en: "WebDAV password" },
	hosts: ["10.126.126.1:8080"],
	header: "Authorization",
	fields: [],
	authentication: "http-basic-digest",
};
const savedMarker = "TEST_ONLY_SAVED_WEBDAV_MARKER";
const envMarker = "TEST_ONLY_ENV_WEBDAV_MARKER";
const source: PluginRuntimeSource = {
	pluginId,
	packageRoot: "/pkg",
	entrypoint: "/pkg/runtime.mjs",
	credentials: [slot],
};
const context = { signal: new AbortController().signal } as Parameters<
	ReturnType<typeof credentialCapabilityHandlers>["credentials.status"]["execute"]
>[1];
const t = {} as { dir: string; path: string; store: PluginCredentialStore };
beforeEach(() => {
	t.dir = mkdtempSync(join(tmpdir(), "credential-override-"));
	t.path = join(t.dir, "plugin-credentials.json");
	t.store = new PluginCredentialStore(t.path);
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", undefined);
});
afterEach(() => {
	rmSync(t.dir, { recursive: true, force: true });
	vi.unstubAllEnvs();
});

it.each([
	{ name: "env only", saved: false, env: envMarker, effective: "env" },
	{ name: "env plus saved", saved: true, env: envMarker, effective: "env" },
	{ name: "saved only", saved: true, env: undefined, effective: "saved" },
	{ name: "missing", saved: false, env: undefined, effective: null },
	{ name: "empty env with saved", saved: true, env: "", effective: "saved" },
	{ name: "empty env without saved", saved: false, env: "", effective: null },
])("resolves and projects $name without disclosing secrets", async ({ saved, env, effective }) => {
	if (saved) await t.store.save(pluginId, slot, savedMarker, {});
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", env);
	const resolved = await resolvePluginCredential(t.store, pluginId, slot);
	expect(resolved.savedConfigured).toBe(saved);
	expect(resolved.credential?.source ?? null).toBe(effective);
	expect(resolved.credential?.secret).toBe(
		effective === "env" ? envMarker : effective === "saved" ? savedMarker : undefined,
	);
	expect(await t.store.resolve(pluginId, slot)).toEqual(resolved);
	const status = credentialCapabilityHandlers(t.store, source)["credentials.status"];
	const result = await status.execute(null, context);
	const expected = {
		slots: {
			webdav: {
				authentication: "http-basic-digest",
				configured: effective !== null,
				source: effective,
				savedConfigured: saved,
				fields: {},
			},
		},
	};
	expect(result).toEqual(expected);
	expect(Check(status.resultSchema, result)).toBe(true);
	expect(Check(status.resultSchema, { slots: { webdav: { ...expected.slots.webdav, extra: true } } })).toBe(
		false,
	);
	for (const marker of [savedMarker, envMarker]) expect(JSON.stringify(result)).not.toContain(marker);
});

it.each([
	{ name: "another plugin", owner: "@other/plugin", definition: slot },
	{ name: "another slot", owner: pluginId, definition: { ...slot, slot: "other" } },
	{
		name: "a literal-header slot",
		owner: pluginId,
		definition: {
			slot: slot.slot,
			label: slot.label,
			hosts: slot.hosts,
			header: slot.header,
			fields: slot.fields,
		},
	},
])("does not override $name", async ({ owner, definition }) => {
	const env = { DRONE_WEBDAV_PASSWORD: envMarker };
	expect(await t.store.resolve(owner, definition, env)).toEqual({ savedConfigured: false });
	await t.store.save(owner, definition, savedMarker, {});
	expect(await t.store.resolve(owner, definition, env)).toMatchObject({
		credential: { secret: savedMarker, source: "saved", fields: {} },
		savedConfigured: true,
	});
});

it("keeps a wrong env password effective and reads env changes on every call", async () => {
	await t.store.save(pluginId, slot, savedMarker, {});
	const status = credentialCapabilityHandlers(t.store, source)["credentials.status"];
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", "TEST_ONLY_WRONG_PASSWORD_MARKER");
	expect((await t.store.resolve(pluginId, slot)).credential?.secret).toBe("TEST_ONLY_WRONG_PASSWORD_MARKER");
	expect(await status.execute(null, context)).toMatchObject({ slots: { webdav: { source: "env" } } });
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", envMarker);
	expect((await t.store.resolve(pluginId, slot)).credential?.secret).toBe(envMarker);
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", "");
	expect((await t.store.resolve(pluginId, slot)).credential?.secret).toBe(savedMarker);
	expect(await status.execute(null, context)).toMatchObject({ slots: { webdav: { source: "saved" } } });
});

it("never copies the env override into storage and save/clear leave env effective", async () => {
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", envMarker);
	await t.store.save(pluginId, slot, savedMarker, {});
	expect(readFileSync(t.path, "utf8")).not.toContain(envMarker);
	await t.store.clear(pluginId, slot);
	expect(await t.store.resolve(pluginId, slot)).toEqual({
		credential: { secret: envMarker, fields: {}, source: "env" },
		savedConfigured: false,
	});
	expect(process.env.DRONE_WEBDAV_PASSWORD).toBe(envMarker);
	expect(readFileSync(t.path, "utf8")).not.toContain(envMarker);
});

it("resolves Zotero host-kept slots from the supplied env without reading saved storage", async () => {
	const local: PluginCredentialSlot = {
		slot: "zotero-local",
		label: slot.label,
		hosts: ["127.0.0.1:23119"],
		header: "Zotero-API-Key",
		fields: ["serverId"],
	};
	const get = vi.spyOn(t.store, "get");
	expect(await t.store.resolve("@gyoungwe/pi-research", local, {})).toEqual({ savedConfigured: false });
	expect(
		await t.store.resolve("@gyoungwe/pi-research", local, {
			ZOTERO_LOCAL_API_KEY: envMarker,
			ZOTERO_LOCAL_SERVER_ID: "test-server",
		}),
	).toEqual({
		credential: { secret: envMarker, fields: { serverId: "test-server" }, source: "env" },
		savedConfigured: false,
	});
	expect(get).not.toHaveBeenCalled();
});

it.each([false, true])(
	"rejects literal-header delivery for an auth slot with saved state %s",
	async (saved) => {
		if (saved) await t.store.save(pluginId, slot, savedMarker, {});
		vi.stubEnv("DRONE_WEBDAV_PASSWORD", envMarker);
		await expect(
			credentialHeader(t.store, source, "webdav", new URL("http://10.126.126.1:8080/")),
		).rejects.toThrow(new Error("Credential webdav requires host HTTP authentication"));
	},
);
