// @vitest-environment node
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => environment.userData } }));

import { discoverInstalledUiPackages, UiPluginManager } from "./manager";

let root: string;
let installRoot: string;
let packageRoot: string;

const uiManifest = {
	name: "results-ui",
	droneUi: 1,
	main: "src/index.ts",
	contributions: [{ id: "results", region: "panel.tab", export: "Results" }],
};

async function writeManifest(desktopRuntime: unknown = "./runtime.js"): Promise<void> {
	await writeFile(
		join(packageRoot, "plugin.manifest.json"),
		JSON.stringify({
			id: "display-id-not-authenticated",
			hosts: ["drone-desktop"],
			entrypoints: { ui: "./ui/plugin.json", desktopRuntime },
		}),
	);
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "drone-runtime-source-"));
	installRoot = join(root, "node_modules");
	packageRoot = join(installRoot, "@example", "results");
	environment.userData = join(root, "user-data");
	await mkdir(join(environment.userData, "ui-plugins"), { recursive: true });
	await mkdir(join(packageRoot, "ui", "src"), { recursive: true });
	await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "@example/results" }));
	await writeFile(join(packageRoot, "ui", "plugin.json"), JSON.stringify(uiManifest));
	await writeFile(join(packageRoot, "runtime.js"), 'throw new Error("discovery must not execute runtime");');
	await writeManifest();
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("installed UI runtime provenance", () => {
	it("records canonical package paths and npm identity without executing code", async () => {
		const manager = new UiPluginManager({ installedPackageRoot: installRoot });
		await manager.scanAll();
		expect(manager.runtimeSource("results-ui")).toEqual({
			pluginId: "@example/results",
			packageRoot: await realpath(packageRoot),
			entrypoint: await realpath(join(packageRoot, "runtime.js")),
		});
		expect(manager.isEnabled("results-ui")).toBe(false);
		await manager.updateConfig({
			enabled: true,
			plugins: { "results-ui": { enabled: true, trusted: true } },
		});
		expect(manager.isEnabled("results-ui")).toBe(true);
		await manager.updateConfig({ enabled: false });
		expect(manager.isEnabled("results-ui")).toBe(false);
		await manager.updateConfig({
			enabled: true,
			plugins: { "results-ui": { enabled: true, trusted: false } },
		});
		expect(manager.isEnabled("results-ui")).toBe(false);
	});

	it("drops installed runtime provenance when a local UI shadows its name", async () => {
		const manager = new UiPluginManager({ installedPackageRoot: installRoot });
		await manager.scanAll();
		expect(manager.runtimeSource("results-ui")).toBeDefined();
		const local = join(environment.userData, "ui-plugins", "results-ui");
		await mkdir(local);
		await writeFile(join(local, "plugin.json"), JSON.stringify(uiManifest));
		await manager.scanAll();
		expect(manager.pluginDirOf("results-ui")).toBe(local);
		expect(manager.runtimeSource("results-ui")).toBeUndefined();
		await rm(local, { recursive: true });
		await manager.scanAll();
		expect(manager.runtimeSource("results-ui")).toBeDefined();
		await rm(packageRoot, { recursive: true });
		await manager.scanAll();
		expect(manager.runtimeSource("results-ui")).toBeUndefined();
		expect(manager.isEnabled("results-ui")).toBe(false);
	});

	it("updates source and removes it when the declaration is removed", async () => {
		const manager = new UiPluginManager({ installedPackageRoot: installRoot });
		await manager.scanAll();
		await writeFile(join(packageRoot, "replacement.js"), "export default {};");
		await writeManifest("./replacement.js");
		await manager.scanAll();
		expect(manager.runtimeSource("results-ui")?.entrypoint).toBe(
			await realpath(join(packageRoot, "replacement.js")),
		);
		// Omitting the entrypoint must retain the ordinary UI module.
		await writeFile(
			join(packageRoot, "plugin.manifest.json"),
			JSON.stringify({ hosts: ["drone-desktop"], entrypoints: { ui: "./ui/plugin.json" } }),
		);
		await manager.scanAll();
		expect(manager.runtimeSource("results-ui")).toBeUndefined();
		expect(manager.info("results-ui")?.invalidReason).toBeUndefined();
	});

	for (const entry of [42, "", "./missing.js", "./ui"]) {
		it(`diagnoses invalid runtime entry ${JSON.stringify(entry)}`, async () => {
			await writeManifest(entry);
			const manager = new UiPluginManager({ installedPackageRoot: installRoot });
			const infos = await manager.scanAll();
			expect(infos).toHaveLength(1);
			expect(infos[0]?.invalidReason).toContain("Invalid desktopRuntime");
			expect(manager.runtimeSource("results-ui")).toBeUndefined();
			expect(manager.isEnabled("results-ui")).toBe(false);
		});
	}

	it("rejects an installed UI symlink outside the package before assigning runtime provenance", async () => {
		const outside = join(root, "external-ui");
		await mkdir(outside);
		await writeFile(join(outside, "plugin.json"), JSON.stringify(uiManifest));
		await rm(join(packageRoot, "ui"), { recursive: true });
		await symlink(outside, join(packageRoot, "ui"));
		const entries = await discoverInstalledUiPackages(installRoot);
		expect(entries[0]).toMatchObject({ error: expect.stringContaining("entrypoints.ui resolves outside") });
	});

	for (const method of ["relative", "symlink"]) {
		it(`rejects a runtime escaping the package through ${method}`, async () => {
			const outside = join(root, "outside.js");
			await writeFile(outside, "export default {};");
			if (method === "symlink") await symlink(outside, join(packageRoot, "linked.js"));
			await writeManifest(method === "symlink" ? "./linked.js" : "../../../outside.js");
			const entries = await discoverInstalledUiPackages(installRoot);
			expect(entries[0]).toMatchObject({
				packageName: "@example/results",
				error: expect.stringContaining("escapes the installed package"),
			});
		});
	}
});
