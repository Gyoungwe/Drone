import { Check } from "typebox/value";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PluginCredentialStore } from "./plugin-credentials";
import type { PluginRuntimeSource } from "./plugin-source";
import { PluginCapabilityBroker, type PluginCapabilityContext } from "./runtime-capabilities";
import { sourceCapabilityHandlers } from "./source-capabilities";
import { TaskGrantStore } from "./task-grants";

const source: PluginRuntimeSource = {
	pluginId: "@gyoungwe/pi-knowledge",
	packageRoot: "/fixture",
	entrypoint: "/fixture/runtime.mjs",
	networkHosts: ["10.126.126.1:8080"],
	credentials: [
		{
			slot: "webdav",
			label: { zh: "WebDAV", en: "WebDAV" },
			hosts: ["10.126.126.1:8080"],
			header: "Authorization",
			fields: [],
			authentication: "http-basic-digest",
		},
	],
};
const context: Omit<PluginCapabilityContext, "capabilities"> = {
	pluginId: source.pluginId,
	applicationId: "fixture",
	scope: { kind: "application" },
	callerIdentity: undefined,
	signal: new AbortController().signal,
	bootstrap: false,
};
const sessions = { get: () => undefined, signalFor: () => context.signal };
const host = {
	sessions,
	taskGrants: new TaskGrantStore(sessions),
	credentials: new PluginCredentialStore(".codex-tmp/T103-unused-config.json"),
};
const handlers = (candidate = source) => sourceCapabilityHandlers(host, candidate);

beforeEach(() => vi.stubEnv("DRONE_WEBDAV_ENDPOINT", undefined));
afterEach(() => vi.unstubAllEnvs());

it("registers config.endpoint as a normal read with an exact slot schema", () => {
	const handler = handlers()["config.endpoint"];
	expect(handler).toMatchObject({ effect: "read" });
	expect(handler?.bootstrap).toBeUndefined();
	expect(handler?.approval).toBeUndefined();
	if (!handler) throw new Error("Expected endpoint capability");
	for (const slot of ["w", "w".repeat(64)]) expect(Check(handler.inputSchema, { slot })).toBe(true);
	for (const input of [
		{ slot: "" },
		{ slot: "w".repeat(65) },
		{},
		{ slot: 1 },
		{ slot: "webdav", endpoint: "https://example.test:443" },
	])
		expect(Check(handler.inputSchema, input)).toBe(false);
});

it("returns closed default, env and invalid results afresh from a retained handler", async () => {
	const broker = new PluginCapabilityBroker({ handlers: handlers(), resources: [] });
	const read = () =>
		broker.run(
			context,
			"read",
			vi.fn(),
			async () => true,
			() => broker.port.call("config.endpoint", { slot: "webdav" }),
		);
	expect(await read()).toEqual({ state: "ready", endpoint: "http://10.126.126.1:8080", source: "default" });
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", "https://dav.example:443/");
	expect(await read()).toEqual({ state: "ready", endpoint: "https://dav.example", source: "env" });
	vi.stubEnv("DRONE_WEBDAV_ENDPOINT", "https://user:TEST_ONLY_CONFIG_MARKER@dav.example:443");
	const result = await read();
	expect(result).toEqual({ state: "invalid", endpoint: null, source: "env", reason: "invalid_endpoint" });
	expect(JSON.stringify(result)).not.toContain("TEST_ONLY_CONFIG_MARKER");
	const handler = handlers()["config.endpoint"];
	if (!handler) throw new Error("Expected endpoint capability");
	const schema = handler.resultSchema;
	expect(Check(schema, result)).toBe(true);
	expect(Check(schema, { ...Object(result), extra: true })).toBe(false);
});

it("rejects unknown slots with EPLUGINENDPOINTSLOT and extra properties in the broker", async () => {
	const broker = new PluginCapabilityBroker({ handlers: handlers(), resources: [] });
	const call = (input: unknown) =>
		broker.run(
			context,
			"read",
			vi.fn(),
			async () => true,
			() => broker.port.call("config.endpoint", input),
		);
	await expect(call({ slot: "other" })).rejects.toMatchObject({
		code: "EPLUGINENDPOINTSLOT",
		message: "EPLUGINENDPOINTSLOT",
	});
	await expect(call({ slot: "webdav", host: "other.test" })).rejects.toThrow(
		"Invalid plugin capability input",
	);
});

it("does not register config.endpoint for any ineligible source", () => {
	for (const candidate of [
		{ ...source, pluginId: "other" },
		{ ...source, credentials: undefined },
		{ ...source, credentials: [] },
		{ ...source, credentials: source.credentials?.map((slot) => ({ ...slot, authentication: undefined })) },
	])
		expect(handlers(candidate)).not.toHaveProperty("config.endpoint");
});
