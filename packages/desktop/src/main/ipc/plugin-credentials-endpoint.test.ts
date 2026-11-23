import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { consentForSource, type PluginCredentialSlot, PluginCredentialStore } from "@drone/backend";
import { channelOf, type PluginCredentialEntry, PluginCredentialsContract } from "@drone/shared";
import { Check } from "typebox/value";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UiPluginManager } from "../ui-plugins/manager";
import { registerPluginCredentialsIpc } from "./plugin-credentials";

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(channel, handler),
		removeHandler: vi.fn(),
	},
}));

const pluginId = "@gyoungwe/pi-knowledge";
type RuntimeEntry = ReturnType<UiPluginManager["runtimeSources"]>[number];
const slot: PluginCredentialSlot = {
	slot: "webdav",
	label: { zh: "WebDAV password", en: "WebDAV password" },
	hosts: ["10.126.126.1:8080"],
	header: "Authorization",
	fields: [],
	authentication: "http-basic-digest",
	custody: "host-environment",
};
const declared: RuntimeEntry["source"] = {
	pluginId,
	packageRoot: "/fixture/knowledge",
	entrypoint: "/fixture/knowledge/runtime.mjs",
	contentHash: "fixture-knowledge-content",
	installationPath: "/fixture/knowledge",
	networkHosts: slot.hosts,
	credentials: [slot],
	networkPolicy: { runtimeEndpoint: { allowed: true, credentialSlot: "webdav" } },
};
/** The user approved the package's policy at install: the runtime endpoint may be configured. */
const source: RuntimeEntry["source"] = { ...declared, policyConsent: consentForSource(declared) };
const fixture = {} as { dir: string; store: PluginCredentialStore };
const runtime = (
	declared: RuntimeEntry["source"] = source,
	state: RuntimeEntry["state"] = "enabled",
): RuntimeEntry => ({ name: `${declared.pluginId}/${state}`, source: declared, state });
const register = (sources: RuntimeEntry[] = [runtime()]) =>
	registerPluginCredentialsIpc({ runtimeSources: () => sources }, fixture.store);
const call = (method: keyof typeof PluginCredentialsContract.methods, ...args: unknown[]) => {
	const handler = mocks.handlers.get(channelOf(PluginCredentialsContract, method));
	if (!handler) throw new Error("Test IPC handler was not registered");
	return handler({}, ...args);
};
const list = async () => (await call("listPluginCredentials")) as PluginCredentialEntry[];
const schema = PluginCredentialsContract.methods.listPluginCredentials.result;

beforeEach(() => {
	mocks.handlers.clear();
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", undefined);
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", undefined);
	const scratch = join(process.cwd(), "../../.codex-tmp");
	mkdirSync(scratch, { recursive: true });
	fixture.dir = mkdtempSync(join(scratch, "endpoint-ipc-"));
	fixture.store = new PluginCredentialStore(join(fixture.dir, "credentials.json"));
	register();
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	rmSync(fixture.dir, { recursive: true, force: true });
});

it("lists the default endpoint and declared hosts when env is unset", async () => {
	const entries = await list();
	expect(entries).toMatchObject([
		{
			endpoint: { state: "ready", url: "http://10.126.126.1:8080", source: "default" },
			hosts: slot.hosts,
			configured: false,
		},
	]);
	expect(Check(schema, entries)).toBe(true);
});

it("lists the env endpoint with both hosts and deduplicates the declared default", async () => {
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", "https://dav.example:8443");
	expect(await list()).toMatchObject([
		{
			endpoint: { state: "ready", url: "https://dav.example:8443", source: "env" },
			hosts: ["10.126.126.1:8080", "dav.example:8443"],
		},
	]);
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", "http://10.126.126.1:8080");
	expect(await list()).toMatchObject([{ hosts: ["10.126.126.1:8080"] }]);
	expect(source.credentials).toEqual([slot]);
});

it("reads endpoint env afresh between list calls", async () => {
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", "https://first.example:8443");
	expect(await list()).toMatchObject([{ endpoint: { url: "https://first.example:8443" } }]);
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", "https://second.example:9443");
	expect(await list()).toMatchObject([
		{
			endpoint: { url: "https://second.example:9443", source: "env" },
			hosts: ["10.126.126.1:8080", "second.example:9443"],
		},
	]);
});

