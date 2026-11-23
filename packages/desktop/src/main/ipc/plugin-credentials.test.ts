import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(channel, handler),
		removeHandler: vi.fn(),
	},
}));

import { consentForSource, type PluginCredentialSlot, PluginCredentialStore } from "@drone/backend";
import { channelOf, PluginCredentialsContract } from "@drone/shared";
import { registerPluginCredentialsIpc } from "./plugin-credentials";

const slot: PluginCredentialSlot = {
	slot: "zotero-web",
	label: { zh: "Zotero 网页 API 密钥", en: "Zotero Web API key" },
	hosts: ["api.zotero.org"],
	header: "Zotero-API-Key",
	fields: ["libraryType", "libraryId"],
};
const localSlot: PluginCredentialSlot = {
	slot: "zotero-local",
	label: { zh: "Zotero local writes", en: "Zotero local writes" },
	hosts: ["127.0.0.1:23119"],
	header: "Zotero-API-Key",
	fields: ["serverId"],
	custody: "host-environment",
};
const pluginId = "@gyoungwe/pi-research";
/** A listed source; unless told otherwise the user approved its policy at install. */
const runtime = (
	credentials: PluginCredentialSlot[],
	state: "enabled" | "unavailable",
	sourcePluginId = pluginId,
	approved = true,
) => {
	const declared = { pluginId: sourcePluginId, contentHash: "content-hash-1", credentials };
	const source = approved ? { ...declared, policyConsent: consentForSource(declared) } : declared;
	return { name: `package:/${state}`, source: source as never, state };
};
const call = (method: keyof typeof PluginCredentialsContract.methods, ...args: unknown[]) =>
	mocks.handlers.get(channelOf(PluginCredentialsContract, method))?.({}, ...args);

