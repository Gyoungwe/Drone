import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsonStore, JsonStoreCorruptedError } from "../json-store";
import { StorageRegistry } from "../storage/registry";
import { fileCapabilityHandlers, type PluginFileCall, PluginFileCapabilities } from "./file-capabilities";
import { PluginCapabilityBroker } from "./runtime-capabilities";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, rename: vi.fn(actual.rename) };
});
const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let root: string, state: string, cache: string;
let registry: StorageRegistry, ports: PluginFileCapabilities;
let call: PluginFileCall;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const input = { root: "state", path: "config.json" };
beforeEach(async () => {
	vi.mocked(fs.rename).mockImplementation(actualFs.rename);
	root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "plugin-state-")));
	state = join(root, "state");
	cache = join(root, "cache");
	await fs.mkdir(state);
	await fs.mkdir(cache);
	registry = new StorageRegistry().register({
		id: "plugin-test-state",
		path: state,
		owner: "plugin:test",
		schema: 1,
		sensitivity: "private",
	});
	ports = await writable();
	call = { scope: { kind: "application" }, signal: new AbortController().signal, bootstrap: false };
});
afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(root, { recursive: true, force: true });
});
function writable() {
	return PluginFileCapabilities.create(
		[
			{
				handle: "state",
				path: state,
				kind: "state",
				scope: { kind: "application" },
				stateWrite: { registry, storageId: "plugin-test-state" },
			},
		],
		cache,
	);
}

