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

import { type PluginCredentialSlot, PluginCredentialStore } from "@drone/backend";
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
};
const pluginId = "@gyoungwe/pi-research";
const runtime = (
	credentials: PluginCredentialSlot[],
	state: "enabled" | "unavailable",
	sourcePluginId = pluginId,
) => ({
	name: `package:/${state}`,
	source: { pluginId: sourcePluginId, credentials } as never,
	state,
});
const call = (method: keyof typeof PluginCredentialsContract.methods, ...args: unknown[]) =>
	mocks.handlers.get(channelOf(PluginCredentialsContract, method))?.({}, ...args);

const t = {} as { dir: string; path: string };
beforeEach(() => {
	mocks.handlers.clear();
	t.dir = mkdtempSync(join(tmpdir(), "plugin-credentials-ipc-"));
	t.path = join(t.dir, "plugin-credentials.json");
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
	{ owner: "@other/plugin", definition: localSlot },
	{ owner: pluginId, definition: { ...localSlot, hosts: ["evil.example"] } },
])("keeps the normal store editable for $owner at $definition.hosts", async ({ owner, definition }) => {
	registerPluginCredentialsIpc(
		{ runtimeSources: () => [runtime([definition], "enabled", owner)] },
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
});
