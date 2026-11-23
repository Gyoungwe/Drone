import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolvePluginEndpointPolicy } from "./endpoint-policy";
import { authenticatedRequest } from "./http-transport";
import { credentialHeader, credentialSlot, PluginCredentialStore } from "./plugin-credentials";
import type { PluginRuntimeSource } from "./plugin-source";
import { consentForSource } from "./policy-consent";
import type { PluginCapabilityContext } from "./runtime-capabilities";
import { sourceCapabilityHandlers } from "./source-capabilities";
import { TaskGrantStore } from "./task-grants";

const endpointA = "https://dav.example:8443";
const marker = "TEST_ONLY_CREDENTIAL_ENDPOINT_MARKER";
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
	networkHosts: slot.hosts,
	credentials: [slot],
	networkPolicy: { runtimeEndpoint: { allowed: true as const, credentialSlot: "webdav" } },
};
/** The user approved the package's policy at install: the runtime endpoint and the host's password. */
const source: PluginRuntimeSource = { ...declared, policyConsent: consentForSource(declared) };
const context = { signal: new AbortController().signal } as PluginCapabilityContext;
const sessions = { get: () => undefined, signalFor: () => context.signal };
const fixture = {} as { root: string; store: PluginCredentialStore };
const request = {
	method: "GET",
	url: `${endpointA}/notes`,
	credential: "webdav",
	httpAuth: { username: "fixture-user" },
};

beforeEach(async () => {
	const scratch = join(process.cwd(), ".codex-tmp");
	await mkdir(scratch, { recursive: true });
	fixture.root = await mkdtemp(join(scratch, "T103-credentials-"));
	fixture.store = new PluginCredentialStore(join(fixture.root, "credentials.json"));
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", endpointA);
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", undefined);
});
afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await rm(fixture.root, { recursive: true, force: true });
});

function network(fetchImpl: typeof fetch) {
	vi.stubGlobal("fetch", fetchImpl);
	const host = { sessions, taskGrants: new TaskGrantStore(sessions), credentials: fixture.store };
	const handler = sourceCapabilityHandlers(host, source)["network.read"];
	if (!handler) throw new Error("Expected network capability");
	return (input = request) => handler.execute(input, context);
}

it("checks effective credential destinations and returns the original declared slot", () => {
	const policy = resolvePluginEndpointPolicy(source, endpointA);
	expect(credentialSlot(source, "webdav", new URL(request.url), policy, true)).toBe(slot);
	for (const url of ["http://dav.example:8443/", "https://dav.example:9443/", "https://alias.example:8443/"])
		expect(() => credentialSlot(source, "webdav", new URL(url), policy, true)).toThrow();
	expect(() => credentialSlot(source, "webdav", new URL(request.url), policy, false)).toThrow();
});

it("passes only the ORIGINAL slot to resolve/get across default, A and unset selection", async () => {
	await fixture.store.save(source.pluginId, slot, marker, {});
	const resolve = vi.spyOn(fixture.store, "resolve");
	const get = vi.spyOn(fixture.store, "get");
	const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response("ok"));
	const read = network(fetchImpl);
	for (const [raw, url] of [
		[undefined, "http://10.126.126.1:8080/"],
		[endpointA, request.url],
		[undefined, "http://10.126.126.1:8080/"],
	] as const) {
		vi.stubEnv("DRONE_WEBDAV_ENDPOINT", raw);
		await read({ ...request, url });
	}
	expect(resolve).toHaveBeenCalledTimes(3);
	expect(get).toHaveBeenCalledTimes(3);
	for (const spy of [resolve, get])
		for (const [pluginId, original] of spy.mock.calls) {
			expect(pluginId).toBe(source.pluginId);
			expect(original).toBe(slot);
			expect(original).toEqual(slot);
		}
	expect((await fixture.store.resolve(source.pluginId, slot)).credential?.secret).toBe(marker);
});

it("refuses runtime credential delivery without policy or through the literal header path", async () => {
	const resolve = vi.spyOn(fixture.store, "resolve");
	expect(() => credentialSlot(source, "webdav", new URL(request.url))).toThrow();
	await expect(
		credentialHeader(
			fixture.store,
			source,
			"webdav",
			new URL(request.url),
			resolvePluginEndpointPolicy(source, endpointA),
		),
	).rejects.toThrow();
	expect(resolve).not.toHaveBeenCalled();
});

