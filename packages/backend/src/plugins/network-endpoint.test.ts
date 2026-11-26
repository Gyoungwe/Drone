import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PluginCredentialStore } from "./plugin-credentials";
import type { PluginRuntimeSource } from "./plugin-source";
import { consentForSource } from "./policy-consent";
import { PluginCapabilityBroker, type PluginCapabilityContext } from "./runtime-capabilities";
import { sourceCapabilityHandlers } from "./source-capabilities";
import { TaskGrantStore } from "./task-grants";

const endpointA = "https://dav.example:8443";
const endpointB = "https://next.example:9443";
const marker = "TEST_ONLY_NETWORK_ENDPOINT_MARKER";
const slot = {
	slot: "webdav",
	label: { zh: "WebDAV", en: "WebDAV" },
	hosts: ["10.126.126.1:8080"],
	header: "Authorization",
	fields: [],
	authentication: "http-basic-digest" as const,
	custody: "host-environment" as const,
};
const declared = {
	pluginId: "@gyoungwe/pi-knowledge",
	packageRoot: "/fixture",
	entrypoint: "/fixture/runtime.mjs",
	contentHash: "content-hash-1",
	networkHosts: ["10.126.126.1:8080", "public.example"],
	credentials: [slot, { ...slot, slot: "other" }],
	networkPolicy: { runtimeEndpoint: { allowed: true as const, credentialSlot: "webdav" } },
};
/** The user approved the package's policy at install: the runtime endpoint and the host's password. */
const source: PluginRuntimeSource = { ...declared, policyConsent: consentForSource(declared) };
const context: Omit<PluginCapabilityContext, "capabilities"> = {
	pluginId: source.pluginId,
	applicationId: "fixture",
	scope: { kind: "application" },
	callerIdentity: undefined,
	signal: new AbortController().signal,
	bootstrap: false,
};
const sessions = { get: () => undefined, signalFor: () => context.signal };
const store = new PluginCredentialStore(".codex-tmp/T103-unused-network.json");
const host = { sessions, taskGrants: new TaskGrantStore(sessions), credentials: store };
const request = {
	method: "GET",
	url: `${endpointA}/notes`,
	credential: "webdav",
	httpAuth: { username: "fixture-user" },
};
const basicChallenge = () =>
	new Response(marker, { status: 401, headers: { "WWW-Authenticate": "Basic realm=fixture" } });

function fixture(candidate = source) {
	const resolve = vi.spyOn(store, "resolve").mockResolvedValue({
		credential: { secret: marker, source: "saved", fields: {} },
		savedConfigured: true,
	});
	const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response("ok"));
	vi.stubGlobal("fetch", fetchImpl);
	const handlers = sourceCapabilityHandlers(host, candidate);
	const broker = new PluginCapabilityBroker({ handlers, resources: [] });
	const call = (input: unknown = request, authorize = async () => true, name = "network.read") =>
		broker.run(context, "write", vi.fn(), authorize, () => broker.port.call(name, input));
	return { resolve, fetchImpl, handlers, call };
}

