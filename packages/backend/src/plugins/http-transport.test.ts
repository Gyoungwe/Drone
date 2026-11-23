import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HttpAuthChallenges } from "./http-auth";
import { authenticatedRequest } from "./http-transport";
import { networkCapabilityHandlers } from "./network-capabilities";
import { credentialHeader, credentialHeaders, PluginCredentialStore } from "./plugin-credentials";
import type { PluginRuntimeSource } from "./plugin-source";
import { consentForSource } from "./policy-consent";
import { sourceCapabilityHandlers } from "./source-capabilities";
import { TaskGrantStore } from "./task-grants";

const marker = "TEST_ONLY_W2C_SECRET_MARKER";
const slot = {
	slot: "webdav",
	label: { zh: "WebDAV", en: "WebDAV" },
	hosts: ["dav.test"],
	header: "Authorization",
	fields: [],
	authentication: "http-basic-digest" as const,
	custody: "host-environment" as const,
};
// Declares host custody too, but no host custody has its shape: it stays a slot the user fills.
const literal = { ...slot, slot: "literal", header: "X-Api-Key", authentication: undefined };
const declared = {
	pluginId: "@gyoungwe/pi-knowledge",
	packageRoot: "/fixture",
	entrypoint: "/fixture/runtime.mjs",
	contentHash: "a".repeat(64),
	networkHosts: ["dav.test", "other.test"],
	credentials: [slot, literal],
};
const source: PluginRuntimeSource = { ...declared, policyConsent: consentForSource(declared) };
const request = {
	method: "PROPFIND",
	url: "https://dav.test/collection?version=2",
	headers: { Depth: "0" },
	credential: "webdav",
	httpAuth: { username: "fixture-user" },
};
const context = { signal: new AbortController().signal } as Parameters<
	ReturnType<typeof networkCapabilityHandlers>["network.read"]["execute"]
>[1];
const fixture = {} as { root: string; store: PluginCredentialStore };
beforeEach(async () => {
	fixture.root = await mkdtemp(join(tmpdir(), "w2c-http-"));
	fixture.store = new PluginCredentialStore(join(fixture.root, "credentials.json"));
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", undefined);
});
afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await rm(fixture.root, { recursive: true, force: true });
});

function handlers(fetchImpl: typeof fetch, selectedSource = source, store = fixture.store) {
	return networkCapabilityHandlers(
		{
			hosts: selectedSource.networkHosts ?? [],
			reads: [],
			credentials: {
				headers: credentialHeaders(selectedSource),
				header: (name, url) => credentialHeader(store, selectedSource, name, url),
				authenticate: (name, url, username) =>
					authenticatedRequest(store, selectedSource, name, url, username),
			},
		},
		fetchImpl,
	);
}
const md5 = (value: string) => createHash("md5").update(value).digest("hex");
const challenge = () =>
	new Response(marker, {
		status: 401,
		headers: { "www-authenticate": 'Digest realm="fixture", nonce="nonce-a", qop="auth"' },
	});
function expectDigest(header: string | null, method: string, secret = marker, count = "00000001") {
	const cnonce = header?.match(/cnonce="([a-f0-9]{32})"/)?.[1];
	expect(cnonce).toMatch(/^[a-f0-9]{32}$/);
	const ha1 = md5(`fixture-user:fixture:${secret}`);
	const ha2 = md5(`${method}:/collection?version=2`);
	const digest = md5(`${ha1}:nonce-a:${count}:${cnonce}:auth:${ha2}`);
	expect(header).toBe(
		`Digest username="fixture-user", realm="fixture", nonce="nonce-a", uri="/collection?version=2", response="${digest}", algorithm=MD5, qop=auth, nc=${count}, cnonce="${cnonce}"`,
	);
}