describe("explicit state JSON write grants", () => {
	it("returns raw-byte versions, preserves schema and reads back atomic writes", async () => {
		expect(await ports.readJson(input, call)).toEqual({ kind: "missing", version: null });
		const value = { version: 1, mode: "strict" };
		const first = await ports.writeJson({ ...input, value, expectedVersion: null }, call);
		const raw = await fs.readFile(join(state, input.path), "utf8");
		expect(first).toEqual({ kind: "value", value, version: hash(raw) });
		expect(JSON.parse(raw)).toEqual(value);
		expect((await fs.stat(join(state, input.path))).mode & 0o777).toBe(0o600);
		expect(await ports.listState({ root: "state", path: "" }, { ...call, bootstrap: true })).toEqual([
			{ name: input.path, kind: "file" },
		]);
		expect(await fs.readdir(state)).toEqual([input.path]);
	});
	it("conflicts two real concurrent writes across separate capability instances", async () => {
		const first = await ports.writeJson({ ...input, value: { value: 0 }, expectedVersion: null }, call);
		const other = await writable();
		const results = await Promise.allSettled([
			ports.writeJson({ ...input, value: { value: 1 }, expectedVersion: first.version }, call),
			other.writeJson({ ...input, value: { value: 2 }, expectedVersion: first.version }, call),
		]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((result) => result.status === "rejected")).toEqual([
			expect.objectContaining({ reason: expect.objectContaining({ code: "ESTATECONFLICT" }) }),
		]);
		const winner = results.find((result) => result.status === "fulfilled");
		expect(await ports.readJson(input, call)).toEqual(
			winner?.status === "fulfilled" ? winner.value : undefined,
		);
	});
	it("shares the existing JsonStore queue and never overwrites a queued ordinary writer", async () => {
		const first = await ports.writeJson({ ...input, value: { value: 0 }, expectedVersion: null }, call);
		let release!: () => void;
		let entered!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		vi.mocked(fs.rename).mockImplementationOnce(async (...args) => {
			entered();
			await gate;
			return actualFs.rename(...args);
		});
		const ordinary = new JsonStore({
			path: join(state, input.path),
			storageId: "plugin-test-state",
			defaultValue: () => ({ value: 0 }),
		});
		const writing = ordinary.write({ value: 9 });
		await started;
		const contender = ports.writeJson(
			{ ...input, value: { value: 1 }, expectedVersion: first.version },
			call,
		);
		const rejected = expect(contender).rejects.toMatchObject({ code: "ESTATECONFLICT" });
		expect(JSON.parse(await fs.readFile(join(state, input.path), "utf8"))).toEqual({ value: 0 });
		release();
		await writing;
		await rejected;
		expect(JSON.parse(await fs.readFile(join(state, input.path), "utf8"))).toEqual({ value: 9 });
	});
	it("preserves the old file and removes the temporary file when rename fails", async () => {
		const first = await ports.writeJson({ ...input, value: { value: 0 }, expectedVersion: null }, call);
		vi.mocked(fs.rename).mockRejectedValueOnce(Object.assign(new Error("rename denied"), { code: "EACCES" }));
		await expect(
			ports.writeJson({ ...input, value: { value: 1 }, expectedVersion: first.version }, call),
		).rejects.toThrow("rename denied");
		expect(await ports.readJson(input, call)).toEqual(first);
		expect(await fs.readdir(state)).toEqual([input.path]);
	});
	it("refuses corrupted JSON rather than overwriting it", async () => {
		await fs.writeFile(join(state, input.path), "{broken");
		await expect(
			ports.writeJson({ ...input, value: {}, expectedVersion: hash("{broken") }, call),
		).rejects.toBeInstanceOf(JsonStoreCorruptedError);
		await expect(ports.readJson(input, call)).rejects.toMatchObject({ code: "ESTATECORRUPTED" });
		expect(await fs.readFile(join(state, input.path), "utf8")).toBe("{broken");
	});
	it("does not upgrade read-only roots or allow bootstrap or data-root writes", async () => {
		const readonly = await PluginFileCapabilities.create(
			[
				{ handle: "state", path: state, kind: "state", scope: { kind: "application" } },
				{ handle: "files", path: state, kind: "files", scope: { kind: "application" } },
			],
			cache,
		);
		await expect(readonly.writeJson({ ...input, value: {}, expectedVersion: null }, call)).rejects.toThrow(
			"not granted",
		);
		await expect(
			readonly.writeJson({ ...input, root: "files", value: {}, expectedVersion: null }, call),
		).rejects.toThrow("not granted");
		await expect(
			ports.writeJson({ ...input, value: {}, expectedVersion: null }, { ...call, bootstrap: true }),
		).rejects.toThrow("not granted");
		expect(await fs.readdir(state)).toEqual([]);
	});
	it("rejects traversal, symlink targets/parents, unregistered roots, non-JSON and missing parents", async () => {
		for (const path of ["../outside.json", "/outside.json", "nested/../outside.json"])
			await expect(
				ports.writeJson({ root: "state", path, value: {}, expectedVersion: null }, call),
			).rejects.toThrow("root-relative");
		await fs.mkdir(join(root, "outside"));
		await fs.writeFile(join(root, "outside/secret.json"), "{}");
		await fs.symlink(join(root, "outside"), join(state, "linked"));
		await fs.symlink(join(root, "outside/secret.json"), join(state, "alias.json"));
		for (const path of ["alias.json", "linked/secret.json"])
			await expect(
				ports.writeJson({ root: "state", path, value: {}, expectedVersion: null }, call),
			).rejects.toThrow("symlinks");
		await expect(
			ports.writeJson({ ...input, path: "note.md", value: {}, expectedVersion: null }, call),
		).rejects.toThrow(".json");
		await expect(
			ports.writeJson({ ...input, path: "missing/file.json", value: {}, expectedVersion: null }, call),
		).rejects.toMatchObject({ code: "ENOENT" });
		await expect(
			PluginFileCapabilities.create(
				[
					{
						handle: "state",
						path: state,
						kind: "state",
						scope: { kind: "application" },
						stateWrite: { registry, storageId: "forged" },
					},
				],
				cache,
			),
		).rejects.toThrow("Unregistered");
		expect(await fs.readFile(join(root, "outside/secret.json"), "utf8")).toBe("{}");
	});
	it("checks the workspace and cancellation again after waiting for an older transaction", async () => {
		const scoped = await PluginFileCapabilities.create(
			[
				{
					handle: "state",
					path: state,
					kind: "state",
					scope: { kind: "workspace", workspaceId: "alpha" },
					stateWrite: { registry, storageId: "plugin-test-state" },
				},
			],
			cache,
		);
		await expect(scoped.writeJson({ ...input, value: {}, expectedVersion: null }, call)).rejects.toThrow(
			"another workspace",
		);
		const controller = new AbortController();
		let release!: () => void;
		let entered!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		vi.mocked(fs.rename).mockImplementationOnce(async (...args) => {
			entered();
			await gate;
			return actualFs.rename(...args);
		});
		const initial = ports.writeJson({ ...input, value: { first: true }, expectedVersion: null }, call);
		await started;
		const waiting = ports.writeJson(
			{ ...input, value: { late: true }, expectedVersion: null },
			{ ...call, signal: controller.signal },
		);
		const rejected = expect(waiting).rejects.toThrow("session closed");
		controller.abort(new Error("session closed"));
		release();
		await initial;
		await rejected;
		expect(JSON.parse(await fs.readFile(join(state, input.path), "utf8"))).toEqual({ first: true });
	});
	it("enforces JSON/effect/approval boundaries through the actual capability broker", async () => {
		const broker = new PluginCapabilityBroker({ handlers: fileCapabilityHandlers(ports), resources: [] });
		const context = { pluginId: "test", applicationId: "app", callerIdentity: {}, ...call };
		const write = { ...input, value: { mode: "strict" }, expectedVersion: null };
		await expect(
			broker.run(
				context,
				"read",
				() => {},
				async () => true,
				() => broker.port.call("state.writeJson", write),
			),
		).rejects.toThrow("Read-only");
		await expect(
			broker.run(
				context,
				"write",
				() => {},
				async () => false,
				() => broker.port.call("state.writeJson", write),
			),
		).rejects.toThrow("denied");
		await expect(
			broker.run(
				context,
				"write",
				() => {},
				async () => true,
				() => broker.port.call("state.writeJson", { ...write, value: undefined }),
			),
		).rejects.toThrow("Invalid plugin capability input");
		await expect(
			broker.run(
				context,
				"write",
				() => {},
				async () => true,
				() => broker.port.call("state.writeJson", write),
			),
		).resolves.toMatchObject({ kind: "value", value: { mode: "strict" } });
	});
});

