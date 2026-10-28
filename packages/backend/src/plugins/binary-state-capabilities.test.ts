import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StorageRegistry } from "../storage/registry";
import { fileCapabilityHandlers, type PluginFileCall, PluginFileCapabilities } from "./file-capabilities";
import { PluginCapabilityBroker } from "./runtime-capabilities";

vi.mock("node:fs/promises", async (original) => {
	const actual = await original<typeof import("node:fs/promises")>();
	return {
		...actual,
		writeFile: vi.fn(actual.writeFile),
		open: vi.fn(actual.open),
		rename: vi.fn(actual.rename),
		rm: vi.fn(actual.rm),
	};
});
const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let afterTemporaryWrite: (() => void | Promise<void>) | undefined;
let directory: string,
	state: string,
	cache: string,
	leases: string,
	ports: PluginFileCapabilities,
	controller: AbortController,
	call: PluginFileCall;
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const input = {
	root: "binary",
	path: "ledger.sqlite",
	expectedVersion: null,
	base64: Buffer.from("SQLite test bytes").toString("base64"),
	assertAbsent: ["ledger.sqlite-wal", "ledger.sqlite-shm", "ledger.sqlite-journal"],
};
async function owner(write = true) {
	const registry = new StorageRegistry().register({
		id: "binary-root",
		path: state,
		owner: "synthetic",
		schema: 1,
		sensitivity: "private",
	});
	return PluginFileCapabilities.create(
		[
			{
				handle: "binary",
				path: state,
				kind: "binary-state",
				scope: { kind: "workspace", workspaceId: "workspace" },
				...(write ? { binaryStateWrite: { registry, storageId: "binary-root" } } : {}),
			},
			{
				handle: "json",
				path: state,
				kind: "state",
				scope: { kind: "application" },
				stateWrite: { registry, storageId: "binary-root" },
			},
			{ handle: "files", path: state, kind: "files", scope: { kind: "application" }, fileWrite: true },
		],
		cache,
		leases,
	);
}
beforeEach(async () => {
	vi.mocked(fs.writeFile).mockImplementation(actual.writeFile);
	afterTemporaryWrite = undefined;
	vi.mocked(fs.open).mockImplementation(async (...args) => {
		const file = await actual.open(...args);
		if (String(args[0]).endsWith(".tmp")) {
			const write = file.writeFile.bind(file);
			file.writeFile = async (...data) => {
				await write(...data);
				await afterTemporaryWrite?.();
			};
		}
		return file;
	});
	vi.mocked(fs.rename).mockImplementation(actual.rename);
	vi.mocked(fs.rm).mockImplementation(actual.rm);
	directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "binary-state-")));
	state = join(directory, "state");
	cache = join(directory, "cache");
	leases = join(directory, "leases");
	await fs.mkdir(state);
	await fs.mkdir(cache);
	controller = new AbortController();
	call = {
		scope: { kind: "session", workspaceId: "workspace", workspaceDirectory: directory, sessionId: "creator" },
		bootstrap: false,
		signal: controller.signal,
	};
	ports = await owner();
});
afterEach(async () => {
	vi.restoreAllMocks();
	const result = await Promise.allSettled([ports.drain()]);
	if (result[0]?.status === "fulfilled") ports.releaseReservations();
	await actual.rm(directory, { recursive: true, force: true });
});
async function reserve(path = "") {
	return ports.reserveState({ root: "binary", path }, call);
}
it("reads real bounded bytes and keeps binary/JSON/file handles independent", async () => {
	const bytes = Buffer.alloc(3 * 1024 * 1024, 7);
	await fs.writeFile(join(state, input.path), bytes);
	expect(await ports.readBinary(input, call)).toEqual({
		kind: "value",
		base64: bytes.toString("base64"),
		version: hash(bytes),
	});
	for (const root of ["json", "files"])
		await expect(ports.readBinary({ ...input, root }, call)).rejects.toThrow("not granted");
	await expect(ports.readJson(input, call)).rejects.toThrow("not granted");
	await expect(ports.readText(input, call)).rejects.toThrow("not granted");
	await expect(
		ports.readBinary(input, {
			...call,
			scope: { kind: "session", workspaceId: "other", workspaceDirectory: directory, sessionId: "other" },
		}),
	).rejects.toThrow("another workspace");
});
it("requires an exact writer directory lease, CAS and real readback", async () => {
	await expect(ports.writeBinary(input, call)).rejects.toThrow("not reserved");
	await reserve();
	const first = await ports.writeBinary(input, call);
	expect(first).toMatchObject({
		kind: "value",
		base64: input.base64,
		version: hash(Buffer.from(input.base64, "base64")),
	});
	await expect(ports.writeBinary(input, call)).rejects.toMatchObject({ code: "ESTATECONFLICT" });
	const second = await ports.writeBinary(
		{ ...input, base64: Buffer.from("second").toString("base64"), expectedVersion: first.version },
		call,
	);
	expect(await fs.readFile(join(state, input.path), "utf8")).toBe("second");
	expect(await ports.readBinary(input, call)).toEqual(second);
	await fs.mkdir(join(state, "child"));
	await expect(ports.writeBinary({ ...input, path: "child/ledger.sqlite" }, call)).rejects.toThrow(
		"not reserved",
	);
	await reserve("child");
	expect((await ports.writeBinary({ ...input, path: "child/ledger.sqlite" }, call)).kind).toBe("value");
});
it("rejects a second real owner until successful cleanup releases the same state-writers lease", async () => {
	await reserve();
	const other = await owner();
	try {
		await expect(other.reserveState({ root: "binary", path: "" }, call)).rejects.toThrow("already reserved");
		await ports.drain();
		ports.releaseReservations();
		expect(await other.reserveState({ root: "binary", path: "" }, call)).toEqual({ reserved: true });
	} finally {
		await other.drain();
		other.releaseReservations();
	}
});
it("does not turn a read-only binary selection into writer authority", async () => {
	const readonly = await owner(false);
	try {
		await expect(readonly.reserveState({ root: "binary", path: "" }, call)).rejects.toThrow("not granted");
		await expect(readonly.writeBinary(input, call)).rejects.toThrow("not granted");
	} finally {
		await readonly.drain();
		readonly.releaseReservations();
	}
});
it("rejects WAL and other absence conflicts before creating or replacing target bytes", async () => {
	await reserve();
	await fs.writeFile(join(state, "ledger.sqlite-wal"), "uncheckpointed");
	await expect(ports.writeBinary(input, call)).rejects.toThrow("absent sidecar");
	expect(await fs.readdir(state)).toEqual(["ledger.sqlite-wal"]);
	await fs.rm(join(state, "ledger.sqlite-wal"));
	afterTemporaryWrite = () => actual.writeFile(join(state, "ledger.sqlite-shm"), "late");
	await expect(ports.writeBinary(input, call)).rejects.toThrow("absent sidecar");
	expect(await fs.readdir(state)).toEqual(["ledger.sqlite-shm"]);
});
it("rejects over-limit and noncanonical bytes without changing the original", async () => {
	await fs.writeFile(join(state, input.path), "original");
	await reserve();
	expect(() =>
		ports.writeBinary({ ...input, base64: Buffer.alloc(4 * 1024 * 1024 + 1).toString("base64") }, call),
	).toThrow("4 MiB");
	expect(() => ports.writeBinary({ ...input, base64: "YQ" }, call)).toThrow("canonical");
	await fs.writeFile(join(state, "large.sqlite"), Buffer.alloc(4 * 1024 * 1024 + 1));
	await expect(ports.readBinary({ ...input, path: "large.sqlite" }, call)).rejects.toThrow("4 MiB");
	expect(await fs.readFile(join(state, input.path), "utf8")).toBe("original");
});
it("cancels before commit with unchanged bytes and complete temporary cleanup", async () => {
	await fs.writeFile(join(state, input.path), "original");
	await reserve();
	afterTemporaryWrite = () => controller.abort(new Error("cancel before commit"));
	await expect(ports.writeBinary({ ...input, expectedVersion: hash("original") }, call)).rejects.toThrow(
		"cancel before commit",
	);
	expect(await fs.readFile(join(state, input.path), "utf8")).toBe("original");
	expect(await fs.readdir(state)).toEqual([input.path]);
});
it("reports post-commit cancellation as unknown and permits only fresh-caller read reconciliation", async () => {
	await fs.writeFile(join(state, input.path), "original");
	await reserve();
	vi.mocked(fs.rename).mockImplementation(async (...args) => {
		await actual.rename(...args);
		controller.abort(new Error("cancel after commit"));
	});
	await expect(
		ports.writeBinary({ ...input, expectedVersion: hash("original") }, call),
	).rejects.toMatchObject({ code: "EBINARYWRITEOUTCOMEUNKNOWN" });
	expect(await fs.readFile(join(state, input.path))).toEqual(Buffer.from(input.base64, "base64"));
	await expect(ports.readBinary(input, call)).rejects.toThrow("cancel after commit");
	const fresh = { ...call, signal: new AbortController().signal };
	expect(await ports.readBinary(input, fresh)).toMatchObject({
		kind: "value",
		version: hash(Buffer.from(input.base64, "base64")),
	});
	expect(await fs.readdir(state)).toEqual([input.path]);
});
it("reports committed readback failure as unknown before a fresh verified SHA reconciliation", async () => {
	await fs.writeFile(join(state, input.path), "original");
	await reserve();
	let committed = false;
	vi.mocked(fs.rename).mockImplementation(async (...args) => {
		await actual.rename(...args);
		committed = true;
	});
	const open = vi.mocked(fs.open).getMockImplementation()!;
	vi.mocked(fs.open).mockImplementation(async (...args) => {
		if (committed && String(args[0]) === join(state, input.path))
			throw new Error("synthetic readback unavailable");
		return open(...args);
	});
	await expect(
		ports.writeBinary({ ...input, expectedVersion: hash("original") }, call),
	).rejects.toMatchObject({ code: "EBINARYWRITEOUTCOMEUNKNOWN" });
	committed = false;
	expect(await ports.readBinary(input, call)).toMatchObject({
		kind: "value",
		version: hash(Buffer.from(input.base64, "base64")),
	});
	expect(await fs.readdir(state)).toEqual([input.path]);
});
it("retains the exact directory lease when a temporary parent is replaced before commit", async () => {
	await fs.mkdir(join(state, "child"));
	await reserve("child");
	afterTemporaryWrite = async () => {
		await actual.rename(join(state, "child"), join(state, "original-child"));
		await fs.mkdir(join(state, "child"));
	};
	await expect(
		ports.writeBinary({ ...input, path: "child/ledger.sqlite", assertAbsent: [] }, call),
	).rejects.toThrow("temporary cleanup failed");
	await expect(ports.drain()).rejects.toThrow("reservations retained");
	expect(await fs.readdir(join(state, "child"))).toEqual([]);
	expect(
		(await fs.readdir(join(state, "original-child"))).filter((name) => name.endsWith(".tmp")),
	).toHaveLength(1);
});