const t = {} as { dir: string; path: string };
beforeEach(() => {
	mocks.handlers.clear();
	t.dir = mkdtempSync(join(tmpdir(), "plugin-credentials-ipc-"));
	t.path = join(t.dir, "plugin-credentials.json");
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", undefined);
	// A stale copy declares an older slot definition; the enabled package's definition is the one shown.
	const stale = { ...slot, hosts: ["old.zotero.org"] };
	const manager = {
		runtimeSources: () => [runtime([stale], "unavailable"), runtime([slot, localSlot], "enabled")],
	};
	registerPluginCredentialsIpc(manager, new PluginCredentialStore(t.path));
});
afterEach(() => rmSync(t.dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

it("saves, lists and clears a declared slot without ever returning the secret", async () => {
	expect(await call("listPluginCredentials")).toEqual([
		{
			pluginId,
			slot: "zotero-web",
			label: slot.label,
			hosts: slot.hosts,
			fields: slot.fields,
			configured: false,
			source: null,
			savedConfigured: false,
			values: {},
		},
	]);

	const fields = { libraryType: "users", libraryId: "42" };
	await call("savePluginCredential", { pluginId, slot: "zotero-web", secret: "s3cret-key", fields });
	const listed = await call("listPluginCredentials");
	expect(listed).toMatchObject([{ configured: true, values: fields }]);
	expect(JSON.stringify(listed)).not.toContain("s3cret-key");
	expect(readFileSync(t.path, "utf8")).toContain("s3cret-key");
	// The plugin reads it through the same store under the enabled package's slot definition.
	expect((await new PluginCredentialStore(t.path).get(pluginId, slot))?.secret).toBe("s3cret-key");

	await call("clearPluginCredential", { pluginId, slot: "zotero-web" });
	expect(await call("listPluginCredentials")).toMatchObject([{ configured: false, values: {} }]);
});

it("refuses slots no discovered package declares and fields the slot does not list", async () => {
	await expect(
		call("savePluginCredential", { pluginId, slot: "other", secret: "x", fields: {} }),
	).rejects.toThrow("declares no credential slot other");
	await expect(
		call("savePluginCredential", { pluginId: "@someone/else", slot: "zotero-web", secret: "x", fields: {} }),
	).rejects.toThrow("declares no credential slot");
	await expect(
		call("savePluginCredential", { pluginId, slot: "zotero-web", secret: "x", fields: { libraryId: "1" } }),
	).rejects.toThrow("Credential fields must be exactly");
	expect(
		await call("savePluginCredential", { pluginId, slot: "zotero-web", secret: "", fields: {} }),
	).toMatchObject({
		code: "invalid_arguments",
	});
});

it.each([undefined, "FakeLocalKey123"])(
	"protects the host-kept local slot with environment key %s",
	async (key) => {
		vi.stubEnv("ZOTERO_LOCAL_API_KEY", key);
		const store = new PluginCredentialStore(t.path);
		await store.save(pluginId, localSlot, "FakeStoredLocalKey123", { serverId: "FakeStoredServer123" });
		const listed = await call("listPluginCredentials");
		expect(listed).toMatchObject([{ slot: "zotero-web" }]);
		expect(JSON.stringify(listed)).not.toContain("zotero-local");
		expect(JSON.stringify(listed)).not.toContain("FakeLocalKey123");
		expect(JSON.stringify(listed)).not.toContain("FakeStoredLocalKey123");
		await expect(
			call("savePluginCredential", {
				pluginId,
				slot: "zotero-local",
				secret: "FakeIpcLocalKey123",
				fields: { serverId: "FakeIpcServer123" },
			}),
		).rejects.toThrow("Credential zotero-local is managed in Zotero settings");
		await expect(call("clearPluginCredential", { pluginId, slot: "zotero-local" })).rejects.toThrow(
			"Credential zotero-local is managed in Zotero settings",
		);
		expect((await store.get(pluginId, localSlot))?.secret).toBe("FakeStoredLocalKey123");
	},
);

it.each([
	// The same shape, but the user never approved this package's policy.
	{ owner: "@other/plugin", definition: localSlot, approved: false },
	// Approved, but no host custody has this shape.
	{ owner: pluginId, definition: { ...localSlot, hosts: ["evil.example"] }, approved: true },
])(
	"keeps the normal store editable for $owner at $definition.hosts",
	async ({ owner, definition, approved }) => {
		registerPluginCredentialsIpc(
			{ runtimeSources: () => [runtime([definition], "enabled", owner, approved)] },
			new PluginCredentialStore(t.path),
		);
		const fields = { serverId: "FakePluginServer123" };
		await call("savePluginCredential", {
			pluginId: owner,
			slot: "zotero-local",
			secret: "FakePluginKey123",
			fields,
		});
		expect(await call("listPluginCredentials")).toMatchObject([
			{ pluginId: owner, slot: "zotero-local", configured: true, values: fields },
		]);
		await call("clearPluginCredential", { pluginId: owner, slot: "zotero-local" });
		expect(await call("listPluginCredentials")).toMatchObject([{ configured: false, values: {} }]);
	},
);

const webdavSlot: PluginCredentialSlot = {
	slot: "webdav",
	label: { zh: "WebDAV 密码", en: "WebDAV password" },
	hosts: ["10.126.126.1:8080"],
	header: "Authorization",
	fields: [],
	authentication: "http-basic-digest",
	custody: "host-environment",
};
const knowledgeId = "@gyoungwe/pi-knowledge";

it.each([
	{ name: "env only", saved: false, env: "TEST_ONLY_IPC_ENV_MARKER", source: "env" },
	{ name: "env plus saved", saved: true, env: "TEST_ONLY_IPC_ENV_MARKER", source: "env" },
	{ name: "saved only", saved: true, env: undefined, source: "saved" },
	{ name: "missing", saved: false, env: undefined, source: null },
	{ name: "empty env", saved: true, env: "", source: "saved" },
])("lists WebDAV $name with safe effective and saved metadata", async ({ saved, env, source }) => {
	const store = new PluginCredentialStore(t.path);
	registerPluginCredentialsIpc(
		{ runtimeSources: () => [runtime([webdavSlot], "enabled", knowledgeId)] },
		store,
	);
	if (saved) await store.save(knowledgeId, webdavSlot, "TEST_ONLY_IPC_SAVED_MARKER", {});
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", env);
	const result = await call("listPluginCredentials");
	expect(result).toEqual([
		{
			pluginId: knowledgeId,
			slot: "webdav",
			label: webdavSlot.label,
			hosts: webdavSlot.hosts,
			fields: [],
			values: {},
			authentication: "http-basic-digest",
			configured: source !== null,
			source,
			savedConfigured: saved,
		},
	]);
	for (const marker of ["TEST_ONLY_IPC_ENV_MARKER", "TEST_ONLY_IPC_SAVED_MARKER"])
		expect(JSON.stringify(result)).not.toContain(marker);
});

it("keeps WebDAV editable under the env override and reloads the current env each time", async () => {
	const store = new PluginCredentialStore(t.path);
	registerPluginCredentialsIpc(
		{ runtimeSources: () => [runtime([webdavSlot], "enabled", knowledgeId)] },
		store,
	);
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", "TEST_ONLY_IPC_ENV_MARKER");
	const target = { pluginId: knowledgeId, slot: "webdav" };
	await call("savePluginCredential", { ...target, secret: "TEST_ONLY_IPC_SAVED_MARKER", fields: {} });
	expect(await call("listPluginCredentials")).toMatchObject([{ source: "env", savedConfigured: true }]);
	await call("clearPluginCredential", target);
	expect(await call("listPluginCredentials")).toMatchObject([
		{
			configured: true,
			source: "env",
			savedConfigured: false,
		},
	]);
	expect(process.env.DRONE_WEBDAV_PASSWORD === "TEST_ONLY_IPC_ENV_MARKER").toBe(true);
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", undefined);
	expect(await call("listPluginCredentials")).toMatchObject([
		{
			configured: false,
			source: null,
			savedConfigured: false,
		},
	]);
});

it.each<{ name: string; readback: Awaited<ReturnType<PluginCredentialStore["get"]>> }>([
	{ name: "missing", readback: undefined },
	{
		name: "wrong secret",
		readback: {
			secret: "TEST_ONLY_WRONG_READBACK",
			fields: { libraryType: "users", libraryId: "42" },
			savedAt: "test",
		},
	},
	{
		name: "wrong fields",
		readback: {
			secret: "TEST_ONLY_READBACK_MARKER",
			fields: { libraryType: "users", libraryId: "43" },
			savedAt: "test",
		},
	},
	{
		name: "extra fields",
		readback: {
			secret: "TEST_ONLY_READBACK_MARKER",
			fields: { libraryType: "users", libraryId: "42", extra: "field" },
			savedAt: "test",
		},
	},
])("rejects save with a fixed safe error when readback is $name", async ({ readback }) => {
	const store = new PluginCredentialStore(t.path);
	vi.spyOn(store, "save").mockResolvedValue(undefined);
	vi.spyOn(store, "get").mockResolvedValue(readback);
	registerPluginCredentialsIpc({ runtimeSources: () => [runtime([slot], "enabled")] }, store);
	await expect(
		call("savePluginCredential", {
			pluginId,
			slot: slot.slot,
			secret: "TEST_ONLY_READBACK_MARKER",
			fields: { libraryType: "users", libraryId: "42" },
		}),
	).rejects.toThrow(new Error("Credential was not saved"));
});

it("rejects clear with a fixed safe error when the saved record remains", async () => {
	const store = new PluginCredentialStore(t.path);
	await store.save(pluginId, slot, "TEST_ONLY_CLEAR_READBACK_MARKER", {
		libraryType: "users",
		libraryId: "42",
	});
	vi.spyOn(store, "clear").mockResolvedValue(undefined);
	registerPluginCredentialsIpc({ runtimeSources: () => [runtime([slot], "enabled")] }, store);
	await expect(call("clearPluginCredential", { pluginId, slot: slot.slot })).rejects.toThrow(
		new Error("Credential was not cleared"),
	);
});
