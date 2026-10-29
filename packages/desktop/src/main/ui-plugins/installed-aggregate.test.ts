// @vitest-environment node
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => environment.userData } }));

import { discoverInstalledUiPackages } from "./installed-package-sources";
import { UiPluginManager } from "./manager";

let root: string;
let modules: string;
async function select(dependencies: Record<string, string>): Promise<void> {
	await writeFile(join(dirname(modules), "package.json"), JSON.stringify({ dependencies }));
}
async function install(
	path: string,
	name: string,
	options: { version?: string; dependencies?: Record<string, string>; paths?: string[]; ui?: boolean } = {},
): Promise<string> {
	const directory = join(modules, path);
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(directory, "package.json"),
		JSON.stringify({
			name,
			version: options.version ?? "1.0.0",
			dependencies: options.dependencies,
			pi: { extensions: options.paths ?? [] },
		}),
	);
	if (options.ui) {
		await mkdir(join(directory, "ui"));
		await writeFile(
			join(directory, "ui", "plugin.json"),
			JSON.stringify({ name: "feature-ui", droneUi: 1, main: "index.js", headless: true }),
		);
		await writeFile(join(directory, "ui", "index.js"), "export function activate() {};");
		await writeFile(
			join(directory, "runtime.mjs"),
			"export default async()=>({operations:{},dispose:async()=>{}});",
		);
		await writeFile(
			join(directory, "plugin.manifest.json"),
			JSON.stringify({
				hosts: ["drone-desktop", "native-pi"],
				entrypoints: { ui: "./ui/plugin.json", desktopRuntime: "./runtime.mjs" },
			}),
		);
	}
	return directory;
}

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-ui-aggregate-")));
	modules = join(root, "agent", "npm", "node_modules");
	environment.userData = join(root, "profile");
	await mkdir(modules, { recursive: true });
	await mkdir(join(environment.userData, "ui-plugins"), { recursive: true });
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("selected aggregate Pi package UI discovery", () => {
	it("follows declared Pi resource edges recursively but never unrelated dependency trees", async () => {
		await select({ "@example/suite": "1.0.0" });
		await install("@example/suite", "@example/suite", {
			dependencies: { middle: "1.0.0", library: "1.0.0" },
			paths: ["./node_modules/middle/extension.mjs", "./node_modules/undeclared/extension.mjs"],
		});
		await install("@example/suite/node_modules/middle", "middle", {
			dependencies: { "@example/feature": "1.0.0", "@example/suite": "1.0.0" },
			paths: ["./node_modules/@example/feature/index.mjs", "./node_modules/@example/suite/index.mjs"],
		});
		const feature = await install(
			"@example/suite/node_modules/middle/node_modules/@example/feature",
			"@example/feature",
			{ ui: true },
		);
		await install("@example/suite/node_modules/library", "library", { ui: true });
		await install("@example/suite/node_modules/undeclared", "undeclared", { ui: true });
		await install("unselected-suite", "unselected-suite", {
			dependencies: { hidden: "1.0.0" },
			paths: ["./node_modules/hidden/index.mjs"],
		});
		await install("unselected-suite/node_modules/hidden", "hidden", { ui: true });
		const discoveries = await discoverInstalledUiPackages(modules);
		expect(discoveries).toHaveLength(1);
		expect(discoveries[0]).toMatchObject({
			packageName: "@example/feature",
			packageRoot: feature,
			runtime: { pluginId: "@example/feature", packageRoot: feature },
		});
	});

	it("uses real npm hoisting and registers the same physical dependency once", async () => {
		await select({ first: "1.0.0", second: "1.0.0" });
		for (const name of ["first", "second"])
			await install(name, name, {
				dependencies: { "@example/feature": "1.0.0" },
				paths: ["./node_modules/@example/feature/index.mjs"],
			});
		const feature = await install("@example/feature", "@example/feature", { ui: true });
		const discoveries = await discoverInstalledUiPackages(modules);
		expect(discoveries).toHaveLength(1);
		expect(discoveries[0]).toMatchObject({ packageRoot: feature });
	});

	it("removes nested UI when its aggregate root is deselected or removed, preserving independent UI trust", async () => {
		await select({ suite: "1.0.0" });
		const suite = await install("suite", "suite", {
			dependencies: { feature: "1.0.0" },
			paths: ["./node_modules/feature/index.mjs"],
		});
		await install("suite/node_modules/feature", "feature", { ui: true });
		const manager = new UiPluginManager({ installedPackageRoot: modules });
		await manager.scanAll();
		expect(manager.isEnabled("feature-ui")).toBe(false);
		await manager.updateConfig({
			enabled: true,
			plugins: { "feature-ui": { enabled: true, trusted: true } },
		});
		expect(manager.isEnabled("feature-ui")).toBe(true);
		await select({});
		await manager.scanAll();
		expect(manager.info("feature-ui")).toBeNull();
		expect(manager.runtimeSource("feature-ui")).toBeUndefined();
		await select({ suite: "1.0.0" });
		await manager.scanAll();
		expect(manager.isEnabled("feature-ui")).toBe(true);
		await rm(suite, { recursive: true });
		await manager.scanAll();
		expect(manager.info("feature-ui")).toBeNull();
	});

	it("prefers a directly selected source and diagnoses shadowed equal-version copies without claiming equality", async () => {
		await select({ suite: "1.0.0", feature: "1.0.0" });
		await install("suite", "suite", {
			dependencies: { feature: "1.0.0" },
			paths: ["./node_modules/feature/index.mjs"],
		});
		const direct = await install("feature", "feature", { ui: true });
		const shadowed = await install("suite/node_modules/feature", "feature", { ui: true });
		const manager = new UiPluginManager({ installedPackageRoot: modules });
		await manager.scanAll();
		expect(manager.runtimeSource("feature-ui")?.packageRoot).toBe(direct);
		expect(manager.info("package-feature")?.invalidReason).toContain(shadowed);
		expect(manager.info("package-feature")?.invalidReason).toContain(
			"Equal versions do not verify equal contents",
		);
	});

	it("blocks ambiguous versions instead of choosing the wrong runtime for a UI", async () => {
		await select({ suite: "1.0.0", feature: "2.0.0" });
		await install("suite", "suite", {
			dependencies: { feature: "1.0.0" },
			paths: ["./node_modules/feature/index.mjs"],
		});
		await install("feature", "feature", { version: "2.0.0", ui: true });
		await install("suite/node_modules/feature", "feature", { ui: true });
		const manager = new UiPluginManager({ installedPackageRoot: modules });
		await manager.scanAll();
		expect(manager.info("feature-ui")).toBeNull();
		expect(manager.runtimeSource("feature-ui")).toBeUndefined();
		expect(manager.info("package-feature")?.invalidReason).toContain("Conflicting installed UI sources");
	});

	it("rejects a declared dependency symlink outside the managed installation", async () => {
		await select({ suite: "1.0.0" });
		await install("suite", "suite", {
			dependencies: { external: "1.0.0" },
			paths: ["./node_modules/external/index.mjs"],
		});
		const outside = join(root, "external");
		await mkdir(outside);
		await writeFile(join(outside, "package.json"), JSON.stringify({ name: "external" }));
		await mkdir(join(modules, "suite", "node_modules"));
		await symlink(outside, join(modules, "suite", "node_modules", "external"));
		expect(await discoverInstalledUiPackages(modules)).toEqual([
			{ packageName: "suite", error: expect.stringContaining("outside the managed install") },
		]);
	});
	it("keeps valid resource edges discoverable when another selected root or dependency is missing", async () => {
		await select({ missingRoot: "1.0.0", suite: "1.0.0" });
		await install("suite", "suite", {
			dependencies: { missing: "1.0.0", feature: "1.0.0" },
			paths: ["./node_modules/missing/index.mjs", "./node_modules/feature/index.mjs"],
		});
		await install("suite/node_modules/feature", "feature", { ui: true });
		const discoveries = await discoverInstalledUiPackages(modules);
		expect(discoveries.filter((item) => "uiDir" in item)).toHaveLength(1);
		expect(discoveries.filter((item) => "error" in item)).toHaveLength(2);
	});

	it("diagnoses equal-version different sources without an explicitly selected direct provider", async () => {
		await select({ first: "1.0.0", second: "1.0.0" });
		for (const name of ["first", "second"]) {
			await install(name, name, {
				dependencies: { feature: "1.0.0" },
				paths: ["./node_modules/feature/index.mjs"],
			});
			await install(`${name}/node_modules/feature`, "feature", { ui: true });
		}
		const discoveries = await discoverInstalledUiPackages(modules);
		expect(discoveries).toEqual([
			{ packageName: "feature", error: expect.stringContaining("Conflicting installed UI sources") },
		]);
	});
	it("isolates malformed selected package metadata from unrelated valid aggregates", async () => {
		await select({ broken: "1.0.0", suite: "1.0.0" });
		const broken = await install("broken", "broken");
		await writeFile(join(broken, "package.json"), "null");
		await install("suite", "suite", {
			dependencies: { feature: "1.0.0" },
			paths: ["./node_modules/feature/index.mjs"],
		});
		await install("suite/node_modules/feature", "feature", { ui: true });
		const discoveries = await discoverInstalledUiPackages(modules);
		expect(discoveries.filter((item) => "uiDir" in item)).toHaveLength(1);
		expect(discoveries.find((item) => "error" in item)).toMatchObject({
			error: expect.stringContaining("package.json must contain an object"),
		});
	});
	it("blocks different npm packages claiming the same UI identity", async () => {
		await select({ suite: "1.0.0", direct: "1.0.0" });
		await install("suite", "suite", {
			dependencies: { feature: "1.0.0" },
			paths: ["./node_modules/feature/index.mjs"],
		});
		await install("suite/node_modules/feature", "feature", { ui: true });
		await install("direct", "direct", { ui: true });
		const manager = new UiPluginManager({ installedPackageRoot: modules });
		await manager.scanAll();
		expect(manager.info("feature-ui")).toBeNull();
		expect(manager.runtimeSource("feature-ui")).toBeUndefined();
		expect(manager.info("package-feature")?.invalidReason).toContain(
			"claimed by multiple installed packages",
		);
		expect(manager.info("package-direct")?.invalidReason).toContain("claimed by multiple installed packages");
	});
	it("treats npm --save-optional aggregates as explicitly selected roots, excluding dev and peer roots", async () => {
		await writeFile(
			join(dirname(modules), "package.json"),
			JSON.stringify({
				optionalDependencies: { suite: "1.0.0" },
				devDependencies: { dev: "1.0.0" },
				peerDependencies: { peer: "1.0.0" },
			}),
		);
		for (const name of ["suite", "dev", "peer"]) {
			await install(name, name, {
				dependencies: { feature: "1.0.0" },
				paths: ["./node_modules/feature/index.mjs"],
			});
			await install(`${name}/node_modules/feature`, name === "suite" ? "feature" : `${name}-feature`, {
				ui: true,
			});
		}
		const discoveries = await discoverInstalledUiPackages(modules);
		expect(discoveries).toHaveLength(1);
		expect(discoveries[0]).toMatchObject({
			packageName: "feature",
			packageRoot: join(modules, "suite", "node_modules", "feature"),
		});
	});
});