it("retains the real lease when temporary cleanup fails after commit", async () => {
	await reserve();
	vi.mocked(fs.rm).mockImplementation(async (path, options) => {
		if (String(path).endsWith(".tmp")) throw new Error("synthetic cleanup failure");
		return actual.rm(path, options);
	});
	await expect(ports.writeBinary(input, call)).rejects.toMatchObject({ code: "EBINARYWRITEOUTCOMEUNKNOWN" });
	await expect(ports.drain()).rejects.toThrow("reservations retained");
	const other = await owner();
	try {
		await expect(other.reserveState({ root: "binary", path: "" }, call)).rejects.toThrow("already reserved");
	} finally {
		await other.drain();
		other.releaseReservations();
	}
});
it("checks actual lock token ownership immediately before writing", async () => {
	await reserve();
	const path = join(leases, "state-writers", `${hash(state)}.lock`),
		token = await fs.readFile(path);
	await fs.writeFile(path, "changed owner");
	await expect(ports.writeBinary(input, call)).rejects.toThrow("ownership changed");
	expect(await fs.readdir(state)).toEqual([]);
	await fs.writeFile(path, token);
});
it("validates canonical base64 and bounded conditions at the broker boundary", async () => {
	const broker = new PluginCapabilityBroker({ resources: [], handlers: fileCapabilityHandlers(ports) });
	const context = { ...call, pluginId: "synthetic", applicationId: "app", callerIdentity: {} };
	for (const change of [
		{ base64: "YQ" },
		{ assertAbsent: Array(9).fill("sidecar") },
		{ assertAbsent: ["same", "same"] },
		{ root: "x".repeat(129) },
		{ sessionId: "forged" },
	])
		await expect(
			broker.run(
				context,
				"write",
				() => {},
				async () => true,
				() => broker.port.call("state.writeBinary", { ...input, ...change }),
			),
		).rejects.toThrow("Invalid plugin capability input");
});

