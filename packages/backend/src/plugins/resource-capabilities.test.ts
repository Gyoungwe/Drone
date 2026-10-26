import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileCapabilityHandlers, PluginFileCapabilities } from "./file-capabilities";
import { createProcessPluginRuntime } from "./process-runtime";
import { PluginResourceManager } from "./resource-capabilities";
import { PluginRuntimeRegistry } from "./runtime";
import type { PluginCapabilityContext } from "./runtime-capabilities";

const runtimeDirectory = resolve(
	import.meta.dirname,
	"../../../desktop/plugin-runtime",
	`${process.platform}-${process.arch}`,
);
const available = existsSync(join(runtimeDirectory, "runtime.json"));
let root: string;
let vault: string;
let source: string;
let state: string;
let cache: string;
let files: PluginFileCapabilities;
const managers: PluginResourceManager[] = [];
let context: PluginCapabilityContext;

const resourceSource = `import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export default async ({storageDirectory,parameters,capabilities})=>{
 await writeFile(join(storageDirectory,'pid.txt'),String(process.pid));
 const db=new DatabaseSync(join(storageDirectory,'index.sqlite'));
 db.exec('CREATE TABLE IF NOT EXISTS counter(value INTEGER); INSERT INTO counter VALUES(1)');
 try { await capabilities.call('files.readText',{root:parameters.root,path:parameters.path}); }
 catch(error) {db.close();throw error;}
 return {async invoke(operation,input){
  if(operation==='read'){ const file=await capabilities.call('files.readText',{root:parameters.root,path:parameters.path});return {pid:process.pid,text:file.text,count:db.prepare('SELECT count(*) AS n FROM counter').get().n}; }
  if(operation==='outside'){try{await readFile(input.path);return 'unexpected access';}catch(error){return error.code;}}
  if(operation==='outsideWrite'){try{await writeFile(input.path,'unexpected access');return 'unexpected access';}catch(error){return error.code;}}
  if(operation==='crash') process.exit(3);
  throw new Error('Unknown resource request');
 }, async dispose(){db.close();}};
};`;

function caller(workspaceId = "workspace-a"): PluginCapabilityContext {
	const handlers = fileCapabilityHandlers(files);
	const call: PluginCapabilityContext = {
		pluginId: "example",
		applicationId: "application",
		scope: {
			kind: "session",
			workspaceId,
			workspaceDirectory: "/Work/Resources",
			sessionId: `session-${workspaceId}`,
		},
		callerIdentity: {},
		signal: new AbortController().signal,
		bootstrap: false,
		capabilities: {
			call: async (name, input) => {
				const handler = handlers[name];
				if (!handler) throw new Error("Unregistered test capability");
				return handler.execute(input, call);
			},
		},
	};
	return call;
}
function manager(signal = new AbortController().signal): PluginResourceManager {
	const value = new PluginResourceManager({
		pluginId: "example",
		applicationId: "application",
		packageRoot: source,
		entries: { index: join(source, "resource.mjs"), other: join(source, "resource.mjs") },
		runtimeDirectory,
		files,
		signal,
		events: { changed() {} },
		leaseDirectory: join(root, "leases"),
	});
	managers.push(value);
	return value;
}
function input(path = "note.md", key = "notes", resource = "index") {
	return {
		resource,
		storage: { root: "state", key },
		parameters: { root: "vault", path },
		reservation: {
			namespace: "test-writers",
			roots: [{ root: "vault", path: "", kind: "vault" }],
			storage: { path: "index.sqlite", kind: "index" },
		},
	};
}
function exited(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
		throw error;
	}
}

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-resource-manager-")));
	vault = join(root, "vault");
	source = join(root, "package");
	state = join(root, "state");
	cache = join(root, "private-cache");
	await Promise.all([vault, source, state, cache].map((path) => mkdir(path)));
	await writeFile(join(vault, "note.md"), "real indexed input");
	await writeFile(join(source, "resource.mjs"), resourceSource);
	files = await PluginFileCapabilities.create(
		[
			{
				handle: "vault",
				path: vault,
				kind: "files",
				scope: { kind: "workspace", workspaceId: "workspace-a" },
			},
			{ handle: "state", path: state, kind: "state", scope: { kind: "application" } },
		],
		cache,
	);
	context = caller();
});
afterEach(async () => {
	await Promise.allSettled(managers.splice(0).map((value) => value.dispose()));
	await rm(root, { recursive: true, force: true });
});