it("negotiates exact Digest headers with reusable body/options and keeps state when handlers rebuild", async () => {
	await fixture.store.save(source.pluginId, slot, marker, {});
	const rejected = challenge();
	const fetchImpl = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(rejected)
		.mockImplementation(async () => new Response("ok"));
	const input = { ...request, bodyBase64: Buffer.from("fixture request").toString("base64") };
	const resolve = vi.spyOn(fixture.store, "resolve");
	const first = handlers(fetchImpl);
	expect(resolve).not.toHaveBeenCalled();
	const result = await first["network.read"].execute(input, context);
	await handlers(fetchImpl)["network.read"].execute(input, context);
	expect(fetchImpl).toHaveBeenCalledTimes(3);
	const attempts = fetchImpl.mock.calls.map(([, options]) => options);
	expect(new Headers(attempts[0]?.headers).get("authorization")).toBeNull();
	expectDigest(new Headers(attempts[1]?.headers).get("authorization"), "PROPFIND");
	expectDigest(new Headers(attempts[2]?.headers).get("authorization"), "PROPFIND", marker, "00000002");
	for (const options of attempts) {
		expect(options).toMatchObject({
			method: "PROPFIND",
			redirect: "error",
			body: Buffer.from("fixture request"),
		});
		expect(new Headers(options?.headers).get("depth")).toBe("0");
	}
	expect(attempts[0]?.body).toBe(attempts[1]?.body);
	expect(attempts[0]?.signal).toBe(attempts[1]?.signal);
	expect(rejected.bodyUsed).toBe(true);
	expect(result).toMatchObject({ base64: Buffer.from("ok").toString("base64"), bytes: 2 });
	expect(JSON.stringify(result)).not.toContain(marker);
});

it("sends exact Basic only after challenge and discards rejection bodies and private headers", async () => {
	await fixture.store.save(source.pluginId, slot, marker, {});
	const rejected = new Response(marker, {
		status: 401,
		headers: { "www-authenticate": "Basic realm=fixture" },
	});
	const failed = new Response(marker, {
		status: 403,
		headers: {
			ETag: '"v1"',
			"Last-Modified": "Mon, 16 Nov 2026 00:00:00 GMT",
			"Content-Type": "text/plain",
			"Content-Length": "25",
			"Set-Cookie": marker,
			"WWW-Authenticate": marker,
			"X-Private": marker,
		},
	});
	const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(rejected).mockResolvedValueOnce(failed);
	const result = await handlers(fetchImpl)["network.write"].execute({ ...request, method: "MKCOL" }, context);
	expect(
		fetchImpl.mock.calls.map(([, options]) => new Headers(options?.headers).get("authorization")),
	).toEqual([null, `Basic ${Buffer.from(`fixture-user:${marker}`).toString("base64")}`]);
	expect(result).toEqual({
		status: 403,
		base64: "",
		bytes: 0,
		headers: {
			etag: '"v1"',
			"last-modified": "Mon, 16 Nov 2026 00:00:00 GMT",
			"content-type": "text/plain",
			"content-length": "25",
		},
	});
	expect(rejected.bodyUsed).toBe(true);
	expect(failed.bodyUsed).toBe(true);
	expect(JSON.stringify(result)).not.toContain(marker);
});

it("starts fresh for a changed secret, credential source, origin, slot, plugin or store", async () => {
	await fixture.store.save(source.pluginId, slot, marker, {});
	const negotiate = vi.spyOn(HttpAuthChallenges.prototype, "send");
	const authorize = vi.fn(async () => new Response("ok"));
	const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(challenge()).mockImplementation(authorize);
	await handlers(fetchImpl)["network.read"].execute(request, context);
	await fixture.store.save(source.pluginId, slot, `${marker}_changed`, {});
	await handlers(fetchImpl)["network.read"].execute(request, context);
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", `${marker}_changed`);
	await handlers(fetchImpl)["network.read"].execute(request, context);
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", undefined);
	await fixture.store.save(source.pluginId, slot, marker, {});
	await handlers(fetchImpl)["network.read"].execute(
		{ ...request, url: "http://dav.test/collection?version=2" },
		context,
	);
	const other = { ...slot, slot: "other-slot" };
	await fixture.store.save(source.pluginId, other, marker, {});
	await handlers(fetchImpl, { ...source, credentials: [other] })["network.read"].execute(
		{ ...request, credential: other.slot },
		context,
	);
	await fixture.store.save("other-plugin", slot, marker, {});
	await handlers(fetchImpl, { ...source, pluginId: "other-plugin" })["network.read"].execute(
		request,
		context,
	);
	await handlers(fetchImpl, source, new PluginCredentialStore(join(fixture.root, "credentials.json")))[
		"network.read"
	].execute(request, context);
	expect(
		fetchImpl.mock.calls.slice(2).map(([, options]) => new Headers(options?.headers).get("authorization")),
	).toEqual(Array(6).fill(null));
	const hash = createHash("sha256").update(marker).digest("hex");
	const changedHash = createHash("sha256").update(`${marker}_changed`).digest("hex");
	const prefix = `${source.pluginId}\thttps://dav.test\twebdav`;
	expect(negotiate.mock.calls.map(([scope]) => scope)).toEqual([
		`${prefix}\tsaved\t${hash}`,
		`${prefix}\tsaved\t${changedHash}`,
		`${prefix}\tenv\t${changedHash}`,
		`${source.pluginId}\thttp://dav.test\twebdav\tsaved\t${hash}`,
		`${source.pluginId}\thttps://dav.test\tother-slot\tsaved\t${hash}`,
		`other-plugin\thttps://dav.test\twebdav\tsaved\t${hash}`,
		`${prefix}\tsaved\t${hash}`,
	]);
});