const runtimeDirectory = resolve(
	process.env.DRONE_PLUGIN_RUNTIME_DIRECTORY ??
		join(import.meta.dirname, "../../../desktop/plugin-runtime", `${process.platform}-${process.arch}`),
);
it.skipIf(!existsSync(join(runtimeDirectory, "runtime.json")))(
	"moves a 3 MiB payload through a real ordinary worker and the production binary broker",
	async () => {
		const { createProcessPluginRuntime } = await import("./process-runtime");
		const { PluginRuntimeRegistry } = await import("./runtime");
		const packageRoot = join(directory, "installed");
		await fs.mkdir(packageRoot);
		const entrypoint = join(packageRoot, "runtime.mjs");
		await fs.writeFile(
			entrypoint,
			`export default async()=>({operations:{persist:{inputSchema:{type:'null'},resultSchema:{type:'object'},effect:'write',execute:async(_,{capabilities})=>{await capabilities.call('state.reserve',{root:'binary',path:''});const base64=Buffer.alloc(3*1024*1024,31).toString('base64');const stored=await capabilities.call('state.writeBinary',{root:'binary',path:'large.sqlite',base64,expectedVersion:null,assertAbsent:[]});const read=await capabilities.call('state.readBinary',{root:'binary',path:'large.sqlite'});return {storedVersion:stored.version,readVersion:read.version,bytes:Buffer.from(read.base64,'base64').length,sqliteDisabled:process.execArgv.includes('--no-experimental-sqlite')};}}},dispose:async()=>{}});`,
		);
		const identity = {};
		const registry = new PluginRuntimeRegistry(
			{ authorizeActivation: async () => true, authorizeInvocation: async () => true },
			"actual-app",
			{
				resources: [{ handle: "binary", kind: "binary-state", access: "read-write" }],
				handlers: fileCapabilityHandlers(ports),
			},
		);
		registry.register(
			"binary-candidate",
			createProcessPluginRuntime({ pluginId: "binary-candidate", packageRoot, entrypoint, runtimeDirectory }),
		);
		const client = await registry.activate("binary-candidate", () => ({
			scope: call.scope,
			identity,
			signal: call.signal,
		}));
		try {
			const result = await client.invoke("persist", null);
			expect(result).toEqual({
				storedVersion: hash(Buffer.alloc(3 * 1024 * 1024, 31)),
				readVersion: hash(Buffer.alloc(3 * 1024 * 1024, 31)),
				bytes: 3 * 1024 * 1024,
				sqliteDisabled: true,
			});
			expect((await fs.readFile(join(state, "large.sqlite"))).length).toBe(3 * 1024 * 1024);
		} finally {
			await registry.deactivate("binary-candidate");
		}
	},
	30000,
);
