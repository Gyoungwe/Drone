// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
	declaresWorker,
	managedAgentPackageRoot,
	moduleNodeModulesRoots,
	readPackageManifest,
	scanInstalledPackages,
} from "./installed-package-scan";

const temp: { root?: string } = {};

beforeEach(async () => {
	temp.root = await mkdtemp(join(tmpdir(), "drone-package-scan-"));
});
afterEach(async () => {
	if (temp.root) await rm(temp.root, { recursive: true, force: true });
});

/** Write a package with its own manifest into `<node_modules>/<name>`. */
async function writePackage(
	nodeModules: string,
	name: string,
	options: { version?: string; manifest?: unknown } = {},
) {
	const dir = join(nodeModules, ...name.split("/"));
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "package.json"), JSON.stringify({ name, version: options.version ?? "1.0.0" }));
	if (options.manifest !== undefined) {
		await writeFile(join(dir, "plugin.manifest.json"), JSON.stringify(options.manifest));
	}
	return dir;
}

it("finds scoped and unscoped packages across the roots it is given", async () => {
	const root = temp.root ?? "";
	const first = join(root, "first", "node_modules");
	const second = join(root, "second", "node_modules");
	await writePackage(first, "solo", { version: "2.0.0" });
	await writePackage(second, "@scope/scoped");

	const found = scanInstalledPackages([first, second]);
	expect([...found.keys()].sort()).toEqual(["@scope/scoped", "solo"]);
	expect(found.get("solo")?.version).toBe("2.0.0");
	expect(found.get("@scope/scoped")?.packageRoot).toBe(join(second, "@scope", "scoped"));
});

it("lets the first root win so a read-only built-in copy is not shadowed", async () => {
	const root = temp.root ?? "";
	const builtin = join(root, "builtin", "node_modules");
	const user = join(root, "user", "node_modules");
	await writePackage(builtin, "@gyoungwe/pi-core", { version: "1.0.0" });
	await writePackage(user, "@gyoungwe/pi-core", { version: "9.9.9" });

	const found = scanInstalledPackages([builtin, user]);
	expect(found.get("@gyoungwe/pi-core")?.version).toBe("1.0.0");
});

it("reads a package's own manifest instead of assuming what it declares", async () => {
	const root = temp.root ?? "";
	const modules = join(root, "node_modules");
	await writePackage(modules, "@gyoungwe/pi-knowledge", {
		manifest: {
			schemaVersion: 1,
			entrypoints: { extension: "./dist/index.mjs", worker: "./lib/worker.mjs" },
			capabilities: ["knowledge"],
			hosts: ["native-pi"],
		},
	});

	const found = scanInstalledPackages([modules]);
	const manifest = found.get("@gyoungwe/pi-knowledge")?.manifest;
	expect(manifest?.capabilities).toEqual(["knowledge"]);
	expect(manifest?.hosts).toEqual(["native-pi"]);
	expect(declaresWorker(manifest)).toBe(true);
});

it("reports no worker for a package that does not declare one", async () => {
	const root = temp.root ?? "";
	const modules = join(root, "node_modules");
	await writePackage(modules, "@gyoungwe/pi-evidence", {
		manifest: { entrypoints: { extension: "./dist/index.mjs" }, capabilities: ["evidence"] },
	});

	const found = scanInstalledPackages([modules]);
	expect(declaresWorker(found.get("@gyoungwe/pi-evidence")?.manifest)).toBe(false);
});

it("reads a UI pack's own entrypoint descriptor when it ships no plugin manifest", async () => {
	const root = temp.root ?? "";
	const modules = join(root, "node_modules");
	const dir = join(modules, "@gyoungwe", "desktop-ui-pack");
	await mkdir(join(dir, "ui"), { recursive: true });
	await writeFile(join(dir, "package.json"), JSON.stringify({ name: "@gyoungwe/desktop-ui-pack" }));
	await writeFile(join(dir, "ui", "plugin.json"), JSON.stringify({ name: "drone-ui", droneUi: 1 }));

	const manifest = readPackageManifest(dir);
	expect(manifest?.entrypoints?.ui).toBe("./ui/plugin.json");
	expect(manifest?.capabilities).toEqual(["ui"]);
});

it("returns nothing for a package that declares nothing", async () => {
	const root = temp.root ?? "";
	const dir = join(root, "node_modules", "plain");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "package.json"), JSON.stringify({ name: "plain" }));
	expect(readPackageManifest(dir)).toBeUndefined();
});

it("treats a missing root as empty rather than failing", () => {
	const root = temp.root ?? "";
	expect(scanInstalledPackages([join(root, "absent")]).size).toBe(0);
	expect(scanInstalledPackages([]).size).toBe(0);
});

it("walks the module chain upwards to find the install roots", () => {
	const roots = moduleNodeModulesRoots(import.meta.url);
	expect(roots.length).toBeGreaterThan(1);
	expect(roots.every((root) => root.endsWith("node_modules"))).toBe(true);
});

it("reads the managed Pi install root the user's packages land in", () => {
	const previous = process.env.PI_CODING_AGENT_DIR;
	try {
		process.env.PI_CODING_AGENT_DIR = "/tmp/drone-agent";
		expect(managedAgentPackageRoot()).toBe(join("/tmp/drone-agent", "npm", "node_modules"));
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	}
});
