// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

import { UiPluginManager } from "./manager";

describe("installed desktop-ui-pack discovery", () => {
	let root = "";
	const originalResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");

	afterEach(async () => {
		if (root) await rm(root, { recursive: true, force: true });
		if (originalResourcesPath) Object.defineProperty(process, "resourcesPath", originalResourcesPath);
		else Reflect.deleteProperty(process, "resourcesPath");
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
				version: "0.1.0",
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
			version: "0.1.0",
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

	it("loads the real desktop-ui-pack tarball from the Pi managed install root", async () => {
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
				resolve(process.cwd(), "../../../drone-plugins/packages/desktop-ui-pack"),
			"ui",
		);
		const packageUi = join(root, "agent", "npm", "node_modules", "@gyoungwe", "desktop-ui-pack", "ui");
		await mkdir(join(packageUi, "src"), { recursive: true });
		await writeFile(join(packageUi, "plugin.json"), await readFile(join(packageUiSource, "plugin.json")));
		await writeFile(
			join(packageUi, "src", "index.ts"),
			await readFile(join(packageUiSource, "src", "index.ts")),
		);
		const manifest = JSON.parse(await readFile(join(packageUi, "plugin.json"), "utf8"));
		expect(manifest.name).toBe("drone-research-ui");

		const manager = new UiPluginManager({ installedPackageDir: packageUi });
		await manager.init();
		expect(manager.info("drone-research-ui")).toMatchObject({
			name: "drone-research-ui",
			version: "0.1.0",
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
		expect(code.manifest.main).toBe("src/index.ts");
	});
});