describe.skipIf(!available)("actual isolated resource process", () => {
	it("reuses one real SQLite resource and keeps root access behind the caller broker", async () => {
		const owner = manager();
		const [a, b] = await Promise.all([owner.create(input(), context), owner.create(input(), context)]);
		expect(a.handle).toBe(b.handle);
		const result = (await owner.invoke({ handle: a.handle, operation: "read", input: null }, context)) as {
			pid: number;
			text: string;
			count: number;
		};
		expect(result).toEqual({ pid: expect.any(Number), text: "real indexed input", count: 1 });
		expect(
			await owner.invoke(
				{ handle: a.handle, operation: "outside", input: { path: join(vault, "note.md") } },
				context,
			),
		).toBe("ERR_ACCESS_DENIED");
		expect(
			await owner.invoke(
				{ handle: a.handle, operation: "outsideWrite", input: { path: join(state, "forbidden.txt") } },
				context,
			),
		).toBe("ERR_ACCESS_DENIED");
		await expect(
			owner.invoke({ handle: a.handle, operation: "read", input: null }, caller("workspace-b")),
		).rejects.toThrow("another workspace");
		await Promise.all([owner.close(a, context), owner.close(a, context)]);
		expect(exited(result.pid)).toBe(true);
	});

	it("rejects a second writer even inside one owner, and retains reservations after a child closes", async () => {
		const owner = manager(),
			other = manager();
		const handle = await owner.create(input(), context);
		await expect(owner.create(input("note.md", "second", "other"), context)).rejects.toThrow("already holds");
		await expect(other.create(input(), context)).rejects.toThrow("already reserved");
		await owner.close(handle, context);
		await expect(other.create(input(), context)).rejects.toThrow("already reserved");
		await owner.dispose();
		const restored = await other.create(input(), context);
		expect(await other.invoke({ ...restored, operation: "read", input: null }, context)).toMatchObject({
			text: "real indexed input",
		});
	});

	it("confirms a failed startup process has exited before retrying the same resource", async () => {
		const owner = manager();
		await expect(owner.create(input("later.md"), context)).rejects.toThrow("ENOENT");
		const directories = await readdir(cache);
		const pid = Number(await readFile(join(cache, directories[0]!, "pid.txt"), "utf8"));
		expect(exited(pid)).toBe(true);
		await writeFile(join(vault, "later.md"), "repaired input");
		const repaired = await owner.create(input("later.md"), context);
		const result = (await owner.invoke({ ...repaired, operation: "read", input: null }, context)) as {
			pid: number;
			text: string;
		};
		expect(result.pid).not.toBe(pid);
		expect(result.text).toBe("repaired input");
	});

	it("holds the reservation through worker failure and reports failed cleanup", async () => {
		const owner = manager(),
			other = manager();
		const handle = await owner.create(input(), context);
		await expect(owner.invoke({ ...handle, operation: "crash", input: null }, context)).rejects.toThrow(
			"exited",
		);
		await expect(other.create(input(), context)).rejects.toThrow("already reserved");
		await expect(owner.dispose()).rejects.toThrow("Plugin resource disposal failed");
		const reopened = await other.create(input(), context);
		expect(await other.invoke({ ...reopened, operation: "read", input: null }, context)).toMatchObject({
			text: "real indexed input",
		});
	});
	it("drains accepted resource work before closing and rejects overlapping reopen", async () => {
		const owner = manager();
		const handle = await owner.create(input(), context);
		let started!: () => void, release!: () => void;
		const waiting = new Promise<void>((resolve) => {
			started = resolve;
		});
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const slow: PluginCapabilityContext = {
			...context,
			capabilities: {
				call: async (name, input) => {
					started();
					await held;
					return context.capabilities.call(name, input);
				},
			},
		};
		const running = owner.invoke({ ...handle, operation: "read", input: null }, slow);
		await waiting;
		const closing = owner.close(handle, context);
		try {
			await expect(owner.create(input(), context)).rejects.toThrow("closing");
			await expect(owner.invoke({ ...handle, operation: "read", input: null }, context)).rejects.toThrow(
				"closing",
			);
		} finally {
			release();
		}
		const result = (await running) as { pid: number };
		await closing;
		expect(exited(result.pid)).toBe(true);
	});
	it("drains a real owner and SQLite child before releasing the final activation lease", async () => {
		const entrypoint = join(source, "owner.mjs");
		await writeFile(
			entrypoint,
			`export default async ({capabilities,resourcesLifecycle})=>({
 operations:{open:{inputSchema:{type:"null"},resultSchema:{type:"object"},effect:"read",async execute(){
  const resource=await capabilities.call('resource.create',${JSON.stringify(input())});
  const result=await capabilities.call('resource.invoke',{...resource,operation:'read',input:null});
  return {ownerPid:process.pid,childPid:result.pid};
 }}},async dispose(){await resourcesLifecycle.dispose();}
});`,
		);
		const other = manager();
		let childPid = 0,
			confirmedWhileReserved = false,
			finalReleased = false;
		const registry = new PluginRuntimeRegistry(
			{ authorizeActivation: async () => true, authorizeInvocation: async () => true },
			"application",
			({ signal }) => {
				const resources = manager(signal);
				return {
					resources: [{ handle: "state", kind: "state" }],
					handlers: { ...fileCapabilityHandlers(files), ...resources.handlers() },
					resourcesLifecycle: {
						dispose: async () => {
							await resources.disposeResources();
							expect(exited(childPid)).toBe(true);
							await expect(other.create(input(), context)).rejects.toThrow("already reserved");
							confirmedWhileReserved = true;
						},
					},
					dispose: async () => {
						await resources.dispose();
						finalReleased = true;
					},
				};
			},
		);
		registry.register(
			"example",
			createProcessPluginRuntime({ pluginId: "example", packageRoot: source, entrypoint, runtimeDirectory }),
		);
		const caller = { identity: {}, scope: context.scope, signal: context.signal };
		const client = await registry.activate("example", () => caller);
		const result = (await client.invoke("open", null)) as { ownerPid: number; childPid: number };
		childPid = result.childPid;
		expect(exited(result.ownerPid)).toBe(false);
		expect(exited(childPid)).toBe(false);
		await registry.deactivate("example");
		expect(confirmedWhileReserved).toBe(true);
		expect(finalReleased).toBe(true);
		expect(exited(result.ownerPid)).toBe(true);
		expect(await other.create(input(), context)).toHaveProperty("handle");
	});

	it("closes all activation resources without releasing the domain reservation", async () => {
		const owner = manager(),
			other = manager();
		const handle = await owner.create(input(), context);
		const result = (await owner.invoke({ ...handle, operation: "read", input: null }, context)) as {
			pid: number;
		};
		await owner.disposeResources();
		expect(exited(result.pid)).toBe(true);
		await expect(owner.create(input(), context)).rejects.toThrow("stopping");
		await expect(other.create(input(), context)).rejects.toThrow("already reserved");
		await owner.dispose();
		expect(await other.create(input(), context)).toHaveProperty("handle");
	});

	it("lets a fresh caller retry the actual close receipt after the first caller is canceled", async () => {
		const owner = manager();
		const handle = await owner.create(input(), context);
		const { pid } = (await owner.invoke({ ...handle, operation: "read", input: null }, context)) as {
			pid: number;
		};
		const canceled = new AbortController();
		const closing = owner.close(handle, { ...context, signal: canceled.signal });
		canceled.abort(new Error("selection changed"));
		await expect(closing).rejects.toThrow("selection changed");
		expect(exited(pid)).toBe(true);
		expect(await owner.close(handle, context)).toBeNull();
		await expect(owner.close({ handle: "not-owned" }, context)).rejects.toThrow("not granted");
		await expect(manager().close(handle, context)).rejects.toThrow("not granted");
		const next = await owner.create(input(), context);
		expect(next.handle).not.toBe(handle.handle);
	});

	it("reclaims an actual resource whose late canceled creation did not return a handle", async () => {
		const owner = manager(),
			other = manager();
		const canceled = new AbortController();
		const late = {
			...context,
			signal: canceled.signal,
			capabilities: {
				call: async (name: string, value: unknown) => {
					const result = await context.capabilities.call(name, value);
					canceled.abort(new Error("caller left after resource initialization"));
					return result;
				},
			},
		};
		await expect(owner.create(input(), late)).rejects.toThrow("caller left");
		const [directory] = await readdir(cache);
		const pid = Number(await readFile(join(cache, directory!, "pid.txt"), "utf8"));
		expect(exited(pid)).toBe(false);
		await owner.disposeResources();
		expect(exited(pid)).toBe(true);
		await expect(other.create(input(), context)).rejects.toThrow("already reserved");
		await owner.dispose();
		expect(await other.create(input(), context)).toHaveProperty("handle");
	});

	it("waits for pending startup before activation cleanup reports the real child exit", async () => {
		const owner = manager();
		let entered!: () => void, release!: () => void;
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const initializing = owner.create(input(), {
			...context,
			capabilities: {
				call: async (name, value) => {
					entered();
					await held;
					return context.capabilities.call(name, value);
				},
			},
		});
		const rejected = expect(initializing).rejects.toThrow("stopping");
		await started;
		let settled = false;
		const closing = owner.disposeResources().then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		release();
		await rejected;
		await closing;
		const [directory] = await readdir(cache);
		const pid = Number(await readFile(join(cache, directory!, "pid.txt"), "utf8"));
		expect(exited(pid)).toBe(true);
	});
});
