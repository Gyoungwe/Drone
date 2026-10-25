// @vitest-environment node
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({
	app: {
		isPackaged: true,
		getVersion: () => "ui-pack-acceptance",
		getPath: (name: string) => (name === "userData" ? electronState.userData : electronState.userData),
	},
	shell: { openPath: vi.fn() },
}));

import { discoverInstalledUiPackages, UiPluginManager } from "./manager";

describe("installed desktop-ui-pack discovery", () => {
	let root = "";
	const originalResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");

	afterEach(async () => {
		if (root) await rm(root, { recursive: true, force: true });
		if (originalResourcesPath) Object.defineProperty(process, "resourcesPath", originalResourcesPath);
		else Reflect.deleteProperty(process, "resourcesPath");
	});

	it("keeps the host usable when the managed package root is empty", async () => {
		root = await mkdtemp(join(tmpdir(), "drone-ui-pack-empty-root-"));
		await mkdir(join(root, "agent", "npm", "node_modules"), { recursive: true });
		expect(await discoverInstalledUiPackages(join(root, "agent", "npm", "node_modules"))).toEqual([]);
	});

	it("loads the installed package through the normal UI plugin lifecycle", async () => {
		root = await mkdtemp(join(tmpdir(), "drone-ui-pack-"));
		electronState.userData = join(root, "user-data");
		Object.defineProperty(process, "resourcesPath", {
			configurable: true,
			enumerable: originalResourcesPath?.enumerable ?? false,
			value: fileURLToPath(new URL("../../../resources", import.meta.url)),
			writable: true,
		});
		const packageUi = join(root, "agent", "npm", "node_modules", "@gyoungwe", "desktop-ui-pack", "ui");
		await mkdir(join(packageUi, "src"), { recursive: true });
		await writeFile(
			join(packageUi, "plugin.json"),
			JSON.stringify({
				name: "drone-research-ui",
				version: "0.1.1",
				droneUi: 1,
				main: "src/index.tsx",
				contributions: [
					{ id: "status", region: "panel.tab", export: "ResearchStatusPanel", title: "Research" },
				],
			}),
		);
		await writeFile(
			join(packageUi, "src/index.tsx"),
			"export function ResearchStatusPanel() { return null; }\n",
		);

		const manager = new UiPluginManager({ installedPackageDir: packageUi });
		await manager.init();
		expect(manager.info("drone-research-ui")).toMatchObject({
			name: "drone-research-ui",
			version: "0.1.1",
			builtin: undefined,
			built: false,
			enabled: false,
		});

		await manager.updateConfig({
			enabled: true,
			plugins: { "drone-research-ui": { enabled: true, trusted: true } },
		});
		const code = await manager.readCode("drone-research-ui");
		expect("manifest" in code).toBe(true);
		if (!("manifest" in code)) throw new Error(code.error);
		expect(code.manifest.contributions?.[0]).toMatchObject({ id: "status", region: "panel.tab" });
		expect(code.code).toContain("ResearchStatusPanel");

		await rm(packageUi, { recursive: true, force: true });
		await manager.scanAll();
		expect(manager.info("drone-research-ui")).toBeNull();
	});

	it("loads the built UI package distribution from the Pi managed install root", async () => {
		root = await mkdtemp(join(tmpdir(), "drone-ui-pack-tarball-"));
		electronState.userData = join(root, "user-data");
		Object.defineProperty(process, "resourcesPath", {
			configurable: true,
			enumerable: originalResourcesPath?.enumerable ?? false,
			value: fileURLToPath(new URL("../../../resources", import.meta.url)),
			writable: true,
		});
		const packageUiSource = join(
			process.env.DRONE_PUBLIC_UI_PACKAGE_DIR ||
				join(
					process.env.DRONE_PLUGINS_DIR || resolve(process.cwd(), "../../../drone-plugins"),
					"packages/desktop-ui-pack",
				),
			"ui",
		);
		const packageUi = join(root, "agent", "npm", "node_modules", "@gyoungwe", "desktop-ui-pack", "ui");
		await cp(packageUiSource, packageUi, { recursive: true });
		const manifest = JSON.parse(await readFile(join(packageUi, "plugin.json"), "utf8"));
		expect(manifest.name).toBe("drone-research-ui");

		const manager = new UiPluginManager({ installedPackageDir: packageUi });
		await manager.init();
		expect(manager.info("drone-research-ui")).toMatchObject({
			name: "drone-research-ui",
			version: manifest.version,
			built: false,
			enabled: false,
		});
		await manager.updateConfig({
			enabled: true,
			plugins: { "drone-research-ui": { enabled: true, trusted: true } },
		});
		const code = await manager.readCode("drone-research-ui");
		expect("manifest" in code).toBe(true);
		if (!("manifest" in code)) throw new Error(code.error);
		expect(code.manifest.main).toBe(manifest.main);
		expect(code.manifest.contributions).toEqual(manifest.contributions);
		for (const contribution of manifest.contributions) {
			expect(code.code).toContain(contribution.export);
		}
	});

	it("discovers a UI entrypoint from any installed package scope", async () => {
		root = await mkdtemp(join(tmpdir(), "drone-ui-generic-discovery-"));
		electronState.userData = join(root, "user-data");
		Object.defineProperty(process, "resourcesPath", {
			configurable: true,
			enumerable: originalResourcesPath?.enumerable ?? false,
			value: fileURLToPath(new URL("../../../resources", import.meta.url)),
			writable: true,
		});
		const installRoot = join(root, "agent", "npm", "node_modules");
		const packageRoot = join(installRoot, "@example", "ui-fixture");
		await mkdir(join(packageRoot, "ui", "src"), { recursive: true });
		await writeFile(
			join(packageRoot, "package.json"),
			JSON.stringify({ name: "@example/ui-fixture", version: "1.0.0" }),
		);
		await writeFile(
			join(packageRoot, "plugin.manifest.json"),
			JSON.stringify({
				schemaVersion: 1,
				id: "drone-ui-fixture",
				version: "1.0.0",
				entrypoints: { ui: "./ui/plugin.json" },
				hosts: ["drone-desktop"],
			}),
		);
		await writeFile(
			join(packageRoot, "ui", "plugin.json"),
			JSON.stringify({
				name: "ui-fixture",
				droneUi: 1,
				main: "src/index.ts",
				contributions: [{ id: "status", region: "panel.tab", export: "Status", title: "Fixture" }],
			}),
		);
		await writeFile(join(packageRoot, "ui", "src/index.ts"), "export function Status() { return null; }\n");
		const brokenRoot = join(installRoot, "@example", "broken-ui");
		await mkdir(brokenRoot, { recursive: true });
		await writeFile(join(brokenRoot, "package.json"), JSON.stringify({ name: "@example/broken-ui" }));
		await writeFile(
			join(brokenRoot, "plugin.manifest.json"),
			JSON.stringify({ entrypoints: { ui: "./missing/plugin.json" }, hosts: ["drone-desktop"] }),
		);

		const manager = new UiPluginManager({ installedPackageRoot: installRoot });
		await manager.init();
		expect(manager.info("ui-fixture")).toMatchObject({ enabled: false, invalidReason: undefined });
		expect(manager.list().find((item) => item.name === "package-example-broken-ui")?.invalidReason).toContain(
			"entrypoints.ui does not contain",
		);
		const code = await manager.readCode("ui-fixture");
		expect("manifest" in code).toBe(true);
	});
});