beforeEach(() => {
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", endpointA);
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", undefined);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

it("admits the override only through webdav HTTP authentication", async () => {
	const { call, resolve, fetchImpl } = fixture();
	fetchImpl.mockResolvedValueOnce(basicChallenge());
	await call();
	expect(resolve).toHaveBeenCalledOnce();
	expect(fetchImpl).toHaveBeenCalledTimes(2);
	expect(fetchImpl.mock.calls.every(([url]) => String(url) === request.url)).toBe(true);
	expect(new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get("authorization")).toBe(
		`Basic ${Buffer.from(`fixture-user:${marker}`).toString("base64")}`,
	);
});

it.each([
	["different port", { url: "https://dav.example:9443/notes" }],
	["different scheme", { url: "http://dav.example:8443/notes" }],
	["host alias", { url: "https://alias.example:8443/notes" }],
	["subdomain", { url: "https://sub.dav.example:8443/notes" }],
	["no credential", { credential: undefined }],
	["another slot", { credential: "other" }],
	["no HTTP auth metadata", { httpAuth: undefined }],
	["forged Authorization", { headers: { Authorization: marker } }],
])("refuses %s before secret lookup and fetch", async (_name, change) => {
	const { call, resolve, fetchImpl } = fixture();
	await expect(call({ ...request, ...change })).rejects.toThrow();
	expect(resolve).not.toHaveBeenCalled();
	expect(fetchImpl).not.toHaveBeenCalled();
});

it("does not grant another plugin the host after a pi-knowledge success", async () => {
	const first = fixture();
	await first.call();
	first.resolve.mockClear();
	const other = fixture({ ...source, pluginId: "@other/plugin" });
	await expect(other.call()).rejects.toThrow("not declared");
	expect(other.resolve).not.toHaveBeenCalled();
	expect(other.fetchImpl).not.toHaveBeenCalled();
});

it.each([
	["http://dav.example:80", "http://dav.example/notes"],
	["https://dav.example:443", "https://dav.example/notes"],
	["https://[2001:db8::1]:443", "https://[2001:db8::1]/notes"],
])("admits the normalized default-port origin %#", async (endpoint, url) => {
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", endpoint);
	const { call, fetchImpl } = fixture();
	await call({ ...request, url });
	expect(fetchImpl).toHaveBeenCalledOnce();
});

it("revokes A across B, unset and invalid values in retained handlers", async () => {
	const { call, resolve, fetchImpl } = fixture();
	await call();
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", endpointB);
	await expect(call()).rejects.toThrow();
	await call({ ...request, url: `${endpointB}/notes` });
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", undefined);
	await expect(call()).rejects.toThrow();
	await call({ ...request, url: "http://10.126.126.1:8080/notes" });
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", "invalid");
	resolve.mockClear();
	fetchImpl.mockClear();
	await expect(call({ ...request, url: "http://10.126.126.1:8080/notes" })).rejects.toThrow(
		/^invalid_endpoint$/,
	);
	expect(resolve).not.toHaveBeenCalled();
	expect(fetchImpl).not.toHaveBeenCalled();
	await call({ method: "GET", url: "https://public.example/", credential: undefined, httpAuth: undefined });
	expect(fetchImpl).toHaveBeenCalledOnce();
});

it.each([endpointB, undefined, "invalid"])(
	"rejects an endpoint change during write approval %#",
	async (next) => {
		const { call, resolve, fetchImpl } = fixture();
		const authorize = vi.fn(async () => {
			vi.stubEnv("DRONE_WEBDAV_ENDPOINT", next);
			return true;
		});
		await expect(call({ ...request, method: "PUT" }, authorize, "network.write")).rejects.toMatchObject({
			code: "EPLUGINENDPOINTCHANGED",
			message: "EPLUGINENDPOINTCHANGED",
		});
		expect(authorize).toHaveBeenCalledOnce();
		expect(resolve).not.toHaveBeenCalled();
		expect(fetchImpl).not.toHaveBeenCalled();
	},
);

it("binds approval even for an originally declared destination", async () => {
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", undefined);
	const { call, fetchImpl } = fixture();
	await expect(
		call(
			{ ...request, url: "http://10.126.126.1:8080/notes", method: "PUT" },
			async () => {
				vi.stubEnv("DRONE_WEBDAV_ENDPOINT", endpointA);
				return true;
			},
			"network.write",
		),
	).rejects.toMatchObject({ code: "EPLUGINENDPOINTCHANGED" });
	expect(fetchImpl).not.toHaveBeenCalled();
});

it("binds concurrent approvals independently when calls reuse the same input object", async () => {
	const { call, fetchImpl } = fixture();
	const input = { ...request, method: "PUT", url: "http://10.126.126.1:8080/notes" };
	const releases: Array<() => void> = [];
	const authorize = () => new Promise<boolean>((resolve) => releases.push(() => resolve(true)));
	const first = call(input, authorize, "network.write");
	const second = call(input, authorize, "network.write");
	const [releaseFirst, releaseSecond] = releases;
	if (!releaseFirst || !releaseSecond) throw new Error("Expected two pending approvals");
	releaseFirst();
	await first;
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", endpointB);
	releaseSecond();
	await expect(second).rejects.toMatchObject({ code: "EPLUGINENDPOINTCHANGED" });
	expect(fetchImpl).toHaveBeenCalledOnce();
});

it("allows a fresh approval after denial when the input object is reused", async () => {
	const { call, fetchImpl } = fixture();
	const input = { ...request, method: "PUT", url: "http://10.126.126.1:8080/notes" };
	await expect(call(input, async () => false, "network.write")).rejects.toThrow("Plugin capability denied");
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", endpointB);
	await call(input, async () => true, "network.write");
	expect(fetchImpl).toHaveBeenCalledOnce();
});

it("keeps POST a write and requires Depth 0 for override PROPFIND", async () => {
	const { call, resolve, fetchImpl } = fixture();
	await expect(call({ ...request, method: "POST" })).rejects.toThrow("network write");
	await expect(call({ ...request, method: "PROPFIND" })).rejects.toThrow("Depth: 0");
	expect(resolve).not.toHaveBeenCalled();
	expect(fetchImpl).not.toHaveBeenCalled();
	await call({ ...request, method: "PROPFIND", headers: { Depth: "0" } });
	expect(fetchImpl).toHaveBeenCalledOnce();
});

it("keeps invalid userinfo and auth metadata out of errors, config results and approval details", async () => {
	const raw = `https://user:${marker}@dav.example:8443`;
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", raw);
	const { call, resolve, fetchImpl } = fixture();
	const config = await call({ slot: "webdav" }, async () => true, "config.endpoint");
	expect(JSON.stringify(config)).not.toContain(raw);
	expect(JSON.stringify(config)).not.toContain(marker);
	const authorize = vi.fn(async () => true);
	const failure = await call(
		{ ...request, method: "PUT", httpAuth: { username: marker } },
		authorize,
		"network.write",
	).catch((error: unknown) => error);
	expect(failure).toMatchObject({ message: "invalid_endpoint" });
	expect(String(failure)).not.toContain(raw);
	expect(String(failure)).not.toContain(marker);
	expect(authorize).not.toHaveBeenCalled();
	expect(resolve).not.toHaveBeenCalled();
	expect(fetchImpl).not.toHaveBeenCalled();
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", endpointA);
	const details: Array<string | undefined> = [];
	const broker = new PluginCapabilityBroker({
		handlers: sourceCapabilityHandlers(host, source),
		resources: [],
	});
	await broker
		.run(
			context,
			"write",
			vi.fn(),
			async (_name, _input, _effect, detail) => {
				details.push(detail);
				return false;
			},
			() => broker.port.call("network.write", { ...request, method: "PUT", httpAuth: { username: marker } }),
		)
		.catch(() => undefined);
	expect(details).toHaveLength(1);
	expect(JSON.stringify(details)).not.toContain(marker);
});
