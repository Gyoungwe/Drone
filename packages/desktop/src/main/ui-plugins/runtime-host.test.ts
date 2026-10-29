// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type PluginCapabilityContext,
	PluginFileCapabilities,
	PluginResourceManager,
	PluginRuntimeRegistry,
	type PluginRuntimeSource,
	StorageRegistry,
	setReplyLanguage,
} from "@drone/backend";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({
	showMessageBox: vi.fn(),
	bridgeOptions: undefined as any,
	contents: { isDestroyed: vi.fn(() => false) },
	window: {},
}));
vi.mock("electron", () => ({
	app: { getPath: () => root },
	BrowserWindow: { fromWebContents: () => desktop.window },
	dialog: { showMessageBox: desktop.showMessageBox },
	webContents: { fromId: () => desktop.contents },
}));

vi.mock("./runtime-bridge", () => ({
	DesktopRuntimeBridge: class {
		constructor(options: unknown) {
			desktop.bridgeOptions = options;
		}
	},
}));

import {
	approveDesktopRuntime,
	createDesktopResourceCapabilities,
	createDesktopRuntime,
} from "./runtime-host";

let root: string;
let profile: string;
let state: string;
let data: string;
let source: PluginRuntimeSource;
const activation = () => ({
	pluginId: "@example/index",
	applicationId: "app",
	signal: new AbortController().signal,
	events: { changed: vi.fn() },
});
const context = (signal: AbortSignal): PluginCapabilityContext => ({
	pluginId: "@example/index",
	applicationId: "app",
	signal,
	scope: { kind: "application" },
	bootstrap: false,
	callerIdentity: {},
	capabilities: {
		call: async () => {
			throw new Error("Unexpected nested capability");
		},
	},
});

beforeEach(async () => {
	setReplyLanguage("en");
	desktop.showMessageBox.mockReset();
	desktop.contents.isDestroyed.mockReturnValue(false);
	root = await mkdtemp(join(tmpdir(), "drone-runtime-access-"));
	profile = join(root, "profile");
	state = join(root, "selected-state");
	data = join(root, "selected-data");
	await Promise.all([profile, state, data].map((path) => mkdir(path)));
	source = {
		pluginId: "@example/index",
		packageRoot: root,
		entrypoint: join(root, "runtime.js"),
		requestsStateRead: true,
		requestsFileRead: true,
		resources: { index: join(root, "resource.js") },
	};
});
afterEach(async () => {
	setReplyLanguage("en");
	await rm(root, { recursive: true, force: true });
});

