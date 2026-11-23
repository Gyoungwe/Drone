// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIRST_PARTY_PACKAGES } from "@drone/shared";
import { afterEach, beforeEach, expect, it } from "vitest";
import { attributeWorkerLifecycles, deriveHostPluginPackages } from "./host-plugin-packages";
import { scanInstalledPackages } from "./installed-package-scan";

const temp: { root?: string } = {};

beforeEach(async () => {
	temp.root = await mkdtemp(join(tmpdir(), "drone-host-packages-"));
});
afterEach(async () => {
	if (temp.root) await rm(temp.root, { recursive: true, force: true });
});

/** Write a package into `<modules>/<name>`. */
async function writePackage(
	modules: string,
	name: string,
	options: { version?: string; manifest?: unknown; packageJson?: Record<string, unknown> } = {},
) {
	const dir = join(modules, ...name.split("/"));
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "package.json"),
		JSON.stringify({ name, version: options.version ?? "1.0.0", ...options.packageJson }),
	);
	if (options.manifest !== undefined) {
		await writeFile(join(dir, "plugin.manifest.json"), JSON.stringify(options.manifest));
	}
	return dir;
}

it("lists every catalog entry, marking the ones that are not installed unavailable", async () => {
	const root = temp.root ?? "";
	const modules = join(root, "node_modules");
	await writePackage(modules, "@gyoungwe/pi-core", { version: "1.2.3" });

	const packages = deriveHostPluginPackages(scanInstalledPackages([modules]));

	expect(packages.map((entry) => entry.name)).toEqual(FIRST_PARTY_PACKAGES.map((entry) => entry.name));
	const core = packages.find((entry) => entry.name === "@gyoungwe/pi-core");
	expect(core).toMatchObject({ host: "desktop", version: "1.2.3", status: "available" });
	const evidence = packages.find((entry) => entry.name === "@gyoungwe/pi-evidence");
	expect(evidence?.status).toBe("unavailable");
});

it("takes the installed version and the package's own manifest instead of the catalog fallback", async () => {
	const root = temp.root ?? "";
	const modules = join(root, "node_modules");
	await writePackage(modules, "@gyoungwe/pi-research", {
		version: "9.9.9",
		manifest: {
			schemaVersion: 1,
			entrypoints: { extension: "./dist/index.mjs" },
			capabilities: ["research"],
			hosts: ["native-pi"],
			permissions: { filesystem: ["workspace-read"], network: [] },
		},
	});

	const research = deriveHostPluginPackages(scanInstalledPackages([modules])).find(
		(entry) => entry.name === "@gyoungwe/pi-research",
	);

	expect(research?.version).toBe("9.9.9");
	expect(research?.source).toBe("drone");
	expect(research?.manifestDeclared).toBe(true);
	expect(research?.capabilities).toEqual(["research"]);
	expect(research?.hosts).toEqual(["native-pi"]);
	expect(research?.permissions).toEqual({ filesystem: ["workspace-read"], network: [] });
});

it("reports a package with no declaration of its own as unknown rather than drone", async () => {
	const root = temp.root ?? "";
	const modules = join(root, "node_modules");
	await writePackage(modules, "@gyoungwe/pi-connectors", { version: "2.0.0" });

	const connectors = deriveHostPluginPackages(scanInstalledPackages([modules])).find(
		(entry) => entry.name === "@gyoungwe/pi-connectors",
	);

	expect(connectors).toMatchObject({ status: "available", source: "unknown" });
	expect(connectors?.manifestDeclared).toBeUndefined();
});

it("attributes a worker lifecycle to the package that owns the worker path", async () => {
	const root = temp.root ?? "";
	const modules = join(root, "node_modules");
	const knowledgeRoot = await writePackage(modules, "@gyoungwe/pi-knowledge", {
		manifest: { entrypoints: { extension: "./dist/index.mjs", worker: "./lib/worker.mjs" } },
	});
	await writePackage(modules, "@gyoungwe/pi-evidence", {
		manifest: { entrypoints: { extension: "./dist/index.mjs", worker: "./lib/worker.mjs" } },
	});

	const installed = scanInstalledPackages([modules]);
	const lifecycles = attributeWorkerLifecycles(installed, {
		currentVersion: "1:abcdef0123456789",
		nextSessionVersion: null,
		state: "enabled",
		source: join(knowledgeRoot, "lib", "worker.mjs"),
		events: [],
	});

	expect([...lifecycles.keys()]).toEqual(["@gyoungwe/pi-knowledge"]);
});

it("attributes an unattributable lifecycle to the only package that declares a worker", async () => {
	const root = temp.root ?? "";
	const modules = join(root, "node_modules");
	await writePackage(modules, "@gyoungwe/pi-knowledge", {
		manifest: { entrypoints: { extension: "./dist/index.mjs", worker: "./lib/worker.mjs" } },
	});

	const installed = scanInstalledPackages([modules]);
	const lifecycles = attributeWorkerLifecycles(installed, {
		currentVersion: "1:abcdef0123456789",
		nextSessionVersion: null,
		state: "staged",
		events: [],
	});

	expect([...lifecycles.keys()]).toEqual(["@gyoungwe/pi-knowledge"]);
});

it("leaves an unattributable lifecycle unattached when several packages declare a worker", async () => {
	const root = temp.root ?? "";
	const modules = join(root, "node_modules");
	await writePackage(modules, "@gyoungwe/pi-knowledge", {
		manifest: { entrypoints: { extension: "./dist/index.mjs", worker: "./lib/worker.mjs" } },
	});
	await writePackage(modules, "@gyoungwe/pi-evidence", {
		manifest: { entrypoints: { extension: "./dist/index.mjs", worker: "./lib/worker.mjs" } },
	});

	const installed = scanInstalledPackages([modules]);
	const lifecycles = attributeWorkerLifecycles(installed, {
		currentVersion: "1:abcdef0123456789",
		nextSessionVersion: null,
		state: "staged",
		events: [],
	});

	expect(lifecycles.size).toBe(0);
});

it("carries the worker lifecycle into the package row", async () => {
	const root = temp.root ?? "";
	const modules = join(root, "node_modules");
	await writePackage(modules, "@gyoungwe/pi-knowledge", {
		version: "0.2.1",
		manifest: {
			entrypoints: { extension: "./dist/index.mjs", worker: "./lib/worker.mjs" },
			capabilities: ["knowledge"],
		},
	});
	const installed = scanInstalledPackages([modules]);
	const lifecycles = attributeWorkerLifecycles(installed, {
		currentVersion: "1:abcdef0123456789",
		nextSessionVersion: "2:0123456789abcdef",
		state: "staged",
		lastError: "worker failed to start",
		events: [],
	});

	const knowledge = deriveHostPluginPackages(installed, lifecycles).find(
		(entry) => entry.name === "@gyoungwe/pi-knowledge",
	);

	expect(knowledge).toMatchObject({
		currentVersion: "1:abcdef0123456789",
		nextSessionVersion: "2:0123456789abcdef",
		lifecycleState: "staged",
		lastLifecycleError: "worker failed to start",
	});
});
