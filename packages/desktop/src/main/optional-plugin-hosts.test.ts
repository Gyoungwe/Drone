import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
});