it("uses only the env override on a wrong-password 401 and never retries the saved password", async () => {
	await fixture.store.save(source.pluginId, slot, marker, {});
	const override = `${marker}_env`;
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", override);
	const responses = [challenge(), challenge()] as const;
	const fetchImpl = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(responses[0])
		.mockResolvedValueOnce(responses[1]);
	const result = await handlers(fetchImpl)["network.read"].execute(request, context);
	expect(fetchImpl).toHaveBeenCalledTimes(2);
	expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("authorization")).toBeNull();
	expectDigest(new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get("authorization"), "PROPFIND", override);
	expect(responses.every((response) => response.bodyUsed)).toBe(true);
	expect(result).toEqual({
		status: 401,
		headers: { "content-type": "text/plain;charset=UTF-8" },
		base64: "",
		bytes: 0,
	});
	expect(JSON.stringify(result)).not.toContain(marker);
});

it.each([
	[{ credential: undefined }, "HTTP authentication requires a credential slot"],
	[{ credential: "literal" }, "Credential literal does not use host HTTP authentication"],
	[{ httpAuth: undefined }, "Credential webdav requires host HTTP authentication"],
	[{ httpAuth: { username: `${marker}:invalid` } }, "Invalid HTTP authentication username"],
	[{ credential: "missing" }, "Credential slot is not declared in this package's manifest: missing"],
	[{ url: "https://other.test/" }, "Credential webdav may not be sent to other.test"],
])("rejects invalid auth before resolving credentials or fetching (%#)", async (extra, message) => {
	const resolve = vi.spyOn(fixture.store, "resolve");
	const fetchImpl = vi.fn<typeof fetch>();
	const error = await handlers(fetchImpl)
		["network.read"].execute({ ...request, ...extra }, context)
		.catch((failure: unknown) => failure);
	expect(error).toHaveProperty("message", message);
	expect(String(error)).not.toContain(marker);
	expect(resolve).not.toHaveBeenCalled();
	expect(fetchImpl).not.toHaveBeenCalled();
});

it.each([
	[{ url: "https://undeclared.test/" }, "Network host is not declared"],
	[{ url: "https://user:password@dav.test/" }, "Network URLs must not carry credentials"],
	[{ headers: { Authorization: "forged" } }, "Network header is reserved"],
	[{ headers: { Cookie: "forged" } }, "Network header is reserved"],
	[{ url: "https://other.test/" }, "Credential webdav may not be sent"],
])("checks destinations before invalid auth metadata (%#)", async (extra, message) => {
	const fetchImpl = vi.fn<typeof fetch>();
	await expect(
		handlers(fetchImpl)["network.read"].execute(
			{ ...request, method: "GET", ...extra, httpAuth: { username: ":" } },
			context,
		),
	).rejects.toThrow(message);
	expect(fetchImpl).not.toHaveBeenCalled();
});

it("does not resolve secrets while formatting a write approval and omits username/source", () => {
	const resolve = vi.spyOn(fixture.store, "resolve");
	const write = handlers(vi.fn<typeof fetch>())["network.write"];
	const detail = write.approvalDetail?.(
		{ ...request, method: "PUT", httpAuth: { username: marker } },
		context,
	);
	expect(detail).toMatch(/(?:Uses saved credential|使用已保存凭据): webdav/);
	expect(detail).not.toContain(marker);
	expect(detail).not.toContain("saved\t");
	expect(resolve).not.toHaveBeenCalled();
});

