import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverPluginHostLoader } from "./optional-plugin-hosts";

describe("discoverPluginHostLoader", () => {
	it("loads a declared capability host without a package-name allowlist", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-plugin-host-discovery-"));
		const packageRoot = join(root, "@example", "analysis-extension");
		await mkdir(join(packageRoot, "dist"), { recursive: true });
		await writeFile(
			join(packageRoot, "package.json"),
			JSON.stringify({ name: "@example/analysis-extension", version: "1.0.0" }),
		);
		await writeFile(
			join(packageRoot, "plugin.manifest.json"),
			JSON.stringify({
				capabilities: ["analysis"],
				hosts: ["drone-desktop"],
				entrypoints: { host: "./dist/host.mjs" },
			}),
		);
		await writeFile(
			join(packageRoot, "dist", "host.mjs"),
			"export const analysisHostLoader = { load: () => ({ registry: {} }) };",
		);
		const result = await discoverPluginHostLoader<{ load: () => unknown }>({
			packageRoots: [root],
			capability: "analysis",
		});
		expect(result?.discovery.packageName).toBe("@example/analysis-extension");
		expect(result?.discovery.entrypoint).toBe(join(packageRoot, "dist", "host.mjs"));
		expect(result?.loader.load()).toEqual({ registry: {} });
	});

	it("discovers the knowledge read host through its declared capability", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-plugin-knowledge-discovery-"));
		const packageRoot = join(root, "knowledge-provider");
		await mkdir(join(packageRoot, "dist"), { recursive: true });
		await writeFile(
			join(packageRoot, "package.json"),
			JSON.stringify({ name: "knowledge-provider", version: "0.3.0" }),
		);
		await writeFile(
			join(packageRoot, "plugin.manifest.json"),
			JSON.stringify({
				capabilities: ["knowledge"],
				hosts: ["drone-desktop"],
				entrypoints: { host: "./dist/host.mjs" },
			}),
		);
		await writeFile(
			join(packageRoot, "dist", "host.mjs"),
			"export const knowledgeHostLoader = { contractVersion: 1, load: () => ({ contractVersion: 1 }) };",
		);
		const result = await discoverPluginHostLoader<{ contractVersion: 1; load: () => unknown }>({
			packageRoots: [root],
			capability: "knowledge",
		});
		expect(result?.discovery.capability).toBe("knowledge");
		expect(result?.loader.load()).toEqual({ contractVersion: 1 });
	});

	it("discovers a Drone host declaration embedded in an otherwise standard Pi package", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-pi-package-discovery-"));
		const packageRoot = join(root, "@example", "pi-research");
		await mkdir(join(packageRoot, "dist"), { recursive: true });
		await writeFile(
			join(packageRoot, "package.json"),
			JSON.stringify({
				name: "@example/pi-research",
				pi: { extensions: ["./dist/index.mjs"] },
				drone: {
					capabilities: ["research"],
					hosts: ["drone-desktop"],
					entrypoints: { host: "./dist/host.mjs" },
				},
			}),
		);
		await writeFile(
			join(packageRoot, "dist", "host.mjs"),
			"export const researchHostLoader = { load: () => ({ contractVersion: 1 }) };",
		);
		const result = await discoverPluginHostLoader<{ load: () => unknown }>({
			packageRoots: [root],
			capability: "research",
		});
		expect(result?.discovery.packageName).toBe("@example/pi-research");
		expect(result?.loader.load()).toEqual({ contractVersion: 1 });
	});

	it("retains optional host module exports for transport factories", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-research-connector-discovery-"));
		const packageRoot = join(root, "@example", "pi-research");
		await mkdir(join(packageRoot, "dist"), { recursive: true });
		await writeFile(
			join(packageRoot, "package.json"),
			JSON.stringify({ name: "@example/pi-research", version: "0.3.2" }),
		);
		await writeFile(
			join(packageRoot, "plugin.manifest.json"),
			JSON.stringify({
				capabilities: ["research"],
				hosts: ["drone-desktop"],
				entrypoints: { host: "./dist/host.mjs" },
			}),
		);
		await writeFile(
			join(packageRoot, "dist", "host.mjs"),
			[
				"export const researchConnectorHostLoader = { contractVersion: 1, load: () => ({ contractVersion: 1, status: 'unavailable', list: () => [], recommend: async () => ({ hits: [], failures: [] }), search: async () => ({ query: '', hits: [], failures: [], connectors: [], complete: false }) }) };",
				"export const createResearchConnectorHostLoader = (options) => ({ contractVersion: 1, load: () => ({ contractVersion: 1, status: options.fetchImpl ? 'ready' : 'unavailable', list: () => [], recommend: async () => ({ hits: [], failures: [] }), search: async () => ({ query: '', hits: [], failures: [], connectors: [], complete: true }) }) });",
			].join("\n"),
		);
		const result = await discoverPluginHostLoader<{ load: () => unknown }>({
			packageRoots: [root],
			capability: "research",
			exportName: "researchConnectorHostLoader",
		});
		expect(result?.module.createResearchConnectorHostLoader).toBeTypeOf("function");
		expect(result?.loader.load()).toMatchObject({ status: "unavailable" });
	});

	it("ignores undeclared or malformed packages and returns no loader", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-plugin-host-empty-"));
		await mkdir(join(root, "plain"), { recursive: true });
		await writeFile(
			join(root, "plain", "plugin.manifest.json"),
			JSON.stringify({ capabilities: ["research"] }),
		);
		expect(await discoverPluginHostLoader({ packageRoots: [root], capability: "analysis" })).toBeUndefined();
	});

	it("rejects a host entry that escapes its package root", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-plugin-host-escape-"));
		const packageRoot = join(root, "escape");
		await mkdir(packageRoot, { recursive: true });
		await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "escape", version: "1.0.0" }));
		await writeFile(
			join(packageRoot, "plugin.manifest.json"),
			JSON.stringify({
				capabilities: ["analysis"],
				hosts: ["drone-desktop"],
				entrypoints: { host: "../outside.mjs" },
			}),
		);
		await writeFile(join(root, "outside.mjs"), "export const analysisHostLoader = {};\n");
		expect(await discoverPluginHostLoader({ packageRoots: [root], capability: "analysis" })).toBeUndefined();
	});

	it("passes the discovered evidence host into the backend composition root", async () => {
		const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
		expect(source).toContain("analysisEvidenceHost: evidenceHost.loader.load()");
		expect(source).toContain("researchConnectorHostLoaderFactory");
		expect(source).toContain("createResearchConnectorHostLoader");
	});
});