it("revokes a retained authenticated sender before resolving its secret", async () => {
	const resolve = vi.spyOn(fixture.store, "resolve");
	const send = vi.fn();
	const initial = process.env.DRONE_WEBDAV_ENDPOINT;
	const access = {
		policy: resolvePluginEndpointPolicy(source, initial),
		check: () => {
			if (process.env.DRONE_WEBDAV_ENDPOINT !== initial)
				throw Object.assign(new Error("EPLUGINENDPOINTCHANGED"), { code: "EPLUGINENDPOINTCHANGED" });
		},
	};
	const authenticate = authenticatedRequest(
		fixture.store,
		source,
		"webdav",
		new URL(request.url),
		"fixture-user",
		access,
	);
	if (!authenticate) throw new Error("Expected HTTP auth sender");
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", undefined);
	await expect(authenticate("GET", send)).rejects.toMatchObject({ code: "EPLUGINENDPOINTCHANGED" });
	expect(resolve).not.toHaveBeenCalled();
	expect(send).not.toHaveBeenCalled();
});

it.each([undefined, "https://next.example:9443", "invalid"])(
	"rechecks after asynchronous password resolution %#",
	async (next) => {
		const resolve = vi.spyOn(fixture.store, "resolve").mockImplementation(async () => {
			await Promise.resolve();
			vi.stubEnv("DRONE_WEBDAV_ENDPOINT", next);
			return { credential: { secret: marker, source: "saved", fields: {} }, savedConfigured: true };
		});
		const fetchImpl = vi.fn<typeof fetch>();
		await expect(network(fetchImpl)()).rejects.toMatchObject({
			code: "EPLUGINENDPOINTCHANGED",
			message: "EPLUGINENDPOINTCHANGED",
		});
		expect(resolve).toHaveBeenCalledOnce();
		expect(fetchImpl).not.toHaveBeenCalled();
	},
);

it.each(["Basic realm=fixture", 'Digest realm="fixture", nonce="fixture", qop="auth"'])(
	"prevents replay after a 401 challenge changes the endpoint %#",
	async (challenge) => {
		await fixture.store.save(source.pluginId, slot, marker, {});
		const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
			vi.stubEnv("DRONE_WEBDAV_ENDPOINT", undefined);
			return new Response(marker, { status: 401, headers: { "WWW-Authenticate": challenge } });
		});
		await expect(network(fetchImpl)()).rejects.toMatchObject({
			code: "EPLUGINENDPOINTCHANGED",
			message: "EPLUGINENDPOINTCHANGED",
		});
		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has("Authorization")).toBe(false);
	},
);

it.each(["https://other.example:8443/", "https://dav.example:9443/"])(
	"refuses a redirect without sending credentials to its destination %#",
	async (location) => {
		await fixture.store.save(source.pluginId, slot, marker, {});
		const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
			expect(options?.redirect).toBe("error");
			throw new TypeError(`${marker} ${location}`);
		});
		const error = await network(fetchImpl)().catch((failure: unknown) => failure);
		expect(error).toMatchObject({ message: "Authenticated network request failed" });
		expect(String(error)).not.toContain(marker);
		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has("Authorization")).toBe(false);
	},
);

it("keeps transport diagnostics, challenge bodies and private headers out of capability results", async () => {
	await fixture.store.save(source.pluginId, slot, marker, {});
	const fetchImpl = vi
		.fn<typeof fetch>()
		.mockRejectedValueOnce(new Error(marker))
		.mockResolvedValueOnce(
			new Response(marker, { status: 401, headers: { "WWW-Authenticate": "Basic realm=fixture" } }),
		)
		.mockResolvedValueOnce(
			new Response(marker, { status: 403, headers: { "X-Private": marker, "WWW-Authenticate": marker } }),
		);
	const read = network(fetchImpl);
	const error = await read().catch((failure: unknown) => failure);
	expect(String(error)).not.toContain(marker);
	const result = await read();
	expect(result).toMatchObject({ status: 403, base64: "", bytes: 0 });
	expect(JSON.stringify(result)).not.toContain(marker);
});
