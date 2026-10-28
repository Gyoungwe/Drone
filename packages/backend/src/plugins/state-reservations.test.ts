import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StorageRegistry } from "../storage/registry";
import { type PluginFileCall, PluginFileCapabilities } from "./file-capabilities";

let root: string;
let state: string;
let cache: string;
let leases: string;
const ports: PluginFileCapabilities[] = [];
const call: PluginFileCall = {
	scope: { kind: "workspace", workspaceId: "workspace", workspaceDirectory: "/Work/Scope" },
	signal: new AbortController().signal,
	bootstrap: false,
};
async function files(write = true) {
	const registry = new StorageRegistry();
	const entry = registry.registerDiscoveredRoot("test-state", state, "test", "private");
	const value = await PluginFileCapabilities.create(
		[
			{
				handle: "state",
				path: state,
				kind: "state",
				scope: { kind: "workspace", workspaceId: "workspace" },
				...(write ? { stateWrite: { registry, storageId: entry.id } } : {}),
			},
		],
		cache,
		leases,
	);
	ports.push(value);
	return value;
}
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-state-reserve-")));
	state = join(root, "state");
	cache = join(root, "cache");
	leases = join(root, "leases");
	await Promise.all([mkdir(state), mkdir(cache)]);
});
afterEach(async () => {
	for (const port of ports.splice(0)) port.releaseReservations();
	await rm(root, { recursive: true, force: true });
});

it("reserves one existing directory across independent ports and only releases on final disposal", async () => {
	const a = await files(),
		b = await files();
	expect(await a.reserveState({ root: "state", path: "" }, call)).toEqual({ reserved: true });
	expect(await a.reserveState({ root: "state", path: "" }, call)).toEqual({ reserved: true });
	await expect(b.reserveState({ root: "state", path: "" }, call)).rejects.toThrow("already reserved");
	a.releaseReservations();
	expect(await b.reserveState({ root: "state", path: "" }, call)).toEqual({ reserved: true });
});

it("requires a state write grant and an existing directory without symlink traversal", async () => {
	const readonly = await files(false),
		writable = await files();
	await expect(readonly.reserveState({ root: "state", path: "" }, call)).rejects.toThrow(
		"writer access was not granted",
	);
	await writeFile(join(state, "file.json"), "{}");
	await expect(writable.reserveState({ root: "state", path: "file.json" }, call)).rejects.toThrow(
		"existing directory",
	);
	await expect(writable.reserveState({ root: "state", path: "missing" }, call)).rejects.toMatchObject({
		code: "ENOENT",
	});
	await symlink(state, join(state, "alias"));
	await expect(writable.reserveState({ root: "state", path: "alias" }, call)).rejects.toThrow("symlink");
	await expect(
		writable.reserveState({ root: "state", path: "" }, { ...call, scope: { kind: "application" } }),
	).rejects.toThrow("another workspace");
	expect(await writable.describeRoots({ ...call, scope: { kind: "application" } })).toEqual([]);
	expect(await writable.describeRoots(call)).toEqual([
		{ handle: "state", kind: "state", path: state, access: "read-write" },
	]);
});

it("shares the exact reservation implementation with an independent Node process", async () => {
	const managed = await files();
	await managed.reserveState({ root: "state", path: "" }, call);
	const helper = pathToFileURL(
		createRequire(import.meta.url).resolve("@gyoungwe/plugin-api/node/reservations"),
	).href;
	const run = () =>
		new Promise<{ code: number | null; output: string }>((resolve, reject) => {
			const child = spawn(
				process.execPath,
				[
					"--input-type=module",
					"-e",
					`import {PluginResourceReservations} from ${JSON.stringify(helper)};const owner=new PluginResourceReservations(${JSON.stringify(leases)});try{owner.reserve('state-writers',[${JSON.stringify(state)}]);console.log('acquired');owner.dispose();}catch(error){console.error(error.message);process.exitCode=2;}`,
				],
				{ stdio: ["ignore", "pipe", "pipe"] },
			);
			let output = "";
			child.stdout.on("data", (chunk) => {
				output += chunk;
			});
			child.stderr.on("data", (chunk) => {
				output += chunk;
			});
			child.on("error", reject);
			child.on("close", (code) => resolve({ code, output }));
		});
	expect(await run()).toMatchObject({ code: 2, output: expect.stringContaining("already reserved") });
	managed.releaseReservations();
	expect(await run()).toMatchObject({ code: 0, output: "acquired\n" });
});

it("retains the state writer after a real atomic-write temporary cleanup failure", async () => {
	const owner = await files(),
		other = await files();
	await owner.reserveState({ root: "state", path: "" }, call);
	const read = owner.readJson.bind(owner);
	let reads = 0;
	const observer = vi.spyOn(owner, "readJson").mockImplementation(async (...args) => {
		const result = await read(...args);
		if (++reads === 2) {
			await chmod(state, 0o500);
			throw new Error("synthetic write permission revoked before commit");
		}
		return result;
	});
	try {
		await expect(
			owner.writeJson(
				{ root: "state", path: "write.json", value: { revision: 1 }, expectedVersion: null },
				call,
			),
		).rejects.toBeInstanceOf(AggregateError);
	} finally {
		observer.mockRestore();
		await chmod(state, 0o700);
	}
	await expect(owner.drain()).rejects.toThrow("cleanup failed");
	expect(() => owner.releaseReservations()).toThrow("cleanup failed");
	await expect(other.reserveState({ root: "state", path: "" }, call)).rejects.toThrow("already reserved");
	// Expected failed owner cannot release its lease. Only this test's owned directory is removed by afterEach.
	ports.splice(ports.indexOf(owner), 1);
});