it("projects only fixed invalid metadata without disclosing synthetic userinfo", async () => {
	const raw = `https://user:${["SYN", "TH"].join("")}@x:1/`;
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", raw);
	const entries = await list();
	expect(entries).toMatchObject([
		{ endpoint: { state: "invalid", reason: "invalid_endpoint" }, hosts: slot.hosts },
	]);
	expect(JSON.stringify(entries)).not.toContain(raw);
	expect(JSON.stringify(entries)).not.toContain("SYNTH");
	expect(Check(schema, entries)).toBe(true);
});

it("omits endpoint for another plugin's webdav slot", async () => {
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", "https://dav.example:8443");
	register([runtime({ ...source, pluginId: "@other/plugin" })]);
	const entries = await list();
	expect(entries[0]).not.toHaveProperty("endpoint");
	expect(entries[0]).toMatchObject({ hosts: slot.hosts });
	expect(Check(schema, entries)).toBe(true);
});

it("omits endpoint for another pi-knowledge slot", async () => {
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", "https://dav.example:8443");
	// Approved as declared with both slots; the endpoint still rides on the slot the policy names.
	const both = { ...declared, credentials: [slot, { ...slot, slot: "other" }] };
	register([runtime({ ...both, policyConsent: consentForSource(both) })]);
	const entries = await list();
	expect(entries[0]).toHaveProperty("endpoint");
	expect(entries[1]).not.toHaveProperty("endpoint");
	expect(entries[1]).toMatchObject({ hosts: slot.hosts });
	expect(Check(schema, entries)).toBe(true);
});

it("omits endpoint when pi-knowledge lacks the eligible declaration", async () => {
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", "https://dav.example:8443");
	register([runtime({ ...source, networkHosts: [] })]);
	const entries = await list();
	expect(entries[0]).not.toHaveProperty("endpoint");
	expect(Check(schema, entries)).toBe(true);
	register([runtime({ ...source, credentials: [] })]);
	expect(await list()).toEqual([]);
});

it("keeps both endpoint branches closed in the TypeBox contract", async () => {
	const [entry] = await list();
	const ready = { state: "ready", url: "https://dav.example:8443", source: "env" };
	const invalid = { state: "invalid", reason: "invalid_endpoint" };
	for (const endpoint of [ready, invalid]) {
		expect(Check(schema, [{ ...entry, endpoint }])).toBe(true);
		expect(Check(schema, [{ ...entry, endpoint: { ...endpoint, extra: true } }])).toBe(false);
	}
	expect(Check(schema, [{ ...entry, extra: true }])).toBe(false);
	expect(Check(schema, [{ ...entry, endpoint: { ...ready, source: "saved" } }])).toBe(false);
});

it.each(["stale first", "stale last"])("uses the enabled source with %s", async (order) => {
	const stale = runtime({ ...source, networkHosts: [] }, "unavailable");
	register(order === "stale first" ? [stale, runtime()] : [runtime(), stale]);
	expect(await list()).toMatchObject([{ endpoint: { source: "default" } }]);
});

it("saves and clears using the original declared slot while endpoint env is set", async () => {
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", "https://dav.example:8443");
	const save = vi.spyOn(fixture.store, "save");
	const clear = vi.spyOn(fixture.store, "clear");
	const resolve = vi.spyOn(fixture.store, "resolve");
	const secret = "TEST_ONLY_ENDPOINT_SAVE";
	const target = { pluginId, slot: "webdav" };
	await call("savePluginCredential", { ...target, secret, fields: {} });
	expect(save.mock.calls[0]?.[1]).toBe(slot);
	expect((await fixture.store.get(pluginId, slot))?.secret === secret).toBe(true);
	expect(await list()).toMatchObject([{ configured: true, savedConfigured: true }]);
	expect(resolve.mock.calls[0]?.[1]).toBe(slot);
	await call("clearPluginCredential", target);
	expect(clear.mock.calls[0]?.[1]).toBe(slot);
	expect(await fixture.store.get(pluginId, slot)).toBeUndefined();
});

it("performs no network IO while listing endpoints", async () => {
	const fetch = vi.spyOn(globalThis, "fetch");
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", "https://dav.example:8443");
	await list();
	expect(fetch).not.toHaveBeenCalled();
});