describe("explicit state directory initialization", () => {
	it("creates one directory, reads it back and then permits an atomic JSON create", async () => {
		const directory = { root: "state", path: "vault-a" };
		expect(await ports.readJson({ root: "state", path: "vault-a/settings.json" }, call)).toEqual({
			kind: "missing",
			version: null,
		});
		expect(await fs.readdir(state)).toEqual([]);
		expect(await ports.ensureStateDirectory(directory, call)).toEqual({ created: true });
		expect((await fs.stat(join(state, "vault-a"))).mode & 0o777).toBe(0o700);
		expect(await ports.ensureStateDirectory(directory, call)).toEqual({ created: false });
		await expect(
			ports.writeJson(
				{ root: "state", path: "vault-a/settings.json", value: { enabled: true }, expectedVersion: null },
				call,
			),
		).resolves.toMatchObject({ kind: "value", value: { enabled: true } });
	});
	it("requires live write authority through the broker and does not initialize missing ancestors", async () => {
		const broker = new PluginCapabilityBroker({ handlers: fileCapabilityHandlers(ports), resources: [] });
		const context = { pluginId: "test", applicationId: "app", callerIdentity: {}, ...call };
		const request = () => broker.port.call("state.ensureDirectory", { root: "state", path: "vault-a" });
		await expect(
			broker.run(
				context,
				"read",
				() => {},
				async () => true,
				request,
			),
		).rejects.toThrow("Read-only");
		await expect(
			broker.run(
				context,
				"write",
				() => {},
				async () => false,
				request,
			),
		).rejects.toThrow("denied");
		await expect(
			broker.run(
				{ ...context, bootstrap: true },
				"write",
				() => {},
				async () => true,
				request,
			),
		).rejects.toThrow("bootstrap");
		expect(await fs.readdir(state)).toEqual([]);
		await expect(
			ports.ensureStateDirectory({ root: "state", path: "missing/child" }, call),
		).rejects.toMatchObject({ code: "ENOENT" });
		await expect(
			broker.run(
				context,
				"write",
				() => {},
				async () => true,
				request,
			),
		).resolves.toEqual({ created: true });
	});
	it("does not create a directory when its caller is revoked during approval", async () => {
		const controller = new AbortController();
		const broker = new PluginCapabilityBroker({ handlers: fileCapabilityHandlers(ports), resources: [] });
		const context = {
			pluginId: "test",
			applicationId: "app",
			callerIdentity: {},
			...call,
			signal: controller.signal,
		};
		await expect(
			broker.run(
				context,
				"write",
				() => {},
				async () => {
					controller.abort(new Error("session closed"));
					return true;
				},
				() => broker.port.call("state.ensureDirectory", { root: "state", path: "late" }),
			),
		).rejects.toThrow("session closed");
		expect(await fs.readdir(state)).toEqual([]);
	});
	it("rejects ungranted state writes, escaped paths and symlink or file collisions without changing them", async () => {
		const readonly = await PluginFileCapabilities.create(
			[{ handle: "state", path: state, kind: "state", scope: { kind: "application" } }],
			cache,
		);
		await expect(readonly.ensureStateDirectory({ root: "state", path: "new" }, call)).rejects.toThrow(
			"not granted",
		);
		await expect(ports.ensureStateDirectory({ root: "state", path: "../outside" }, call)).rejects.toThrow(
			"root-relative",
		);
		await fs.mkdir(join(root, "outside"));
		await fs.symlink(join(root, "outside"), join(state, "alias"));
		await fs.writeFile(join(state, "existing"), "keep");
		await expect(ports.ensureStateDirectory({ root: "state", path: "alias" }, call)).rejects.toThrow(
			"symlinks",
		);
		await expect(ports.ensureStateDirectory({ root: "state", path: "alias/new" }, call)).rejects.toThrow(
			"symlinks",
		);
		await expect(ports.ensureStateDirectory({ root: "state", path: "existing" }, call)).rejects.toThrow(
			"not a directory",
		);
		expect(await fs.readFile(join(state, "existing"), "utf8")).toBe("keep");
		expect(await fs.readdir(join(root, "outside"))).toEqual([]);
	});
});

