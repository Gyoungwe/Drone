import { gzipSync } from "node:zlib";
import { compareVersions } from "@drone/shared";
import { describe, expect, it } from "vitest";
import { latestPackageVersions, registryPluginMetadata } from "./package-versions";

function tarArchive(entries: Record<string, string>): ArrayBuffer {
	const blocks: Buffer[] = [];
	for (const [name, value] of Object.entries(entries)) {
		const body = Buffer.from(value);
		const header = Buffer.alloc(512);
		header.write(name, 0, 100, "utf8");
		header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
		header[156] = "0".charCodeAt(0);
		blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
	}
	blocks.push(Buffer.alloc(1024));
	const compressed = gzipSync(Buffer.concat(blocks));
	return compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength);
}

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

describe("registryPluginMetadata", () => {
	it("reads pi-analysis declarations from the package manifest", async () => {
		const archive = tarArchive({
			"package/package.json": JSON.stringify({
				name: "@gyoungwe/pi-analysis",
				version: "0.1.1",
				description: "Scientific analysis adapters",
			}),
			"package/plugin.manifest.json": JSON.stringify({
				capabilities: ["analysis", "readiness"],
				tools: ["analysis_list_adapters"],
				permissions: { filesystem: "workspace", network: "none" },
				hosts: ["native-pi", "drone-desktop"],
			}),
		});
		const result = await registryPluginMetadata(["@gyoungwe/pi-analysis"], async (url) =>
			url.includes("registry.npmjs.org")
				? {
						ok: true,
						json: async () => ({
							name: "@gyoungwe/pi-analysis",
							"dist-tags": { latest: "0.1.1" },
							versions: { "0.1.1": { dist: { tarball: "https://cdn.example/pi-analysis.tgz" } } },
						}),
						arrayBuffer: async () => new ArrayBuffer(0),
					}
				: {
						ok: true,
						json: async () => ({}),
						arrayBuffer: async () => archive,
					},
		);
		expect(result["@gyoungwe/pi-analysis"]).toMatchObject({
			name: "@gyoungwe/pi-analysis",
			version: "0.1.1",
			manifestDeclared: true,
			capabilities: ["analysis", "readiness"],
			tools: ["analysis_list_adapters"],
			hosts: ["native-pi", "drone-desktop"],
		});
	});

	it("marks an L0 package without a Drone manifest as undeclared", async () => {
		const archive = tarArchive({
			"package/package.json": JSON.stringify({ name: "pi-generic", version: "1.0.0" }),
		});
		const result = await registryPluginMetadata(["pi-generic"], async (url) =>
			url.endsWith("pi-generic")
				? {
						ok: true,
						json: async () => ({
							name: "pi-generic",
							"dist-tags": { latest: "1.0.0" },
							versions: { "1.0.0": { dist: { tarball: "https://cdn.example/pi-generic.tgz" } } },
						}),
						arrayBuffer: async () => new ArrayBuffer(0),
					}
				: { ok: true, json: async () => ({}), arrayBuffer: async () => archive },
		);
		expect(result["pi-generic"]).toMatchObject({
			manifestDeclared: false,
			capabilities: [],
			tools: [],
			hosts: [],
		});
	});
});