describe("desktop activation directory grants", () => {
	it("keeps ordinary runtimes at zero roots without showing a picker or creating caches", async () => {
		const selectDirectories = vi.fn();
		const ports = await createDesktopResourceCapabilities(
			{ ...source, resources: undefined, requestsStateRead: undefined, requestsFileRead: undefined },
			root,
			{
				profileDirectory: profile,
				storage: new StorageRegistry(),
				selectDirectories,
			},
		)(activation());
		expect(ports.resources).toEqual([]);
		expect(ports.handlers).toEqual({});
		expect(selectDirectories).not.toHaveBeenCalled();
		expect(await readdir(profile)).toEqual([]);
	});

	it("does not infer filesystem authority from a resource declaration", async () => {
		const selectDirectories = vi.fn();
		const current = activation();
		const ports = await createDesktopResourceCapabilities(
			{ ...source, requestsStateRead: undefined, requestsFileRead: undefined },
			root,
			{
				profileDirectory: profile,
				storage: new StorageRegistry(),
				selectDirectories,
			},
		)(current);
		expect(selectDirectories).not.toHaveBeenCalled();
		expect(ports.resources).toEqual([]);
		await expect(
			ports.handlers["roots.resolve"]!.execute({ path: data, kind: "files" }, context(current.signal)),
		).rejects.toThrow("not granted");
		await ports.dispose?.();
	});

	it("keeps binary state selection and each actual write behind independent approval", async () => {
		let allowed = false;
		const approvals: (string | undefined)[] = [];
		const picker = vi.fn(async () => [state]);
		const provider = createDesktopResourceCapabilities(
			{
				...source,
				resources: undefined,
				requestsStateRead: undefined,
				requestsFileRead: undefined,
				requestsBinaryStateWrite: true,
			},
			root,
			{ profileDirectory: profile, storage: new StorageRegistry(), selectDirectories: picker },
		);
		const registry = new PluginRuntimeRegistry(
			{
				authorizeActivation: async () => true,
				authorizeInvocation: async (request) => {
					if (request.operation === "capability:state.writeBinary") {
						approvals.push(request.approvalDetail);
						return allowed;
					}
					return true;
				},
			},
			"actual-app",
			provider,
		);
		registry.register(source.pluginId, async (ctx) => ({
			operations: {
				persist: {
					inputSchema: { type: "null" },
					resultSchema: { type: "object" },
					effect: "write",
					execute: async () => {
						const selected = ctx.resources[0]!;
						expect(selected).toMatchObject({ kind: "binary-state", access: "read-write" });
						await ctx.capabilities.call("state.reserve", { root: selected.handle, path: "" });
						return ctx.capabilities.call("state.writeBinary", {
							root: selected.handle,
							path: "ledger.sqlite",
							base64: Buffer.from("actual binary").toString("base64"),
							expectedVersion: null,
							assertAbsent: ["ledger.sqlite-wal"],
						});
					},
				},
			},
			dispose: async () => {},
		}));
		const scope = {
				kind: "session" as const,
				sessionId: "creator-sdk",
				workspaceId: "actual-workspace",
				workspaceDirectory: await realpath(root),
			},
			identity = {};
		const client = await registry.activate(source.pluginId, () => ({
			scope,
			identity,
			signal: new AbortController().signal,
		}));
		try {
			expect(picker).toHaveBeenCalledExactlyOnceWith("binary-state-write");
			await expect(client.invoke("persist", null)).rejects.toThrow("capability denied");
			expect(await readdir(state)).toEqual([]);
			allowed = true;
			expect(await client.invoke("persist", null)).toMatchObject({ kind: "value" });
			expect(approvals).toHaveLength(2);
			for (const detail of approvals) {
				expect(detail).toContain("creator-sdk");
				expect(detail).toContain("actual-workspace");
				expect(detail).toContain(await realpath(state));
				expect(detail).toContain("logical content/diff is not displayed");
				expect(detail).toContain('"ledger.sqlite-wal"');
			}
		} finally {
			await registry.deactivate(source.pluginId);
		}
	});

	it("keeps no-resource JSON writes behind the broker's actual per-call approval", async () => {
		let allowWrite = false;
		const provider = createDesktopResourceCapabilities(
			{ ...source, resources: undefined, requestsStateWrite: true, requestsFileRead: undefined },
			root,
			{
				profileDirectory: profile,
				storage: new StorageRegistry(),
				selectDirectories: async () => [state],
			},
		);
		const registry = new PluginRuntimeRegistry(
			{
				authorizeActivation: async () => true,
				authorizeInvocation: async (request) =>
					request.operation !== "capability:state.writeJson" || allowWrite,
			},
			"application",
			provider,
		);
		registry.register(source.pluginId, async ({ capabilities, resources }) => {
			const handle = resources[0]!.handle;
			return {
				operations: {
					write: {
						inputSchema: { type: "null" },
						resultSchema: { type: "object" },
						effect: "write",
						execute: () =>
							capabilities.call("state.writeJson", {
								root: handle,
								path: "approved.json",
								value: { revision: 1 },
								expectedVersion: null,
							}),
					},
					read: {
						inputSchema: { type: "null" },
						resultSchema: { type: "object" },
						effect: "read",
						execute: () => capabilities.call("state.readJson", { root: handle, path: "approved.json" }),
					},
				},
				dispose: async () => {},
			};
		});
		const caller = {
			identity: {},
			scope: { kind: "application" as const },
			signal: new AbortController().signal,
		};
		const client = await registry.activate(source.pluginId, () => caller);
		await expect(client.invoke("write", null)).rejects.toThrow("Plugin capability denied");
		expect(await readdir(state)).toEqual([]);
		allowWrite = true;
		const written = await client.invoke("write", null);
		expect(await client.invoke("read", null)).toEqual(written);
		await registry.deactivate(source.pluginId);
		await expect(client.invoke("read", null)).rejects.toThrow("not active");
	});

	it("retains every activation lease when filesystem drain fails before final release", async () => {
		const drain = vi
			.spyOn(PluginFileCapabilities.prototype, "drain")
			.mockRejectedValue(new Error("filesystem cleanup failed"));
		const filesReleased = vi.spyOn(PluginFileCapabilities.prototype, "releaseReservations");
		const resourcesReleased = vi.spyOn(PluginResourceManager.prototype, "releaseReservations");
		try {
			const provider = createDesktopResourceCapabilities(source, root, {
				profileDirectory: profile,
				storage: new StorageRegistry(),
				selectDirectories: async () => [state],
			});
			const registry = new PluginRuntimeRegistry(
				{ authorizeActivation: async () => true, authorizeInvocation: async () => true },
				"application",
				provider,
			);
			registry.register(source.pluginId, async () => ({ operations: {}, dispose: async () => {} }));
			await registry.activate(source.pluginId, () => ({
				identity: {},
				scope: { kind: "application" },
				signal: new AbortController().signal,
			}));
			await expect(registry.deactivate(source.pluginId)).rejects.toThrow("filesystem cleanup failed");
			expect(filesReleased).not.toHaveBeenCalled();
			expect(resourcesReleased).not.toHaveBeenCalled();
		} finally {
			drain.mockRestore();
			filesReleased.mockRestore();
			resourcesReleased.mockRestore();
		}
	});

	for (const kind of ["state", "files"] as const) {
		it(`uses declared ${kind} access without any resource worker`, async () => {
			await writeFile(join(state, "journal.json"), JSON.stringify({ revision: 1 }));
			await writeFile(join(data, "note.md"), "read without an index");
			const selectDirectories = vi.fn(async () => [kind === "state" ? state : data]);
			const current = activation();
			const ports = await createDesktopResourceCapabilities(
				{
					...source,
					resources: undefined,
					requestsStateRead: kind === "state",
					requestsFileRead: kind === "files",
				},
				root,
				{ profileDirectory: profile, storage: new StorageRegistry(), selectDirectories },
			)(current);
			expect(selectDirectories.mock.calls).toEqual([[kind]]);
			expect(ports.resources).toHaveLength(1);
			const grant = ports.resources[0]!;
			expect(grant).toMatchObject({ kind, access: "read" });
			const read = kind === "state" ? "state.readJson" : "files.readText";
			const path = kind === "state" ? "journal.json" : "note.md";
			expect(
				await ports.handlers[read]!.execute({ root: grant.handle, path }, context(current.signal)),
			).toMatchObject(
				kind === "state" ? { kind: "value", value: { revision: 1 } } : { text: "read without an index" },
			);
			expect(Object.keys(ports.handlers).some((name) => name.startsWith("resource."))).toBe(false);
			expect(ports.resourcesLifecycle).toBeUndefined();
			await ports.dispose?.();
			await ports.finalRelease?.();
		});
	}

	it("writes and reads back JSON without requiring a data directory or a derived resource", async () => {
		const selectDirectories = vi.fn(async () => [state]);
		const current = activation();
		const ports = await createDesktopResourceCapabilities(
			{
				...source,
				resources: undefined,
				requestsStateRead: undefined,
				requestsFileRead: undefined,
				requestsStateWrite: true,
			},
			root,
			{ profileDirectory: profile, storage: new StorageRegistry(), selectDirectories },
		)(current);
		expect(selectDirectories.mock.calls).toEqual([["state-write"]]);
		const grant = ports.resources[0]!;
		expect(grant).toMatchObject({ kind: "state", access: "read-write" });
		const written = await ports.handlers["state.writeJson"]!.execute(
			{
				root: grant.handle,
				path: "journal.json",
				value: { revision: 2 },
				expectedVersion: null,
			},
			context(current.signal),
		);
		expect(
			await ports.handlers["state.readJson"]!.execute(
				{ root: grant.handle, path: "journal.json" },
				context(current.signal),
			),
		).toEqual(written);
		expect(ports.resourcesLifecycle).toBeUndefined();
		expect(await readdir(data)).toEqual([]);
	});

	for (const canceled of ["state", "state-write", "files", "files-write"] as const) {
		it(`rejects a canceled ${canceled} selection without initializing resources`, async () => {
			const selectDirectories = vi.fn(async (kind: "state" | "state-write" | "files" | "files-write") =>
				kind === canceled ? [] : [state],
			);
			await expect(
				createDesktopResourceCapabilities(
					{
						...source,
						requestsStateWrite: canceled === "state-write",
						requestsFileWrite: canceled === "files-write",
					},
					root,
					{
						profileDirectory: profile,
						storage: new StorageRegistry(),
						selectDirectories,
					},
				)(activation()),
			).rejects.toThrow("selection was canceled");
			expect(await readdir(profile)).toEqual([]);
		});
	}

	it("cancels a pending picker and ignores its late answer", async () => {
		const abort = new AbortController();
		let answer!: (paths: string[]) => void;
		const selectDirectories = vi.fn(
			() =>
				new Promise<string[]>((resolve) => {
					answer = resolve;
				}),
		);
		const pending = createDesktopResourceCapabilities(source, root, {
			profileDirectory: profile,
			storage: new StorageRegistry(),
			selectDirectories,
		})({ ...activation(), signal: abort.signal });
		await vi.waitFor(() => expect(answer).toBeDefined());
		abort.abort(new Error("activation canceled"));
		await expect(pending).rejects.toThrow("activation canceled");
		answer([state]);
		await Promise.resolve();
		expect(selectDirectories).toHaveBeenCalledTimes(1);
		expect(await readdir(profile)).toEqual([]);
	});

	it("grants only canonical selected directories with fresh handles and a separate private cache", async () => {
		await writeFile(join(state, "binding.json"), JSON.stringify({ vault: join(root, "unselected") }));
		await writeFile(join(data, "note.md"), "selected data");
		const alias = join(root, "data-alias");
		await symlink(data, alias);
		const selectDirectories = vi.fn(async (kind: "state" | "state-write" | "files" | "files-write") =>
			kind === "state" ? [state] : [alias, data],
		);
		const provider = createDesktopResourceCapabilities(source, root, {
			profileDirectory: profile,
			storage: new StorageRegistry(),
			selectDirectories,
		});
		const current = activation();
		const ports = await provider(current);
		expect(ports.resources.map((root) => root.kind)).toEqual(["state", "files"]);
		const stateHandle = ports.resources.find((root) => root.kind === "state")?.handle;
		const fileHandle = ports.resources.find((root) => root.kind === "files")?.handle;
		const call = context(current.signal);
		expect(ports.resources.every((root) => root.access === "read")).toBe(true);
		await expect(
			ports.handlers["state.writeJson"]?.execute(
				{ root: stateHandle, path: "new.json", value: {}, expectedVersion: null },
				call,
			),
		).rejects.toThrow("not granted");
		expect(
			await ports.handlers["state.readJson"]?.execute({ root: stateHandle, path: "binding.json" }, call),
		).toMatchObject({ kind: "value" });
		expect(
			await ports.handlers["files.readText"]?.execute({ root: fileHandle, path: "note.md" }, call),
		).toMatchObject({ text: "selected data" });
		await expect(
			ports.handlers["roots.resolve"]?.execute({ path: join(root, "unselected"), kind: "files" }, call),
		).rejects.toThrow("not granted");
		await expect(
			ports.handlers["files.readText"]?.execute({ root: stateHandle, path: "binding.json" }, call),
		).rejects.toThrow("not granted");
		const cache = join(
			await realpath(profile),
			"plugin-runtime-cache",
			createHash("sha256").update(source.pluginId).digest("hex"),
		);
		expect((await stat(cache)).mode & 0o777).toBe(0o700);
		expect(await readdir(state)).toEqual(["binding.json"]);
		expect(await readdir(data)).toEqual(["note.md"]);
		const again = await provider(activation());
		expect(new Set([...ports.resources, ...again.resources].map((root) => root.handle)).size).toBe(4);
		await ports.dispose?.();
		await again.dispose?.();
	});

	it("requires the explicit write picker and registers the selected private state before writing", async () => {
		const storage = new StorageRegistry();
		const selectDirectories = vi.fn(async (kind: "state" | "state-write" | "files" | "files-write") => [
			kind === "state-write" ? state : data,
		]);
		const current = activation();
		const ports = await createDesktopResourceCapabilities({ ...source, requestsStateWrite: true }, root, {
			profileDirectory: profile,
			storage,
			selectDirectories,
		})(current);
		expect(selectDirectories.mock.calls.map(([kind]) => kind)).toEqual(["state-write", "files"]);
		expect(storage.list()).toMatchObject([
			{
				path: await realpath(state),
				owner: "plugin:@example/index",
				sensitivity: "private",
				schema: "plugin-owned",
			},
		]);
		const stateRoot = ports.resources.find((root) => root.kind === "state")!;
		expect(stateRoot.access).toBe("read-write");
		expect(ports.resources.find((root) => root.kind === "files")?.access).toBe("read");
		const written = await ports.handlers["state.writeJson"]!.execute(
			{
				root: stateRoot.handle,
				path: "policy.json",
				value: { version: 1, mode: "strict" },
				expectedVersion: null,
			},
			context(current.signal),
		);
		expect(written).toMatchObject({ kind: "value", value: { version: 1, mode: "strict" } });
		expect(
			await ports.handlers["state.readJson"]!.execute(
				{ root: stateRoot.handle, path: "policy.json" },
				context(current.signal),
			),
		).toEqual(written);
		await ports.dispose?.();
	});

	it("grants text writes only for the separately selected files-write directory", async () => {
		const selectDirectories = vi.fn(async (kind: "state" | "state-write" | "files" | "files-write") => [
			kind === "files-write" ? data : state,
		]);
		const current = activation();
		const ports = await createDesktopResourceCapabilities({ ...source, requestsFileWrite: true }, root, {
			profileDirectory: profile,
			storage: new StorageRegistry(),
			selectDirectories,
		})(current);
		expect(selectDirectories.mock.calls.map(([kind]) => kind)).toEqual(["state", "files-write"]);
		const stateRoot = ports.resources.find((entry) => entry.kind === "state")!;
		const fileRoot = ports.resources.find((entry) => entry.kind === "files")!;
		expect(stateRoot.access).toBe("read");
		expect(fileRoot.access).toBe("read-write");
		const input = { root: fileRoot.handle, path: "proposal.md", text: "# Proposed note", expectedHash: null };
		const detail = ports.handlers["files.writeText"]!.approvalDetail!(
			input,
			context(new AbortController().signal),
		);
		expect(detail).toContain(`Authorized directory: ${JSON.stringify(await realpath(data))}`);
		expect(detail).toContain('Root-relative path: "proposal.md"');
		expect(detail).toContain("expectedHash: null");
		expect(detail).toContain(input.text);
		expect(detail).toContain("target must be absent");
		const written = await ports.handlers["files.writeText"]!.execute(input, context(current.signal));
		expect(written).toMatchObject({
			text: input.text,
			sha256: createHash("sha256").update(input.text).digest("hex"),
		});
		const remove = ports.handlers["files.remove"]!.approvalDetail!(
			{
				root: fileRoot.handle,
				path: input.path,
				expectedHash: createHash("sha256").update(input.text).digest("hex"),
			},
			context(new AbortController().signal),
		);
		expect(remove).toContain("Remove file");
		expect(remove).toContain(`expectedHash: "${createHash("sha256").update(input.text).digest("hex")}"`);
		expect(
			ports.handlers["files.ensureDirectory"]!.approvalDetail!(
				{ root: fileRoot.handle, path: "nested" },
				context(new AbortController().signal),
			),
		).toContain("Create directory");
		expect(() =>
			ports.handlers["state.writeJson"]!.approvalDetail!(
				{
					root: stateRoot.handle,
					path: "policy.json",
					expectedVersion: null,
					value: {},
				},
				context(new AbortController().signal),
			),
		).toThrow("not granted");
		expect(() =>
			ports.handlers["files.writeText"]!.approvalDetail!(
				{ ...input, root: stateRoot.handle },
				context(new AbortController().signal),
			),
		).toThrow("not granted");
		await ports.dispose?.();
	});

	it("rejects a private-cache symlink before creating anything in the outside directory", async () => {
		const outside = join(root, "outside");
		await mkdir(outside);
		await symlink(outside, join(profile, "plugin-runtime-cache"));
		await expect(
			createDesktopResourceCapabilities(source, root, {
				profileDirectory: profile,
				storage: new StorageRegistry(),
				selectDirectories: async (kind) => [kind === "state" ? state : data],
			})(activation()),
		).rejects.toThrow("inside the host profile");
		expect(await readdir(outside)).toEqual([]);
	});
});