it("reports missing configuration without fetching and sanitizes transport/stream errors", async () => {
	const fetchImpl = vi.fn<typeof fetch>();
	await expect(handlers(fetchImpl)["network.read"].execute(request, context)).rejects.toThrow(
		"Credential webdav is not configured; add it in Drone settings",
	);
	expect(fetchImpl).not.toHaveBeenCalled();
	await fixture.store.save(source.pluginId, slot, marker, {});
	fetchImpl.mockRejectedValueOnce(new Error(marker));
	await expect(handlers(fetchImpl)["network.read"].execute(request, context)).rejects.toThrow(
		/^Authenticated network request failed$/,
	);
	fetchImpl.mockResolvedValueOnce(
		new Response(
			new ReadableStream({
				start(controller) {
					controller.error(new Error(marker));
				},
			}),
		),
	);
	await expect(handlers(fetchImpl)["network.read"].execute(request, context)).rejects.toThrow(
		/^Authenticated network request failed$/,
	);
});

it("filters successful authenticated responses and rejects oversized success bodies", async () => {
	await fixture.store.save(source.pluginId, slot, marker, {});
	const fetchImpl = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(
			new Response("ok", { status: 207, headers: { ETag: '"v2"', "Set-Cookie": marker } }),
		);
	expect(await handlers(fetchImpl)["network.read"].execute(request, context)).toEqual({
		status: 207,
		headers: { etag: '"v2"', "content-type": "text/plain;charset=UTF-8" },
		base64: "b2s=",
		bytes: 2,
	});
	const cancel = vi.fn();
	fetchImpl.mockResolvedValueOnce(
		new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
				},
				cancel,
			}),
		),
	);
	await expect(handlers(fetchImpl)["network.read"].execute(request, context)).rejects.toThrow(
		"Authenticated network request failed",
	);
	expect(cancel).toHaveBeenCalledOnce();
});

it.each([undefined, "literal"])(
	"preserves all response headers and error bytes without HTTP auth (%s)",
	async (credential) => {
		await fixture.store.save(source.pluginId, literal, marker, {});
		const response = new Response("unfiltered", {
			status: 500,
			headers: { "X-Private": "unchanged", "Set-Cookie": "fixture" },
		});
		const expected = {
			status: 500,
			headers: {
				"content-type": "text/plain;charset=UTF-8",
				"x-private": "unchanged",
				"set-cookie": "fixture",
			},
			base64: Buffer.from("unfiltered").toString("base64"),
			bytes: 10,
		};
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
		expect(
			await handlers(fetchImpl)["network.read"].execute(
				{ method: "GET", url: request.url, credential },
				context,
			),
		).toEqual(expected);
		expect(fetchImpl.mock.calls[0]?.[1]?.headers).toEqual(credential ? { "X-Api-Key": marker } : {});
	},
);

it("wires source capabilities to store-backed auth and propagates caller cancellation", async () => {
	await fixture.store.save(source.pluginId, slot, marker, {});
	const sessions = { get: () => undefined, signalFor: () => context.signal };
	const host = { sessions, taskGrants: new TaskGrantStore(sessions), credentials: fixture.store };
	const controller = new AbortController();
	const fetchImpl = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(challenge())
		.mockImplementation(async () => new Response("ok"));
	vi.stubGlobal("fetch", fetchImpl);
	const read = () => {
		const handler = sourceCapabilityHandlers(host, source)["network.read"];
		if (!handler) throw new Error("Fixture source must declare network access");
		return handler;
	};
	await read().execute(request, {
		...context,
		signal: controller.signal,
	});
	await read().execute(request, context);
	expect(fetchImpl).toHaveBeenCalledTimes(3);
	expectDigest(
		new Headers(fetchImpl.mock.calls[2]?.[1]?.headers).get("authorization"),
		"PROPFIND",
		marker,
		"00000002",
	);
	const signal = fetchImpl.mock.calls[0]?.[1]?.signal;
	expect(signal?.aborted).toBe(false);
	controller.abort();
	expect(signal?.aborted).toBe(true);
});
