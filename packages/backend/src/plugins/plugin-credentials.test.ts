import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { networkCapabilityHandlers } from "./network-capabilities";
import {
	credentialCapabilityHandlers,
	credentialHeader,
	credentialHeaders,
	type PluginCredentialSlot,
	PluginCredentialStore,
} from "./plugin-credentials";
import type { PluginRuntimeSource } from "./plugin-source";

const slot: PluginCredentialSlot = {
	slot: "zotero-web",
	label: { zh: "Zotero 网页 API 密钥", en: "Zotero Web API key" },
	hosts: ["api.zotero.org"],
	header: "Zotero-API-Key",
	fields: ["libraryType", "libraryId"],
};
const source = {
	pluginId: "@gyoungwe/pi-research",
	packageRoot: "/pkg",
	entrypoint: "/pkg/runtime.mjs",
	networkHosts: ["api.zotero.org", "example.org"],
	credentials: [slot],
} as PluginRuntimeSource;
const fields = { libraryType: "user", libraryId: "42" };
const context = { signal: new AbortController().signal } as Parameters<
	ReturnType<typeof networkCapabilityHandlers>["network.read"]["execute"]
>[1];

const t = {} as { dir: string; store: PluginCredentialStore };
beforeEach(() => {
	t.dir = mkdtempSync(join(tmpdir(), "plugin-credentials-"));
	t.store = new PluginCredentialStore(join(t.dir, "plugin-credentials.json"));
});
afterEach(() => rmSync(t.dir, { recursive: true, force: true }));

function network(fetchImpl = vi.fn(async () => new Response("{}"))) {
	const handlers = networkCapabilityHandlers(
		{
			hosts: source.networkHosts ?? [],
			reads: [],
			credentials: {
				headers: credentialHeaders(source),
				header: (name, url) => credentialHeader(t.store, source, name, url),
			},
		},
		fetchImpl,
	);
	return { read: handlers["network.read"], fetchImpl };
}

describe("plugin credential t.store", () => {
	it("keeps the secret in an owner-only file and keeps it across versions of the same slot", async () => {
		await t.store.save(source.pluginId, slot, "s3cret", fields);
		expect(statSync(join(t.dir, "plugin-credentials.json")).mode & 0o777).toBe(0o600);
		// The version is not part of the key: an update that keeps the slot keeps the credential.
		expect(await t.store.get(source.pluginId, { ...slot })).toMatchObject({ secret: "s3cret", fields });
	});

	it("drops a credential when the slot definition changes, and never shares it with another plugin", async () => {
		await t.store.save(source.pluginId, slot, "s3cret", fields);
		expect(
			await t.store.get(source.pluginId, { ...slot, hosts: ["api.zotero.org", "example.org"] }),
		).toBeUndefined();
		expect(await t.store.get(source.pluginId, { ...slot, header: "Authorization" })).toBeUndefined();
		expect(await t.store.get("@other/plugin", slot)).toBeUndefined();
		await t.store.clear(source.pluginId, slot);
		expect(await t.store.get(source.pluginId, slot)).toBeUndefined();
	});

	it("rejects an empty secret and fields the slot does not declare", async () => {
		await expect(t.store.save(source.pluginId, slot, " ", fields)).rejects.toThrow("empty");
		await expect(t.store.save(source.pluginId, slot, "s", { libraryId: "42" })).rejects.toThrow("exactly");
		await expect(t.store.save(source.pluginId, slot, "s", { ...fields, extra: "x" })).rejects.toThrow(
			"exactly",
		);
	});

	it("reports configured slots and their fields without the secret", async () => {
		const status = credentialCapabilityHandlers(t.store, source)["credentials.status"];
		expect(await status.execute(null, context)).toEqual({
			slots: { "zotero-web": { configured: false, fields: {} } },
		});
		await t.store.save(source.pluginId, slot, "s3cret", fields);
		const result = await status.execute(null, context);
		expect(result).toEqual({ slots: { "zotero-web": { configured: true, fields } } });
		expect(JSON.stringify(result)).not.toContain("s3cret");
	});
});

describe("credentials on network requests", () => {
	it("adds the saved secret as the slot's header", async () => {
		await t.store.save(source.pluginId, slot, "s3cret", fields);
		const { read, fetchImpl } = network();
		await read.execute(
			{ method: "GET", url: "https://api.zotero.org/keys/current", credential: "zotero-web" },
			context,
		);
		expect(fetchImpl).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ headers: { "Zotero-API-Key": "s3cret" } }),
		);
	});

	it("sends nothing when the slot is unsaved, undeclared or the host is outside it", async () => {
		const { read, fetchImpl } = network();
		const get = (url: string, credential: string) =>
			read.execute({ method: "GET", url, credential }, context);
		await expect(get("https://api.zotero.org/keys/current", "zotero-web")).rejects.toThrow("not configured");
		await t.store.save(source.pluginId, slot, "s3cret", fields);
		await expect(get("https://example.org/", "zotero-web")).rejects.toThrow("may not be sent to example.org");
		await expect(get("https://api.zotero.org/", "other")).rejects.toThrow("not declared");
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("refuses a plugin that sets a credential header itself", async () => {
		const { read, fetchImpl } = network();
		await expect(
			read.execute(
				{ method: "GET", url: "https://api.zotero.org/", headers: { "zotero-api-key": "x" } },
				context,
			),
		).rejects.toThrow("reserved for the host");
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("refuses a credential from a source that declares none", async () => {
		const fetchImpl = vi.fn(async () => new Response("{}"));
		const { "network.read": read } = networkCapabilityHandlers(
			{ hosts: ["api.zotero.org"], reads: [] },
			fetchImpl,
		);
		await expect(
			read.execute({ method: "GET", url: "https://api.zotero.org/", credential: "zotero-web" }, context),
		).rejects.toThrow("not declared");
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