describe("checked state JSON removal", () => {
	it("removes the read version and verifies absence without treating repeat removal as success", async () => {
		const written = await ports.writeJson(
			{ ...input, value: { candidate: "pending" }, expectedVersion: null },
			call,
		);
		const version = written.version as string;
		expect(await ports.removeJson({ ...input, expectedVersion: version }, call)).toEqual({
			kind: "missing",
			version: null,
		});
		expect(await fs.readdir(state)).toEqual([]);
		await expect(ports.removeJson({ ...input, expectedVersion: version }, call)).rejects.toMatchObject({
			code: "ESTATECONFLICT",
		});
	});
	it("serializes an actual concurrent JSON edit and removal across capability instances", async () => {
		const first = await ports.writeJson({ ...input, value: { value: 0 }, expectedVersion: null }, call);
		const other = await writable();
		const results = await Promise.allSettled([
			ports.writeJson({ ...input, value: { value: 1 }, expectedVersion: first.version }, call),
			other.removeJson({ ...input, expectedVersion: first.version as string }, call),
		]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((result) => result.status === "rejected")).toEqual([
			expect.objectContaining({ reason: expect.objectContaining({ code: "ESTATECONFLICT" }) }),
		]);
	});
	it("preserves corrupt documents and symlink targets", async () => {
		await fs.writeFile(join(state, input.path), "{broken");
		await expect(
			ports.removeJson({ ...input, expectedVersion: hash("{broken") }, call),
		).rejects.toMatchObject({ code: "ESTATECORRUPTED" });
		expect(await fs.readFile(join(state, input.path), "utf8")).toBe("{broken");
		await fs.writeFile(join(root, "outside.json"), "{}");
		await fs.symlink(join(root, "outside.json"), join(state, "alias.json"));
		await expect(
			ports.removeJson({ root: "state", path: "alias.json", expectedVersion: hash("{}") }, call),
		).rejects.toThrow("symlinks");
		expect(await fs.readFile(join(root, "outside.json"), "utf8")).toBe("{}");
	});
	it("requires explicit write approval and a live caller before removing anything", async () => {
		const written = await ports.writeJson({ ...input, value: { keep: true }, expectedVersion: null }, call);
		const broker = new PluginCapabilityBroker({ handlers: fileCapabilityHandlers(ports), resources: [] });
		const controller = new AbortController();
		const context = {
			pluginId: "test",
			applicationId: "app",
			callerIdentity: {},
			...call,
			signal: controller.signal,
		};
		const request = () =>
			broker.port.call("state.removeJson", { ...input, expectedVersion: written.version });
		await expect(
			broker.run(
				context,
				"read",
				() => {},
				async () => true,
				request,
			),
		).rejects.toThrow("Read-only");
		await expect(
			broker.run(
				context,
				"write",
				() => {},
				async () => false,
				request,
			),
		).rejects.toThrow("denied");
		await expect(
			broker.run(
				context,
				"write",
				() => {},
				async () => {
					controller.abort(new Error("closed"));
					return true;
				},
				request,
			),
		).rejects.toThrow("closed");
		expect(await ports.readJson(input, call)).toEqual(written);
	});
});
