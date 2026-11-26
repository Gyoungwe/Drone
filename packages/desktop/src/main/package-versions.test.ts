import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { compareVersions, DRONE_PLUGIN_PACKAGE_NAMES } from "@drone/shared";
import { describe, expect, it, vi } from "vitest";
import { latestPackageVersions, registryPluginMetadata } from "./package-versions";

const catalogUrl = "https://api.github.com/repos/Gyoungwe/drone-plugins/releases";
const [firstParty, peer] = DRONE_PLUGIN_PACKAGE_NAMES;
if (!firstParty || !peer) throw new Error("Expected two first-party packages");
const internal = "@gyoungwe/not-in-the-inventory";

function tarArchive(entries: Record<string, string>): ArrayBuffer {
	const blocks: Buffer[] = [];
	for (const [name, value] of Object.entries(entries)) {
		const body = Buffer.from(value);
		const header = Buffer.alloc(512);
		header.write(name, 0, 100, "utf8");
		header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
		header[156] = "0".charCodeAt(0);
		header.fill(32, 148, 156);
		const checksum = header.reduce((sum, byte) => sum + byte, 0);
		header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
		blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
	}
	blocks.push(Buffer.alloc(1024));
	const compressed = gzipSync(Buffer.concat(blocks));
	return compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength);
}

function releaseFixtures() {
	const releases: unknown[] = [];
	const routes = new Map<string, () => Response>([[catalogUrl, () => Response.json(releases)]]);
	const fetcher = vi.fn(async (url: string) => routes.get(url)?.() ?? new Response(null, { status: 404 }));
	function publish(name: string, version: string, manifest?: Record<string, unknown>) {
		const archive = tarArchive({
			"package/package.json": JSON.stringify({ name, version, description: "Release archive fixture" }),
			...(manifest ? { "package/plugin.manifest.json": JSON.stringify(manifest) } : {}),
		});
		const slug = name.split("/").at(-1);
		const tag = `${slug}-v${version}`;
		const filename = `gyoungwe-${slug}-${version}.tgz`;
		const sha256 = createHash("sha256").update(new Uint8Array(archive)).digest("hex");
		const base = `https://github.com/Gyoungwe/drone-plugins/releases/download/${tag}`;
		const tarball = {
			name: filename,
			browser_download_url: `${base}/${filename}`,
			digest: `sha256:${sha256}`,
		};
		const checksum = { name: "SHA256SUMS", browser_download_url: `${base}/SHA256SUMS` };
		routes.set(tarball.browser_download_url, () => new Response(archive));
		routes.set(checksum.browser_download_url, () => new Response(`${sha256}  ${filename}\n`));
		releases.push({ tag_name: tag, draft: false, prerelease: false, assets: [tarball, checksum] });
		return tarball;
	}
	return { routes, fetcher, publish };
}

describe("latestPackageVersions", () => {
	it("reads community latest versions from npm and maps failures to null", async () => {
		const seen: string[] = [];
		const result = await latestPackageVersions(
			["@example/community", "missing-pkg", "bad name!"],
			async (url) => {
				seen.push(url);
				if (url.includes("missing-pkg")) return { ok: false, json: async () => ({}) };
				return { ok: true, json: async () => ({ version: "0.1.6" }) };
			},
		);
		expect(result).toEqual({ "@example/community": "0.1.6", "missing-pkg": null });
		expect(seen[0]).toBe("https://registry.npmjs.org/@example%2Fcommunity/latest");
	});

	it("uses one GitHub release index per batch and verifies first-party versions", async () => {
		const { routes, fetcher, publish } = releaseFixtures();
		publish(firstParty, "1.9.0");
		publish(firstParty, "1.10.0");
		const tampered = publish(peer, "2.0.0");
		routes.set(tampered.browser_download_url, () => new Response("bad data"));
		routes.set("https://registry.npmjs.org/community/latest", () => Response.json({ version: "3.0.0" }));
		await expect(latestPackageVersions([firstParty, peer, internal, "community"], fetcher)).resolves.toEqual({
			[firstParty]: "1.10.0",
			[peer]: null,
			[internal]: null,
			community: "3.0.0",
		});
		const seen = fetcher.mock.calls.map(([url]) => url);
		expect(seen.filter((url) => url === catalogUrl)).toHaveLength(1);
		expect(seen.filter((url) => url.includes("registry.npmjs.org"))).toEqual([
			"https://registry.npmjs.org/community/latest",
		]);
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
	it("reads verified release manifests and never requests the npm registry for internal packages", async () => {
		const { fetcher, publish } = releaseFixtures();
		const declaration = {
			capabilities: ["readiness"],
			tools: ["list_adapters"],
			permissions: { filesystem: "workspace", network: "none" },
			hosts: ["native-pi", "drone-desktop"],
		};
		publish(firstParty, "0.1.1", declaration);
		publish(peer, "2.0.0");
		const result = await registryPluginMetadata([firstParty, peer, internal], fetcher);
		expect(result[firstParty]).toMatchObject({
			...declaration,
			name: firstParty,
			version: "0.1.1",
			description: "Release archive fixture",
			manifestDeclared: true,
		});
		expect(result[peer]).toMatchObject({ version: "2.0.0", manifestDeclared: false });
		expect(result[internal]).toBeNull();
		const seen = fetcher.mock.calls.map(([url]) => url);
		expect(seen.filter((url) => url === catalogUrl)).toHaveLength(1);
		expect(seen.every((url) => !url.includes("registry.npmjs.org"))).toBe(true);
	});

	it("returns null for rate-limited releases and unoffered internal names", async () => {
		const fetcher = vi.fn(async () => new Response(null, { status: 429 }));
		await expect(registryPluginMetadata([firstParty, internal], fetcher)).resolves.toEqual({
			[firstParty]: null,
			[internal]: null,
		});
		expect(fetcher).toHaveBeenCalledExactlyOnceWith(catalogUrl, expect.anything());
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
