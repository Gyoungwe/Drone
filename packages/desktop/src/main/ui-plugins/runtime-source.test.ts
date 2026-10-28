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

async function writeManifest(
	desktopRuntime: unknown = "./runtime.js",
	entries: Record<string, unknown> = {},
	filesystem: unknown = [],
	network: unknown = [],
): Promise<void> {
	await writeFile(
		join(packageRoot, "plugin.manifest.json"),
		JSON.stringify({
			id: "display-id-not-authenticated",
			hosts: ["drone-desktop"],
			permissions: { filesystem, network },
			entrypoints: { ui: "./ui/plugin.json", desktopRuntime, ...entries },
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

	it("revokes trust for a new generation when the entrypoint or nested dependency changes in place", async () => {
		const dependency = join(packageRoot, "node_modules", "nested-dependency");
		await mkdir(dependency, { recursive: true });
		await writeFile(join(dependency, "package.json"), JSON.stringify({ name: "nested-dependency" }));
		await writeFile(join(dependency, "index.js"), "export const value = 'first';\n");
		const manager = new UiPluginManager({ installedPackageRoot: installRoot });
		await manager.scanAll();
		await manager.updateConfig({
			enabled: true,
			plugins: { "results-ui": { enabled: true, trusted: true } },
		});
		expect(manager.isEnabled("results-ui")).toBe(true);

		await writeFile(join(packageRoot, "runtime.js"), "export const replacement = true;\n");
		expect(manager.runtimeSource("results-ui")).toBeUndefined();
		expect(manager.isEnabled("results-ui")).toBe(false);
		expect(await manager.readCode("results-ui")).toEqual({
			error: "UI plugin installation changed; reload required",
		});
		await manager.scanAll();
		expect(manager.info("results-ui")).toMatchObject({ enabled: false, trusted: false });
		expect(manager.isEnabled("results-ui")).toBe(false);
		await manager.updateConfig({
			enabled: true,
			plugins: { "results-ui": { enabled: true, trusted: true } },
		});
		expect(manager.isEnabled("results-ui")).toBe(true);

		await writeFile(join(dependency, "index.js"), "export const value = 'replacement';\n");
		const restarted = new UiPluginManager({ installedPackageRoot: installRoot });
		await restarted.scanAll();
		expect(restarted.runtimeSource("results-ui")).toBeDefined();
		expect(restarted.info("results-ui")).toMatchObject({ enabled: false, trusted: false });
		expect(restarted.isEnabled("results-ui")).toBe(false);
		await restarted.updateConfig({
			enabled: true,
			plugins: { "results-ui": { enabled: true, trusted: true } },
		});
		expect(restarted.isEnabled("results-ui")).toBe(true);
	});

	it("requests state writes only for the explicit filesystem token and clears it on rescan", async () => {
		const manager = new UiPluginManager({ installedPackageRoot: installRoot });
		await writeManifest("./runtime.js", {}, ["application-state"]);
		await manager.scanAll();
		expect(manager.runtimeSource("results-ui")?.requestsStateWrite).toBeUndefined();
		await writeManifest("./runtime.js", {}, ["application-state-write"]);
		await manager.scanAll();
		expect(manager.runtimeSource("results-ui")?.requestsStateWrite).toBe(true);
		await writeManifest("./runtime.js", {}, ["application-state"]);
		await manager.scanAll();
		expect(manager.runtimeSource("results-ui")?.requestsStateWrite).toBeUndefined();
	});

	it("requests data writes only for workspace-write and clears the request on rescan", async () => {
		const manager = new UiPluginManager({ installedPackageRoot: installRoot });
		await writeManifest("./runtime.js", {}, ["workspace-read", "application-state-write"]);
		await manager.scanAll();
		expect(manager.runtimeSource("results-ui")?.requestsFileWrite).toBeUndefined();
		await writeManifest("./runtime.js", {}, ["workspace-write"]);
		await manager.scanAll();
		expect(manager.runtimeSource("results-ui")?.requestsFileWrite).toBe(true);
		expect(manager.runtimeSource("results-ui")?.requestsStateWrite).toBeUndefined();
		await writeManifest("./runtime.js", {}, ["workspace-read"]);
		await manager.scanAll();
		expect(manager.runtimeSource("results-ui")?.requestsFileWrite).toBeUndefined();
	});

	it("requests a separate configured-vault write root", async () => {
		const manager = new UiPluginManager({ installedPackageRoot: installRoot });
		await writeManifest("./runtime.js", {}, ["configured-vault-write"]);
		await manager.scanAll();
		expect(manager.runtimeSource("results-ui")?.requestsFileWrite).toBe(true);
	});

	it("discovers native and resource files from the same package without executing them", async () => {
		await writeFile(join(packageRoot, "native.js"), 'throw new Error("must not import native");');
		await writeFile(join(packageRoot, "resource.js"), 'throw new Error("must not import resource");');
		await symlink("resource.js", join(packageRoot, "resource-link.js"));
		await writeManifest("./runtime.js", {
			extension: "./native.js",
			resources: { index: "./resource-link.js" },
		});
		const manager = new UiPluginManager({ installedPackageRoot: installRoot });
		await manager.scanAll();
		expect(manager.runtimeSource("results-ui")).toEqual({
			pluginId: "@example/results",
			packageRoot: await realpath(packageRoot),
			entrypoint: await realpath(join(packageRoot, "runtime.js")),
			nativeEntrypoint: await realpath(join(packageRoot, "native.js")),
			resources: { index: await realpath(join(packageRoot, "resource.js")) },
		});
		await writeManifest("./runtime.js", { resources: { replacement: "./native.js" } });
		await manager.scanAll();
		expect(manager.runtimeSource("results-ui")?.nativeEntrypoint).toBeUndefined();
		expect(manager.runtimeSource("results-ui")?.resources).toEqual({
			replacement: await realpath(join(packageRoot, "native.js")),
		});
		await writeManifest();
		await manager.scanAll();
		expect(manager.runtimeSource("results-ui")?.resources).toBeUndefined();
	});

	it("diagnoses resource descriptors without a desktop owner", async () => {
		await writeManifest("./runtime.js", { desktopRuntime: undefined, resources: { index: "./runtime.js" } });
		const entries = await discoverInstalledUiPackages(installRoot);
		expect(entries[0]).toMatchObject({ error: "entrypoints.resources requires a desktopRuntime owner" });
	});

	for (const resources of [
		null,
		[],
		"./runtime.js",
		{ "": "./runtime.js" },
		{ index: 42 },
		{ index: "./missing.js" },
		{ index: "./ui" },
	]) {
		it(`diagnoses invalid resource declarations ${JSON.stringify(resources)}`, async () => {
			await writeManifest("./runtime.js", { resources });
			const manager = new UiPluginManager({ installedPackageRoot: installRoot });
			const infos = await manager.scanAll();
			expect(infos[0]?.invalidReason).toContain("Invalid desktopRuntime");
			expect(manager.runtimeSource("results-ui")).toBeUndefined();
		});
	}

	for (const field of ["extension", "resources"] as const) {
		for (const method of ["relative", "symlink", "absolute"]) {
			it(`rejects ${field} outside its package through ${method}`, async () => {
				const outside = join(root, "outside.js");
				await writeFile(outside, 'throw new Error("must not import outside");');
				await symlink(outside, join(packageRoot, "linked.js"));
				const entry =
					method === "relative" ? "../../../outside.js" : method === "symlink" ? "./linked.js" : outside;
				await writeManifest("./runtime.js", {
					[field]: field === "resources" ? { index: entry } : entry,
				});
				const entries = await discoverInstalledUiPackages(installRoot);
				expect(entries[0]).toMatchObject({
					packageName: "@example/results",
					error: expect.stringContaining(`entrypoints.${field}`),
				});
			});
		}
	}

	for (const droneUi of [1, 2]) {
		it(`loads installed UI contract v${droneUi} with verified runtime provenance`, async () => {
			await writeFile(join(packageRoot, "ui", "plugin.json"), JSON.stringify({ ...uiManifest, droneUi }));
			await writeFile(join(packageRoot, "ui", "src", "index.ts"), "export const Results = () => null;");
			const manager = new UiPluginManager({ installedPackageRoot: installRoot });
			await manager.scanAll();
			expect(manager.info("results-ui")?.invalidReason).toBeUndefined();
			expect(manager.runtimeSource("results-ui")?.pluginId).toBe("@example/results");
			expect(await manager.readCode("results-ui")).toMatchObject({
				manifest: { droneUi },
				code: expect.any(String),
			});
		});
	}

	it("rejects installed contract v2 without a runtime and unknown future versions", async () => {
		const manager = new UiPluginManager({ installedPackageRoot: installRoot });
		await writeManifest("./runtime.js", { desktopRuntime: undefined });
		await writeFile(join(packageRoot, "ui", "plugin.json"), JSON.stringify({ ...uiManifest, droneUi: 2 }));
		await manager.scanAll();
		expect(manager.info("results-ui")?.invalidReason).toContain("desktopRuntime");
		expect(manager.runtimeSource("results-ui")).toBeUndefined();
		expect(await manager.readCode("results-ui")).toHaveProperty("error");
		await writeFile(join(packageRoot, "ui", "plugin.json"), JSON.stringify({ ...uiManifest, droneUi: 3 }));
		await manager.scanAll();
		expect(manager.info("results-ui")?.invalidReason).toContain("版本不匹配");
	});

	it("rejects local v2 even when its name shadows an installed runtime", async () => {
		const local = join(environment.userData, "ui-plugins", "results-ui");
		await mkdir(local);
		await writeFile(join(local, "plugin.json"), JSON.stringify({ ...uiManifest, droneUi: 2 }));
		const manager = new UiPluginManager({ installedPackageRoot: installRoot });
		await manager.scanAll();
		expect(manager.info("results-ui")?.invalidReason).toContain("本地 UI");
		expect(manager.runtimeSource("results-ui")).toBeUndefined();
		expect(await manager.readCode("results-ui")).toHaveProperty("error");
		await writeFile(join(local, "plugin.json"), JSON.stringify(uiManifest));
		await manager.scanAll();
		expect(manager.info("results-ui")?.invalidReason).toBeUndefined();
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
			JSON.stringify({
				hosts: ["drone-desktop"],
				entrypoints: { ui: "./ui/plugin.json" },
			}),
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

it("derives model service access only from the installed package network declaration and revokes it on rescan", async () => {
	const manager = new UiPluginManager({ installedPackageRoot: installRoot });
	await writeManifest("./runtime.js", {}, [], []);
	await manager.scanAll();
	expect(manager.runtimeSource("results-ui")?.requestsModel).toBeUndefined();
	await writeManifest("./runtime.js", {}, [], ["configured-services"]);
	await manager.scanAll();
	expect(manager.runtimeSource("results-ui")?.requestsModel).toBe(true);
	await writeManifest("./runtime.js", {}, [], ["example.invalid"]);
	await manager.scanAll();
	expect(manager.runtimeSource("results-ui")?.requestsModel).toBeUndefined();
});
