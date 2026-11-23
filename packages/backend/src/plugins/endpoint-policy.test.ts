import { describe, expect, it } from "vitest";
import { resolvePluginEndpointPolicy } from "./endpoint-policy";
import type { PluginCredentialSlot } from "./plugin-credentials";
import type { PluginRuntimeSource } from "./plugin-source";
import { consentForSource } from "./policy-consent";

const slot: PluginCredentialSlot = {
	slot: "webdav",
	label: { zh: "WebDAV", en: "WebDAV" },
	hosts: ["10.126.126.1:8080"],
	header: "Authorization",
	fields: [],
	authentication: "http-basic-digest",
};
const networkPolicy = { runtimeEndpoint: { allowed: true, credentialSlot: "webdav" } } as const;
const declared = {
	pluginId: "@gyoungwe/pi-knowledge",
	packageRoot: "/fixture",
	entrypoint: "/fixture/runtime.mjs",
	contentHash: "content-hash-1",
	networkHosts: ["10.126.126.1:8080"],
	credentials: [slot, { ...slot, slot: "other" }],
	networkPolicy,
};
/** The source the user approved: the declaration plus the install-time consent. */
const source: PluginRuntimeSource = { ...declared, policyConsent: consentForSource(declared) };
const invalid = {
	state: "invalid",
	endpoint: null,
	source: "env",
	reason: "invalid_endpoint",
	slot: "webdav",
} as const;

describe("endpoint policy", () => {
	it("uses the default configuration and only declared hosts when unset", () => {
		const policy = resolvePluginEndpointPolicy(source, undefined);
		expect(policy.configuration).toEqual({
			state: "ready",
			endpoint: "http://10.126.126.1:8080",
			source: "default",
			slot: "webdav",
		});
		expect(policy.networkHosts).toEqual(source.networkHosts);
		expect(policy.credentialHosts).toEqual({ webdav: slot.hosts, other: slot.hosts });
		expect(policy.runtimeGrant).toBeUndefined();
	});

	it("adds exactly one host only to webdav and leaves the source immutable", () => {
		const before = structuredClone(source);
		const policy = resolvePluginEndpointPolicy(source, "https://DAV.example:8443/");
		expect(policy.networkHosts).toEqual(["10.126.126.1:8080", "dav.example:8443"]);
		expect(policy.credentialHosts).toEqual({
			webdav: ["10.126.126.1:8080", "dav.example:8443"],
			other: slot.hosts,
		});
		expect(policy.runtimeGrant).toEqual({
			endpoint: "https://dav.example:8443",
			hostPort: "dav.example:8443",
			slot: "webdav",
		});
		expect(source).toEqual(before);
	});

	it("deduplicates an override equal to the declared default", () => {
		const policy = resolvePluginEndpointPolicy(source, "http://10.126.126.1:8080/");
		expect(policy.networkHosts).toEqual(source.networkHosts);
		expect(policy.credentialHosts.webdav).toEqual(slot.hosts);
	});

	it.each([
		["an unapproved declaration", declared],
		["an approval for other content", { ...source, contentHash: "content-hash-2" }],
		["a package without a runtime endpoint policy", { ...source, networkPolicy: undefined }],
		[
			"a policy naming another slot",
			{ ...source, networkPolicy: { runtimeEndpoint: { allowed: true, credentialSlot: "other" } } },
		],
		["another plugin", { ...source, pluginId: "@other/plugin" }],
		["another slot", { ...source, credentials: [{ ...slot, slot: "other" }] }],
		["absent slot", { ...source, credentials: [] }],
		["different auth mode", { ...source, credentials: [{ ...slot, authentication: undefined }] }],
		["vendored snapshot", { ...source, credentials: undefined }],
		["different header", { ...source, credentials: [{ ...slot, header: "X-Key" }] }],
		["nonempty fields", { ...source, credentials: [{ ...slot, fields: ["id"] }] }],
		["missing network default", { ...source, networkHosts: ["other.example"] }],
		["missing slot default", { ...source, credentials: [{ ...slot, hosts: ["other.example"] }] }],
	] satisfies Array<[string, PluginRuntimeSource]>)("does not widen %s", (_name, candidate) => {
		const policy = resolvePluginEndpointPolicy(candidate, "https://dav.example:8443");
		expect(policy.networkHosts).toEqual(candidate.networkHosts);
		expect(policy.credentialHosts).toEqual(
			Object.fromEntries((candidate.credentials ?? []).map((entry) => [entry.slot, entry.hosts])),
		);
		expect(policy.configuration).toBeUndefined();
		expect(policy.runtimeGrant).toBeUndefined();
	});
});

describe("endpoint parsing", () => {
	it.each([
		["http://DAV.example:80", "http://dav.example", "dav.example:80"],
		["https://DAV.example:443/", "https://dav.example", "dav.example:443"],
		["http://127.0.0.1:8081/", "http://127.0.0.1:8081", "127.0.0.1:8081"],
		["https://[2001:0db8::1]:8443/", "https://[2001:db8::1]:8443", "[2001:db8::1]:8443"],
		["https://bücher.example:0443", "https://xn--bcher-kva.example", "xn--bcher-kva.example:443"],
	])("normalizes accepted root %#", (raw, endpoint, hostPort) => {
		const policy = resolvePluginEndpointPolicy(source, raw);
		expect(policy.configuration).toEqual({ state: "ready", endpoint, source: "env", slot: "webdav" });
		expect(policy.runtimeGrant).toEqual({ endpoint, hostPort, slot: "webdav" });
	});

	it.each([
		"dav.example:8443",
		"ftp://dav.example:21",
		"https://dav.example",
		"https://dav.example:",
		"https://dav.example:0",
		"https://dav.example:65536",
		"",
		"   ",
		" https://dav.example:443",
		"https://dav.example:443 ",
		"https://da v.example:443",
		"https://dav.example:443\n",
		"https://dav.example:443\u0000",
		"https://dav.example:443\\",
		"https://user:TEST_ONLY_ENDPOINT_MARKER@dav.example:443",
		"https://@dav.example:443",
		"https://dav.example:443?",
		"https://dav.example:443#",
		"https://dav.example:443?key=marker",
		"https://dav.example:443/dav",
		"https://dav.example:443//",
		"https://dav.example:443/.",
		"https://dav.example:443/a/..",
		"https://dav.example:443/%2e",
		"https://*.example:443",
		"https://2001:db8::1:443",
		"https://[fe80::1%25eth0]:443",
		"https://dav.example:+443",
	])("rejects malformed endpoint with fixed non-disclosing result %#", (raw) => {
		const policy = resolvePluginEndpointPolicy(source, raw);
		expect(policy.configuration).toEqual(invalid);
		expect(policy.runtimeGrant).toBeUndefined();
		expect(policy.networkHosts).toEqual(source.networkHosts);
		expect(policy.credentialHosts.webdav).toEqual(slot.hosts);
		// The empty string is contained in every string; equality above proves its closed result.
		if (raw.length > 0) expect(JSON.stringify(policy)).not.toContain(raw);
	});
});
