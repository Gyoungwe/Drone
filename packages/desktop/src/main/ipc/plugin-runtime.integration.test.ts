// @vitest-environment node
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createBackend, createProcessPluginRuntime, type PluginSessionCallerContext } from "@drone/backend";
import { PackagesContract, PluginRuntimeContract, UiPluginsContract } from "@drone/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
}));
vi.mock("./index", () => ({ sendToRenderer: vi.fn() }));

import { exposeContract } from "../../preload/expose-contract";
import { UiPluginManager } from "../ui-plugins/manager";
import {
	DesktopRuntimeBridge,
	type DesktopRuntimeOwner,
	type DesktopRuntimeSource,
} from "../ui-plugins/runtime-bridge";
import { packageMutationHost, registerPackagesIpc } from "./packages";
import { registerPluginRuntimeIpc } from "./plugin-runtime";
import { registerUiPluginsIpc } from "./ui-plugins";

const runtimeDirectory = resolve(
	import.meta.dirname,
	"../../../plugin-runtime",
	`${process.platform}-${process.arch}`,
);
const hasRuntime = existsSync(join(runtimeDirectory, "runtime.json"));
const owner: DesktopRuntimeOwner = { id: 401, isDestroyed: () => false };
const otherOwner: DesktopRuntimeOwner = { id: 402, isDestroyed: () => false };
const runtimeSource = `
export default async ({applicationId}) => ({ operations: {
 receipt: {inputSchema:{type:"null"},resultSchema:{type:"object"},effect:"read",execute:async(_input,{scope})=>({pid:process.pid,scope,applicationId,loaded:true,version:"1.0.0"})}
},createNativeSession:async()=>({extension:()=>{},dispose:async()=>{}}),dispose:async()=>{} });`;

function clients(sender: DesktopRuntimeOwner) {
	const ipc = {
		invoke: async (channel: string, ...args: unknown[]) => {
			const handler = transport.handlers.get(channel);
			if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
			return handler({ sender }, ...args);
		},
		on: vi.fn(),
		removeListener: vi.fn(),
	};
	return {
		packages: exposeContract(PackagesContract, { ipc }),
		ui: exposeContract(UiPluginsContract, { ipc }),
		runtime: exposeContract(PluginRuntimeContract, { ipc }),
	};
}

let root: string;
let packageRoot: string;
let manager: UiPluginManager;
let bridge: DesktopRuntimeBridge;
const sessions = new Map<string, PluginSessionCallerContext>();
let approve: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
let launch: ReturnType<
	typeof vi.fn<(source: DesktopRuntimeSource) => ReturnType<typeof createProcessPluginRuntime>>
>;

async function writeRuntimePackage(target: string, version: string, resource?: string) {
	await mkdir(join(target, "ui", "src"), { recursive: true });
	const files = {
		"package.json": JSON.stringify({
			name: "@example/runtime-receipt",
			version,
			type: "module",
			pi: { extensions: ["./extension.mjs"] },
		}),
		"plugin.manifest.json": JSON.stringify({
			schemaVersion: 1,
			id: "runtime-receipt",
			version,
			hosts: ["native-pi", "drone-desktop"],
			entrypoints: {
				extension: "./extension.mjs",
				ui: "./ui/plugin.json",
				desktopRuntime: "./runtime.mjs",
				...(resource ? { resources: { index: "./resource.mjs" } } : {}),
			},
		}),
		"extension.mjs": "export default function(pi) { pi.on('session_start', async()=>{}); }\n",
		"runtime.mjs": runtimeSource.replace('version:"1.0.0"', `version:"${version}"`),
		"ui/plugin.json": JSON.stringify({
			name: "runtime-receipt-ui",
			droneUi: 1,
			main: "src/index.tsx",
			contributions: [{ id: "receipt", region: "panel.tab", export: "Receipt", title: "Runtime receipt" }],
		}),
		"ui/src/index.tsx":
			'import { usePluginRuntime } from "@gyoungwe/plugin-api"; export function Receipt(){const runtime=usePluginRuntime();return <button onClick={()=>runtime.invoke("receipt",null)}>Receipt</button>;}',
		...(resource ? { "resource.mjs": resource } : {}),
	};
	await Promise.all(Object.entries(files).map(([name, bytes]) => writeFile(join(target, name), bytes)));
}