describe("desktop write approval details", () => {
	async function writablePorts() {
		return createDesktopResourceCapabilities({ ...source, requestsStateWrite: true }, root, {
			profileDirectory: profile,
			storage: new StorageRegistry(),
			selectDirectories: async (kind) => [kind === "state-write" ? state : data],
		})(activation());
	}

	it("shows the selected canonical root, relative target, CAS version and complete JSON before approval", async () => {
		const ports = await writablePorts();
		const handle = ports.resources.find((entry) => entry.kind === "state")!.handle;
		const input = {
			root: handle,
			path: "policy.json",
			expectedVersion: "a".repeat(64),
			value: { mode: "strict", claimedDirectory: "/unselected/path" },
		};
		const detail = ports.handlers["state.writeJson"]!.approvalDetail!(
			input,
			context(new AbortController().signal),
		);
		expect(detail).toContain(`Authorized directory: ${JSON.stringify(await realpath(state))}`);
		expect(detail).toContain('Root-relative path: "policy.json"');
		expect(detail).toContain(`expectedVersion: "${"a".repeat(64)}"`);
		expect(detail).toContain(JSON.stringify(input.value, null, 2));
		expect(detail).toContain("complete proposed content");
		expect(detail).not.toContain('Authorized directory: "/unselected/path"');
		desktop.showMessageBox.mockResolvedValue({ response: 0 });
		expect(
			await approveDesktopRuntime(
				{ id: 1, isDestroyed: () => false },
				source,
				"capability:state.writeJson",
				detail,
			),
		).toBe(false);
		expect(desktop.showMessageBox).toHaveBeenCalledWith(
			desktop.window,
			expect.objectContaining({ detail, defaultId: 0, cancelId: 0 }),
		);
		expect(await readdir(state)).toEqual([]);
		await ports.dispose?.();
	});

	it("bounds large content honestly and does not grant a root from another activation", async () => {
		const ports = await writablePorts();
		const other = await writablePorts();
		const handle = ports.resources.find((entry) => entry.kind === "state")!.handle;
		const input = {
			root: handle,
			path: "large.json",
			expectedVersion: null,
			value: { text: `${"x".repeat(5000)}HIDDEN-END` },
		};
		const detail = ports.handlers["state.writeJson"]!.approvalDetail!(
			input,
			context(new AbortController().signal),
		);
		expect(detail).toContain("first 4000");
		expect(detail).toContain("full content is not displayed");
		expect(detail).toContain("Deny if this is insufficient");
		expect(detail).not.toContain("HIDDEN-END");
		expect(detail).not.toContain("complete proposed content");
		expect(detail).toContain("target must be absent");
		expect(() =>
			other.handlers["state.writeJson"]!.approvalDetail!(input, context(new AbortController().signal)),
		).toThrow("not granted");
		await ports.dispose?.();
		await other.dispose?.();
	});

	it("distinguishes deletion from directory creation without pretending their contents were displayed", async () => {
		const ports = await writablePorts();
		const handle = ports.resources.find((entry) => entry.kind === "state")!.handle;
		const remove = ports.handlers["state.removeJson"]!.approvalDetail!(
			{
				root: handle,
				path: "pending.json",
				expectedVersion: "b".repeat(64),
			},
			context(new AbortController().signal),
		);
		expect(remove).toContain("Remove file");
		expect(remove).toContain(`expectedVersion: "${"b".repeat(64)}"`);
		expect(remove).toContain("does not display the file's contents");
		const directory = ports.handlers["state.ensureDirectory"]!.approvalDetail!(
			{
				root: handle,
				path: "nested/state",
			},
			context(new AbortController().signal),
		);
		expect(directory).toContain("Create directory (preserve existing directory)");
		expect(directory).toContain('Root-relative path: "nested/state"');
		expect(directory).not.toContain("expectedVersion");
		setReplyLanguage("zh");
		expect(
			ports.handlers["state.writeJson"]!.approvalDetail!(
				{
					root: handle,
					path: "policy.json",
					expectedVersion: null,
					value: {},
				},
				context(new AbortController().signal),
			),
		).toContain("以上为拟写入内容全文");
		await ports.dispose?.();
	});

	it("requires an explicit Allow and still rejects a window closed during the dialog", async () => {
		desktop.showMessageBox.mockResolvedValue({ response: 1 });
		const owner = { id: 1, isDestroyed: () => false };
		expect(await approveDesktopRuntime(owner, source, "write", "Host-resolved target")).toBe(true);
		desktop.showMessageBox.mockImplementation(async () => {
			desktop.contents.isDestroyed.mockReturnValue(true);
			return { response: 1 };
		});
		expect(await approveDesktopRuntime(owner, source, "write", "Host-resolved target")).toBe(false);
	});
});

