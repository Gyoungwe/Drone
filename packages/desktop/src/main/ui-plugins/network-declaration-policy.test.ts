import { describe, expect, it } from "vitest";
import { networkDeclaration } from "./network-declaration";

const slot = {
	slot: "webdav",
	label: { zh: "WebDAV 云端知识库密码", en: "WebDAV cloud knowledge password" },
	hosts: ["10.126.126.1:8080"],
	header: "Authorization",
	fields: [],
	authentication: "http-basic-digest",
};
const manifest = (drone: Record<string, unknown>) => ({
	permissions: { network: ["10.126.126.1:8080", "configured-services"] },
	drone,
});

describe("drone.credentials custody", () => {
	it("carries a declared custody through the decoder", () => {
		const declared = { ...slot, custody: "host-environment" };
		expect(networkDeclaration(manifest({ credentials: [declared] })).credentials).toEqual([declared]);
	});

	it("leaves the custody off when the manifest does not declare one", () => {
		const declared = networkDeclaration(manifest({ credentials: [slot] })).credentials?.[0];
		expect(declared).not.toHaveProperty("custody");
	});

	it.each(["host", "environment", "HOST-ENVIRONMENT", "user-environment", ""])(
		"rejects the unknown custody %s",
		(custody) => {
			expect(() => networkDeclaration(manifest({ credentials: [{ ...slot, custody }] }))).toThrow(
				"drone.credentials",
			);
		},
	);

	it("rejects a slot that names an environment variable", () => {
		// The manifest may declare the custody *kind* only.  A variable name would
		// let a package point the host at any secret in its environment.
		expect(() =>
			networkDeclaration(manifest({ credentials: [{ ...slot, custodySource: "ZOTERO_LOCAL_API_KEY" }] })),
		).toThrow("drone.credentials");
	});
});

describe("drone.networkPolicy", () => {
	it("carries a runtime endpoint policy that names a declared slot", () => {
		expect(
			networkDeclaration(
				manifest({
					credentials: [slot],
					networkPolicy: { runtimeEndpoint: { allowed: true, credentialSlot: "webdav" } },
				}),
			).networkPolicy,
		).toEqual({ runtimeEndpoint: { allowed: true, credentialSlot: "webdav" } });
	});

	it("rejects a policy that names a slot the package never declared", () => {
		expect(() =>
			networkDeclaration(
				manifest({
					credentials: [slot],
					networkPolicy: { runtimeEndpoint: { allowed: true, credentialSlot: "other" } },
				}),
			),
		).toThrow("must name a declared credential slot");
	});

	it.each([
		["allowed is not true", { runtimeEndpoint: { allowed: false, credentialSlot: "webdav" } }],
		["the slot name is missing", { runtimeEndpoint: { allowed: true } }],
		["the slot name is not a slot name", { runtimeEndpoint: { allowed: true, credentialSlot: "Bad Name" } }],
		["there is no runtime endpoint", { somethingElse: true }],
	])("rejects a policy where %s", (_, policy) => {
		expect(() => networkDeclaration(manifest({ credentials: [slot], networkPolicy: policy }))).toThrow(
			"drone.networkPolicy",
		);
	});

	it("is absent when the manifest declares no policy", () => {
		expect(networkDeclaration(manifest({ credentials: [slot] })).networkPolicy).toBeUndefined();
	});
});
