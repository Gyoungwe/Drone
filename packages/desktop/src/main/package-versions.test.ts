import { compareVersions } from "@drone/shared";
import { describe, expect, it } from "vitest";
import { latestPackageVersions } from "./package-versions";

describe("latestPackageVersions", () => {
	it("reads the latest version per package and maps failures to null", async () => {
		const seen: string[] = [];
		const result = await latestPackageVersions(
			["@gyoungwe/pi-core", "missing-pkg", "bad name!"],
			async (url) => {
				seen.push(url);
				if (url.includes("missing-pkg")) return { ok: false, json: async () => ({}) };
				return { ok: true, json: async () => ({ version: "0.1.6" }) };
			},
		);
		expect(result).toEqual({ "@gyoungwe/pi-core": "0.1.6", "missing-pkg": null });
		expect(seen[0]).toBe("https://registry.npmjs.org/@gyoungwe%2Fpi-core/latest");
	});

	it("returns null when the request throws (offline)", async () => {
		const result = await latestPackageVersions(["pi-mcp-adapter"], async () => {
			throw new Error("offline");
		});
		expect(result).toEqual({ "pi-mcp-adapter": null });
	});
});

describe("compareVersions", () => {
	it("orders numeric semver parts and pre-releases", () => {
		expect(compareVersions("0.1.10", "0.1.9")).toBe(1);
		expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
		expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
		expect(compareVersions("v0.2.0", "0.1.5")).toBe(1);
	});
});
