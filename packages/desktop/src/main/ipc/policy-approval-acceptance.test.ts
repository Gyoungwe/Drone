// @vitest-environment node
/**
 * The install-time policy approval on a really installed package.
 *
 * The package here is the locked `@gyoungwe/pi-research` — the artifact the host
 * ships, not a fixture — and the path is the host's own: the manager scans the
 * managed root, the IPC layer asks, and the answer lands in the persisted
 * configuration.  Nothing about the decision is simulated except the dialog
 * itself, which is the one thing a test cannot press.
 */
import { cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
	userData: "",
	handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));
vi.mock("electron", () => ({
	app: { isPackaged: false, getPath: () => transport.userData },
	ipcMain: {
		handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
			transport.handlers.set(channel, handler),
		removeHandler: (channel: string) => transport.handlers.delete(channel),
	},
	ipcRenderer: {},
	contextBridge: {},
	shell: { openPath: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock("./index", () => ({ sendToRenderer: vi.fn() }));

import {
	consentForSource,
	type PluginCredentialSlot,
	PluginCredentialStore,
	type PluginRuntimeSource,
} from "@drone/backend";
import { UiPluginManager } from "../ui-plugins/manager";
import { DesktopRuntimeBridge } from "../ui-plugins/runtime-bridge";
import { registerUiPluginsIpc } from "./ui-plugins";

/** The package the host ships, staged from the lock. */
const shippedResearch = resolve(
	import.meta.dirname,
	"../../../plugin-packages/node_modules/@gyoungwe/pi-research",
);

/** One holder for the per-test world; a module-level `let` would be a shared mutable. */
const world: {
	root?: string;
	manager?: UiPluginManager;
	bridge?: DesktopRuntimeBridge;
	ask?: ReturnType<typeof vi.fn<(request: unknown) => Promise<boolean>>>;
} = {};

beforeEach(async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-policy-acceptance-")));
	world.root = root;
	transport.userData = join(root, "profile");
	await mkdir(join(transport.userData, "ui-plugins"), { recursive: true });
	// The package is installed for real, in a managed root the manager scans.
	const installRoot = join(root, "builtin", "node_modules");
	await mkdir(join(installRoot, "@gyoungwe"), { recursive: true });
	await cp(shippedResearch, join(installRoot, "@gyoungwe", "pi-research"), { recursive: true });
	const manager = new UiPluginManager({
		installedPackageRoot: join(root, "user", "node_modules"),
		builtinPackageRoot: installRoot,
	});
	await manager.scanAll();
	world.manager = manager;
	world.ask = vi.fn(async () => true);
	world.bridge = new DesktopRuntimeBridge({
		source: (name) => manager.runtimeSource(name),
		enabled: (name) => manager.isEnabled(name),
		factory: () => {
			throw new Error("The approval path must not launch a runtime");
		},
		approve: async () => true,
		getSessionContext: () => undefined,
	});
});

afterEach(async () => {
	await world.bridge?.revoke();
	transport.handlers.clear();
	if (world.root) await rm(world.root, { recursive: true, force: true });
});

it("the shipped research package waits for the user's approval before it runs", async () => {
	const manager = world.manager as UiPluginManager;
	const ask = world.ask as NonNullable<typeof world.ask>;
	const source = manager.runtimeSources().find(({ source }) => source.pluginId === "@gyoungwe/pi-research");
	if (!source) throw new Error("The shipped research package was not discovered");
	// The package asks for a host-kept secret, so it does not run half-granted.
	expect(manager.runtimeSource(source.name)).toBeUndefined();
	expect(manager.info("drone-research-ui")).toMatchObject({ enabled: false, builtin: true });

	const { reconcilePolicies } = registerUiPluginsIpc(
		manager,
		world.bridge as DesktopRuntimeBridge,
		ask as never,
	);
	await reconcilePolicies();

	expect(ask).toHaveBeenCalledTimes(1);
	const request = ask.mock.calls[0]?.[0] as { pluginId: string; credentials?: unknown[] };
	expect(request.pluginId).toBe("@gyoungwe/pi-research");
	// The dialog shows the shape of the grant, never the secret.
	expect(JSON.stringify(request)).not.toMatch(/ZOTERO_LOCAL_API_KEY|DRONE_WEBDAV_PASSWORD/);
	expect(manager.runtimeSource(source.name)?.policyConsent).toMatchObject({
		pluginId: "@gyoungwe/pi-research",
		custodySlots: ["zotero-local"],
		runtimeEndpoint: false,
	});
	expect(manager.info("drone-research-ui")).toMatchObject({ enabled: true });
});

it("a refusal leaves the package off, and the host keeps its secret", async () => {
	const manager = world.manager as UiPluginManager;
	const ask = world.ask as NonNullable<typeof world.ask>;
	ask.mockResolvedValue(false);
	const { reconcilePolicies } = registerUiPluginsIpc(
		manager,
		world.bridge as DesktopRuntimeBridge,
		ask as never,
	);
	await reconcilePolicies();

	expect(ask).toHaveBeenCalledTimes(1);
	const sources = manager
		.runtimeSources()
		.filter(({ source }) => source.pluginId === "@gyoungwe/pi-research");
	expect(sources).toHaveLength(1);
	expect(manager.runtimeSource(sources[0]?.name as string)).toBeUndefined();
	expect(manager.info("drone-research-ui")).toMatchObject({ enabled: false });
	// Nothing was recorded, so the package may be asked again later.
	expect(manager.pendingPolicyApprovals()).toEqual([]);
});

it("the host hands over its secret only after the user allows the policy", async () => {
	const slot: PluginCredentialSlot = {
		slot: "zotero-local",
		label: { zh: "Zotero 本机写入", en: "Zotero local writes" },
		hosts: ["127.0.0.1:23119"],
		header: "Zotero-API-Key",
		fields: ["serverId"],
		custody: "host-environment",
	};
	const store = new PluginCredentialStore(join(world.root as string, "credentials.json"));
	const env = { ZOTERO_LOCAL_API_KEY: "the-host-key", ZOTERO_LOCAL_SERVER_ID: "TESTSERVER1" };
	const declared: PluginRuntimeSource & { contentHash: string } = {
		pluginId: "@gyoungwe/pi-research",
		packageRoot: join(world.root as string, "package"),
		entrypoint: "./dist/index.mjs",
		contentHash: "content-hash-1",
		credentials: [slot],
	};

	// Without the user's approval the slot is an ordinary one: the host's own key stays put.
	expect((await store.resolve("@gyoungwe/pi-research", slot, env, declared)).credential).toBeUndefined();
	// The approval is what unlocks it, and nothing else.
	const approved = { ...declared, policyConsent: consentForSource(declared) };
	expect((await store.resolve("@gyoungwe/pi-research", slot, env, approved)).credential).toMatchObject({
		secret: "the-host-key",
		source: "env",
	});
});
