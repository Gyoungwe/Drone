// @vitest-environment node
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => environment.userData } }));

import { UiPluginManager } from "./manager";

const temp: { root?: string } = {};

/** A built-in package whose manifest asks the host to fill its Zotero local slot. */
async function writeCustodyPackage(nodeModules: string, name: string, ui: string) {
	const dir = join(nodeModules, ...name.split("/"));
	await mkdir(join(dir, "ui"), { recursive: true });
	await writeFile(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
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
			permissions: { filesystem: [], network: ["127.0.0.1:23119"], subprocess: [] },
			drone: {
				credentials: [
					{
						slot: "zotero-local",
						label: { zh: "Zotero 本机写入", en: "Zotero local writes" },
						hosts: ["127.0.0.1:23119"],
						header: "Zotero-API-Key",
						fields: ["serverId"],
						custody: "host-environment",
					},
				],
			},
		}),
	);
	return realpath(dir);
}

beforeEach(async () => {
	temp.root = await mkdtemp(join(tmpdir(), "drone-policy-approval-"));
	environment.userData = join(temp.root, "user-data");
	await mkdir(join(environment.userData, "ui-plugins"), { recursive: true });
});
afterEach(async () => {
	if (temp.root) await rm(temp.root, { recursive: true, force: true });
});

async function shippedResearch() {
	const root = temp.root ?? "";
	const builtin = join(root, "builtin", "node_modules");
	const research = await writeCustodyPackage(builtin, "@fixture/research", "research-ui");
	const manager = new UiPluginManager({
		installedPackageRoot: join(root, "user", "node_modules"),
		builtinPackageRoot: builtin,
	});
	await manager.scanAll();
	return { manager, research, name: `package:${research}` };
}

it("keeps a built-in package that asks for a host-kept secret off until the user approves it", async () => {
	const { manager, name } = await shippedResearch();
	// On by default as a built-in, yet not running: approval is an enable precondition.
	expect(manager.runtimeSource(name)).toBeUndefined();
	expect(manager.info("research-ui")).toMatchObject({ enabled: false, builtin: true });
	expect(manager.builtinExtensionPaths()).toEqual([]);
	const [pending] = manager.pendingPolicyApprovals();
	expect(pending?.pluginId).toBe("@fixture/research");

	await manager.recordPolicyDecision(pending as NonNullable<typeof pending>, true);
	expect(manager.runtimeSource(name)?.policyConsent).toMatchObject({
		pluginId: "@fixture/research",
		custodySlots: ["zotero-local"],
		runtimeEndpoint: false,
	});
	expect(manager.info("research-ui")).toMatchObject({ enabled: true });
	expect(manager.pendingPolicyApprovals()).toEqual([]);
});

it("asks again when the package content changes", async () => {
	const { manager, research, name } = await shippedResearch();
	const [pending] = manager.pendingPolicyApprovals();
	await manager.recordPolicyDecision(pending as NonNullable<typeof pending>, true);
	await writeFile(join(research, "runtime.mjs"), "export default () => ({ next: true });\n");
	await manager.scanAll();
	expect(manager.runtimeSource(name)).toBeUndefined();
	expect(manager.pendingPolicyApprovals()).toHaveLength(1);
});

it("switches the package off when the user refuses, and does not ask again", async () => {
	const { manager, name } = await shippedResearch();
	const [pending] = manager.pendingPolicyApprovals();
	await manager.recordPolicyDecision(pending as NonNullable<typeof pending>, false);
	expect(manager.runtimeSource(name)).toBeUndefined();
	expect(manager.runtimeSources()).toEqual([expect.objectContaining({ name, state: "unavailable" })]);
	expect(manager.info("research-ui")).toMatchObject({ enabled: false });
	expect(manager.pendingPolicyApprovals()).toEqual([]);
});
