import { describe, expect, it } from "vitest";
import { networkDeclaration } from "./network-declaration";

const slot = {
	slot: "zotero-web",
	label: { zh: "Zotero 网页 API 密钥", en: "Zotero Web API key" },
	hosts: ["api.zotero.org"],
	header: "Zotero-API-Key",
	fields: ["libraryType", "libraryId"],
};
const manifest = (credentials: unknown) => ({
	permissions: { network: ["api.zotero.org", "configured-services"] },
	drone: { credentials },
});

describe("drone.credentials", () => {
	it("carries declared slots, keeping only their known keys", () => {
		expect(networkDeclaration(manifest([{ ...slot, extra: true }]))).toEqual({
			networkHosts: ["api.zotero.org"],
			credentials: [slot],
		});
	});

	it.each([
		["a host outside permissions.network", { ...slot, hosts: ["evil.example"] }],
		["no hosts", { ...slot, hosts: [] }],
		["a header that is not a token", { ...slot, header: "Bad Header" }],
		["a missing label", { ...slot, label: { zh: "密钥" } }],
		["a field that is not a name", { ...slot, fields: ["library id"] }],
	])("rejects a slot with %s", (_, bad) => {
		expect(() => networkDeclaration(manifest([bad]))).toThrow("drone.credentials");
	});

	it("rejects duplicate slots and an empty list", () => {
		expect(() => networkDeclaration(manifest([slot, slot]))).toThrow("drone.credentials");
		expect(() => networkDeclaration(manifest([]))).toThrow("drone.credentials");
	});
});