async function wirePackageUpdate(mode: "healthy" | "unready") {
	const staged = join(root, "candidate");
	await writeRuntimePackage(
		staged,
		"2.0.0",
		mode === "healthy"
			? "export default async () => ({ invoke: async () => ({ ready: true }), dispose: async () => {} });"
			: "export default async () => ({ invoke: async () => { throw new Error('guest-readiness-sentinel'); }, dispose: async () => {} });",
	);
	const installer = join(root, "offline-install.mjs");
	await writeFile(
		installer,
		`import {cp,mkdir} from 'node:fs/promises';import {join,dirname} from 'node:path';
const target=join(process.argv[process.argv.indexOf('--prefix')+1],'node_modules','@example','runtime-receipt');
await mkdir(dirname(target),{recursive:true});await cp(${JSON.stringify(staged)},target,{recursive:true});`,
	);
	const settings = join(root, "agent", "settings.json");
	const configured = {
		packages: [{ source: "npm:@example/runtime-receipt@1.0.0", skills: ["+fixture"] }],
		npmCommand: [process.execPath, installer],
	};
	await writeFile(settings, JSON.stringify(configured));
	vi.stubEnv("PI_CODING_AGENT_DIR", dirname(settings));
	const backend = createBackend({ defaultCwd: root, userDataDir: transport.userData, dailyDiscovery: false });
	registerPackagesIpc(backend, undefined, undefined, ({ sender }) =>
		packageMutationHost(manager, bridge, sender, runtimeDirectory),
	);
	return { backend, settings, configured };
}