it("closes a pending parent-window runtime permission dialog through the actual operation signal", async () => {
	const controller = new AbortController();
	let received!: AbortSignal;
	desktop.showMessageBox.mockImplementation(async (_window, options) => {
		received = options.signal;
		return new Promise((resolve) =>
			received.addEventListener("abort", () => resolve({ response: 1 }), { once: true }),
		);
	});
	const answer = approveDesktopRuntime(
		{ id: 1, isDestroyed: () => false },
		source,
		"model.generate",
		"actual provider/model and cost",
		controller.signal,
	);
	expect(received).toBe(controller.signal);
	controller.abort();
	expect(await answer).toBe(false);
});

it("exposes eight generic session handlers without a model declaration, then gates exactly three model handlers", async () => {
	const handler = {
		effect: "read",
		inputSchema: { type: "null" },
		resultSchema: { type: "null" },
		execute: async () => null,
	};
	const handlers = Object.fromEntries(
		[
			"session.inspect",
			"session.tools",
			"session.select",
			"session.input",
			"session.confirm",
			"session.records.read",
			"session.records.append",
			"session.notify",
			"session.records.adoption.inspect",
			"session.records.adoption.commit",
			"model.selection",
			"model.generate",
			"model.toolStep",
		].map((name) => [name, handler]),
	);
	const sessions = {
		getPluginCallerContext: () => undefined,
		getPluginSessionCapabilities: () => handlers,
		getPluginTaskGrantCapabilities: () => ({ "task.grant.request": handler }),
		getTaskGrants: () => taskGrants,
		getPluginWorkspaceCapabilities: () => ({ "workspace.readFile": handler }),
		getStorageRegistry: () => new StorageRegistry(),
	};
	const taskGrants = { bindSourceValidator: vi.fn() };
	createDesktopRuntime(
		{ runtimeSource: () => source, isEnabled: () => true } as any,
		root,
		sessions as any,
		(owner) => ({ ownerId: owner.id, send: () => false, resolved: () => {} }),
	);
	const selected = { pluginId: "question-client", packageRoot: root, entrypoint: join(root, "question.mjs") };
	const owner = { id: 1, isDestroyed: () => false };
	const without = await desktop.bridgeOptions.capabilities(selected, owner)(activation());
	expect(
		Object.keys(without.handlers)
			.filter((name) => name.startsWith("session."))
			.sort(),
	).toEqual([
		"session.confirm",
		"session.input",
		"session.inspect",
		"session.notify",
		"session.records.append",
		"session.records.read",
		"session.select",
		"session.tools",
	]);
	for (const name of ["session.records.read", "session.records.append", "session.notify"])
		expect(without.handlers[name]).toBe(handler);
	expect(without.handlers["model.selection"]).toBeUndefined();
	expect(without.handlers["model.generate"]).toBeUndefined();
	expect(without.handlers["model.toolStep"]).toBeUndefined();
	expect(without.handlers["model.toolStep"]).toBeUndefined();
	const withModel = await desktop.bridgeOptions.capabilities(
		{ ...selected, requestsModel: true },
		owner,
	)(activation());
	expect(withModel.handlers["model.selection"]).toBe(handler);
	expect(withModel.handlers["model.generate"]).toBe(handler);
	const recordAdoptions = {
		recovery: { legacyType: "legacy-recovery-v1", fromVersions: ["0.2.1"], removeBeforeVersion: "2.0.0" },
	};
	const withAdoption = await desktop.bridgeOptions.capabilities(
		{ ...selected, recordAdoptions },
		owner,
	)(activation());
	expect(withAdoption.handlers["session.records.adoption.inspect"]).toBe(handler);
	expect(withAdoption.handlers["session.records.adoption.commit"]).toBe(handler);
	expect(withAdoption.handlers["model.generate"]).toBeUndefined();
	expect(without.handlers["session.records.adoption.inspect"]).toBeUndefined();

	expect(withModel.handlers["model.toolStep"]).toBe(handler);
	// Task authorization only for packages that declared drone.taskGrants; the bridge validates sources.
	expect(without.handlers["task.grant.request"]).toBeUndefined();
	const withTask = await desktop.bridgeOptions.capabilities(
		{ ...selected, requestsTaskGrant: true },
		owner,
	)(activation());
	expect(withTask.handlers["task.grant.request"]).toBe(handler);
	expect(withTask.handlers["workspace.readFile"]).toBeUndefined();
	const withRead = await desktop.bridgeOptions.capabilities(
		{ ...selected, requestsWorkspaceRead: true },
		owner,
	)(activation());
	expect(withRead.handlers["workspace.readFile"]).toBe(handler);
	expect(desktop.bridgeOptions.taskGrants).toBe(taskGrants);
});
