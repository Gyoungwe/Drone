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
const pluginId = "@gyoungwe/pi-research";
const runtime = (credentials: PluginCredentialSlot[], state: "enabled" | "unavailable") => ({
	name: `package:/${state}`,
	source: { pluginId, credentials } as never,
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
	const manager = { runtimeSources: () => [runtime([stale], "unavailable"), runtime([slot], "enabled")] };
	registerPluginCredentialsIpc(manager, new PluginCredentialStore(t.path));
});
afterEach(() => rmSync(t.dir, { recursive: true, force: true }));

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