describe.skipIf(!hasRuntime)("installed runtime through main contracts and preload", () => {
	beforeEach(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), "drone-runtime-ipc-")));
		transport.userData = join(root, "profile");
		const installRoot = join(root, "agent", "npm", "node_modules");
		packageRoot = join(installRoot, "@example", "runtime-receipt");
		await mkdir(join(transport.userData, "ui-plugins"), { recursive: true });
		await writeRuntimePackage(packageRoot, "1.0.0");
		manager = new UiPluginManager({ installedPackageRoot: installRoot });
		await manager.scanAll();
		approve = vi.fn(async () => true);
		launch = vi.fn((source: DesktopRuntimeSource) =>
			createProcessPluginRuntime({ ...source, runtimeDirectory }),
		);
		bridge = new DesktopRuntimeBridge({
			source: (name) =>
				name === "peer"
					? { pluginId: name, packageRoot: root, entrypoint: join(root, "peer.mjs") }
					: manager.runtimeSource(name),
			enabled: (name) => name === "peer" || manager.isNativeSourceAvailable(name) || manager.isEnabled(name),
			factory: launch,
			approve,
			getSessionContext: (id) => sessions.get(id),
		});
		registerUiPluginsIpc(manager, bridge);
		registerPluginRuntimeIpc(bridge);
		const { ui } = clients(owner);
		await ui.setEnabled(true);
		await ui.setPluginEnabled("runtime-receipt-ui", true);
	});

	afterEach(async () => {
		await bridge.revoke();
		transport.handlers.clear();
		sessions.clear();
		await rm(root, { recursive: true, force: true });
	});

	it("binds installed code, executes in a child, stops it on disable and issues a fresh generation", async () => {
		const { ui, runtime } = clients(owner);
		const loaded = await ui.readCode("runtime-receipt-ui");
		if ("error" in loaded || !loaded.runtimeBinding) throw new Error("Expected installed runtime binding");
		expect(loaded.code).toContain("usePluginRuntime");
		const receipt = (await runtime.invoke(
			loaded.runtimeBinding,
			"receipt",
			null,
			await runtime.selectSession(null),
		)) as {
			pid: number;
			scope: { kind: "application" };
			loaded: boolean;
		};
		expect(receipt).toMatchObject({
			pid: expect.any(Number),
			loaded: true,
			scope: { kind: "application" },
		});
		expect(receipt.pid).not.toBe(process.pid);
		await expect(
			clients(otherOwner).runtime.invoke(
				loaded.runtimeBinding,
				"receipt",
				null,
				await clients(otherOwner).runtime.selectSession(null),
			),
		).rejects.toThrow("invalid for this window");
		await ui.setPluginEnabled("runtime-receipt-ui", false);
		expect(() => process.kill(receipt.pid, 0)).toThrow();
		await expect(
			runtime.invoke(loaded.runtimeBinding, "receipt", null, await runtime.selectSession(null)),
		).rejects.toThrow("invalid");
		expect(await ui.readCode("runtime-receipt-ui")).toEqual({
			error: "UI plugin is not enabled and trusted",
		});
		await ui.setPluginEnabled("runtime-receipt-ui", true);
		const reloaded = await ui.readCode("runtime-receipt-ui");
		if ("error" in reloaded || !reloaded.runtimeBinding) throw new Error("Expected restored binding");
		expect(reloaded.runtimeBinding).not.toBe(loaded.runtimeBinding);
		await expect(
			runtime.invoke(reloaded.runtimeBinding, "receipt", null, await runtime.selectSession(null)),
		).resolves.toMatchObject({
			loaded: true,
		});
	});

	it("preload selection resolves trusted per-call session scopes inside one shared worker", async () => {
		const makeSession = (id: string, workspaceId: string): PluginSessionCallerContext => ({
			identity: {},
			scope: { kind: "session", sessionId: id, workspaceId, workspaceDirectory: `/Trusted/${id}` },
			signal: new AbortController().signal,
			projectTrusted: true,
			readOnly: false,
		});
		sessions.set("first", makeSession("first", "/trusted/first"));
		sessions.set("second", makeSession("second", "/trusted/second"));
		const a = clients(owner),
			b = clients(otherOwner);
		const loadedA = await a.ui.readCode("runtime-receipt-ui"),
			loadedB = await b.ui.readCode("runtime-receipt-ui");
		if ("error" in loadedA || !loadedA.runtimeBinding || "error" in loadedB || !loadedB.runtimeBinding)
			throw new Error("Expected runtime bindings");
		let firstSelection = await a.runtime.selectSession("first");
		const secondSelection = await b.runtime.selectSession("second");
		const first = (await a.runtime.invoke(loadedA.runtimeBinding, "receipt", null, firstSelection)) as {
			pid: number;
			applicationId: string;
			scope: unknown;
		};
		const second = (await b.runtime.invoke(
			loadedB.runtimeBinding,
			"receipt",
			null,
			secondSelection,
		)) as typeof first;
		expect(first.scope).toEqual(sessions.get("first")!.scope);
		expect(second.scope).toEqual(sessions.get("second")!.scope);
		expect(second.pid).toBe(first.pid);
		expect(second.applicationId).toBe(first.applicationId);
		expect(launch).toHaveBeenCalledOnce();
		await expect(a.runtime.selectSession("forged-session")).rejects.toThrow("not open");
		firstSelection = await a.runtime.selectSession(null);
		expect(await a.runtime.invoke(loadedA.runtimeBinding, "receipt", null, firstSelection)).toMatchObject({
			pid: first.pid,
			scope: { kind: "application" },
		});
		await bridge.revoke(undefined, owner.id);
		expect(await b.runtime.invoke(loadedB.runtimeBinding, "receipt", null, secondSelection)).toMatchObject({
			pid: first.pid,
		});
		await bridge.close();
		expect(() => process.kill(first.pid, 0)).toThrow();
	});

	it("revokes an installed binding before an in-place package replacement can execute", async () => {
		await writeFile(join(packageRoot, "runtime.mjs"), 'throw new Error("import-executed-sentinel");');
		const { ui } = clients(owner);
		expect(await ui.readCode("runtime-receipt-ui")).toEqual({
			error: "UI plugin is not enabled and trusted",
		});
		expect(approve).not.toHaveBeenCalled();
	});

	it.each(["healthy", "unready"] as const)("handles a %s worker resource", async (mode) => {
		const { backend, settings, configured } = await wirePackageUpdate(mode);
		try {
			const { packages, runtime } = clients(owner);
			const name = `package:${packageRoot}`;
			await writeFile(join(root, "peer.mjs"), runtimeSource);
			const before = await bridge.bind(name, owner);
			const peer = await bridge.bind("peer", owner);
			if (!before || !peer) throw new Error("Expected both workers");
			const selection = await runtime.selectSession(null);
			const old = (await runtime.invoke(before, "receipt", null, selection)) as { pid: number };
			const other = await runtime.invoke(peer, "receipt", null, selection);
			const receipt = await packages.updatePackage("@example/runtime-receipt");
			const healthy = mode === "healthy";
			const version = healthy ? "2.0.0" : "1.0.0";
			const status = healthy ? "succeeded" : "failed";
			expect(receipt).toMatchObject({ status, previousVersion: "1.0.0", version });
			const events = receipt.events.map(({ type }) => type);
			expect(events.slice(0, 3)).toEqual(["staged", "verified", "drained"]);
			expect(events.slice(3)).toEqual(healthy ? ["enabled"] : ["failed", "rolled_back"]);
			expect(JSON.stringify(receipt)).not.toContain("guest-readiness-sentinel");
			expect(() => process.kill(old.pid, 0)).toThrow();
			await expect(runtime.invoke(before, "receipt", null, selection)).rejects.toThrow("invalid");
			await expect(bridge.bind("peer", owner)).resolves.toBe(peer);
			await expect(runtime.invoke(peer, "receipt", null, selection)).resolves.toEqual(other);
			const selected = await bridge.bind(name, owner);
			if (!selected) throw new Error("Expected selected worker");
			await expect(runtime.invoke(selected, "receipt", null, selection)).resolves.toMatchObject({ version });
			if (!healthy) {
				expect(await readFile(join(packageRoot, "runtime.mjs"), "utf8")).toBe(runtimeSource);
				expect(JSON.parse(await readFile(settings, "utf8"))).toEqual(configured);
			}
		} finally {
			await backend.dispose();
			vi.unstubAllEnvs();
		}
	});

	it("preload rejects the real main validation envelope before runtime invocation", async () => {
		const { runtime } = clients(owner);
		await expect(Reflect.apply(runtime.invoke, runtime, ["", "receipt", null])).rejects.toMatchObject({
			name: "HostApiValidationFailure",
			code: "invalid_arguments",
		});
		expect(launch).not.toHaveBeenCalled();
		expect(approve).not.toHaveBeenCalled();
	});
	it("refuses readCode bindings while disabling persists the configuration", async () => {
		const { ui, runtime } = clients(owner);
		const loaded = await ui.readCode("runtime-receipt-ui");
		if ("error" in loaded || !loaded.runtimeBinding) throw new Error("Expected runtime binding");
		const receipt = (await runtime.invoke(
			loaded.runtimeBinding,
			"receipt",
			null,
			await runtime.selectSession(null),
		)) as { pid: number };
		let entered!: () => void;
		const persisting = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let finish!: () => void;
		const release = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const update = manager.updateConfig.bind(manager);
		vi.spyOn(manager, "updateConfig").mockImplementationOnce(async (patch) => {
			entered();
			await release;
			await update(patch);
		});
		const disabling = ui.setPluginEnabled("runtime-receipt-ui", false);
		await persisting;
		await expect(ui.readCode("runtime-receipt-ui")).rejects.toThrow("unavailable");
		finish();
		await disabling;
		expect(() => process.kill(receipt.pid, 0)).toThrow();
		expect(launch).toHaveBeenCalledOnce();
	});

	it("rejects UI code read across a new installed-source scan", async () => {
		const { ui } = clients(owner);
		let entered!: () => void;
		const reading = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let finish!: () => void;
		const release = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const read = manager.readCode.bind(manager);
		vi.spyOn(manager, "readCode").mockImplementationOnce(async (name) => {
			const code = await read(name);
			entered();
			await release;
			return code;
		});
		const loading = ui.readCode("runtime-receipt-ui");
		await reading;
		await bridge.withTransition(() => manager.scanAll());
		finish();
		await expect(loading).resolves.toEqual({
			error: "UI plugin installation changed while loading; reload required",
		});
		expect(launch).not.toHaveBeenCalled();
	});
});
