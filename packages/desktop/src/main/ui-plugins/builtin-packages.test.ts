// @vitest-environment node
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => environment.userData } }));

import { UiPluginManager } from "./manager";

const temp: { root?: string } = {};

/** One installable package with a managed runtime, a native entry and a UI named `${ui}`. */
async function writePackage(nodeModules: string, name: string, ui: string, version = "1.0.0") {
	const dir = join(nodeModules, ...name.split("/"));
	await mkdir(join(dir, "ui"), { recursive: true });
	await writeFile(join(dir, "package.json"), JSON.stringify({ name, version }));
	await writeFile(join(dir, "runtime.mjs"), "export default () => ({});\n");
	await writeFile(join(dir, "native.mjs"), "export default () => {};\n");
	await writeFile(
		join(dir, "ui", "plugin.json"),
		JSON.stringify({ name: ui, droneUi: 1, main: "index.js", headless: true }),
	);
	await writeFile(
		join(dir, "plugin.manifest.json"),
		JSON.stringify({
			hosts: ["drone-desktop"],
			entrypoints: { ui: "./ui/plugin.json", desktopRuntime: "./runtime.mjs", extension: "./native.mjs" },
			permissions: { filesystem: [], network: [], subprocess: [] },
		}),
	);
	return realpath(dir);
}

beforeEach(async () => {
	temp.root = await mkdtemp(join(tmpdir(), "drone-builtin-packages-"));
	environment.userData = join(temp.root, "user-data");
	await mkdir(join(environment.userData, "ui-plugins"), { recursive: true });
});
afterEach(async () => {
	if (temp.root) await rm(temp.root, { recursive: true, force: true });
});

function roots() {
	const root = temp.root ?? "";
	return { user: join(root, "user", "node_modules"), builtin: join(root, "builtin", "node_modules") };
}

it("ships a built-in package on by default, loads its native entry, and turns it off with its switch", async () => {
	const { user, builtin } = roots();
	const core = await writePackage(builtin, "@drone/core", "core-ui");
	const manager = new UiPluginManager({ installedPackageRoot: user, builtinPackageRoot: builtin });
	await manager.scanAll();
	expect(manager.info("core-ui")).toMatchObject({ enabled: true, trusted: true, builtin: true });
	expect(manager.isNativeSourceAvailable(`package:${core}`)).toBe(true);
	expect(manager.builtinExtensionPaths()).toEqual([join(core, "native.mjs")]);
	expect(manager.builtinPackages.has(core)).toBe(true);

	await manager.updateConfig({ plugins: { "core-ui": { enabled: false, trusted: true } } });
	expect(manager.info("core-ui")).toMatchObject({ enabled: false, builtin: true });
	expect(manager.isNativeSourceAvailable(`package:${core}`)).toBe(false);
	expect(manager.runtimeSources()).toEqual([
		expect.objectContaining({ name: `package:${core}`, state: "unavailable" }),
	]);
	expect(manager.builtinExtensionPaths()).toEqual([]);

	await manager.updateConfig({ plugins: { "core-ui": { enabled: true, trusted: true } } });
	expect(manager.builtinExtensionPaths()).toEqual([join(core, "native.mjs")]);
});

it("keeps the user's choice when a new Drone ships a different built-in generation", async () => {
	const { user, builtin } = roots();
	const core = await writePackage(builtin, "@drone/core", "core-ui");
	const manager = new UiPluginManager({ installedPackageRoot: user, builtinPackageRoot: builtin });
	await manager.scanAll();
	await manager.updateConfig({ plugins: { "core-ui": { enabled: false, trusted: true } } });
	await writeFile(join(core, "runtime.mjs"), "export default () => ({ next: true });\n");
	const upgraded = new UiPluginManager({ installedPackageRoot: user, builtinPackageRoot: builtin });
	await upgraded.scanAll();
	expect(upgraded.info("core-ui")).toMatchObject({ enabled: false, trusted: true });
	await upgraded.updateConfig({ plugins: { "core-ui": { enabled: true, trusted: true } } });
	await writeFile(join(core, "runtime.mjs"), "export default () => ({ again: true });\n");
	await upgraded.scanAll();
	expect(upgraded.info("core-ui")).toMatchObject({ enabled: true, trusted: true });
	expect(upgraded.builtinExtensionPaths()).toEqual([join(core, "native.mjs")]);
});

it("a user-installed copy of a built-in never shadows it, and ordinary packages are not built-in", async () => {
	const { user, builtin } = roots();
	const core = await writePackage(builtin, "@drone/core", "core-ui");
	await writePackage(user, "@drone/core", "core-ui", "9.9.9");
	const other = await writePackage(user, "@example/other", "other-ui");
	const manager = new UiPluginManager({ installedPackageRoot: user, builtinPackageRoot: builtin });
	await manager.scanAll();
	expect(manager.diagnostics()).toEqual([
		{ packageName: "@drone/core", error: expect.stringContaining("is built into Drone") },
	]);
	expect(manager.runtimeSources().map((item) => item.name)).toEqual([`package:${core}`, `package:${other}`]);
	expect(manager.info("core-ui")?.packageName).toBe("@drone/core");
	expect(manager.info("other-ui")).toMatchObject({ enabled: false, trusted: false });
	expect(manager.info("other-ui")?.builtin).toBeUndefined();
	expect(manager.builtinPackages.has(other)).toBe(false);
	expect(manager.builtinExtensionPaths()).toEqual([join(core, "native.mjs")]);
});
