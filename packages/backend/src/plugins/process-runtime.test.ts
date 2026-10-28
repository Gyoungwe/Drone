import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PluginRuntimeScope } from "@gyoungwe/plugin-api/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProcessPluginRuntime } from "./process-runtime";
import { PluginRuntimeRegistry } from "./runtime";

const runtimeDirectory = resolve(
	import.meta.dirname,
	"../../../desktop/plugin-runtime",
	`${process.platform}-${process.arch}`,
);
const hasRuntime = existsSync(join(runtimeDirectory, "runtime.json"));
const roots: string[] = [];
function caller(scope: PluginRuntimeScope) {
	const value = { identity: {}, scope, signal: new AbortController().signal };
	return () => value;
}

const scope = {
	kind: "session" as const,
	workspaceId: "workspace",
	workspaceDirectory: "/Work/One",
	sessionId: "session",
};
const allow = { authorizeActivation: async () => true, authorizeInvocation: async () => true };

async function fixture(source: string) {
	const root = await mkdtemp(join(tmpdir(), "drone-runtime-process-"));
	roots.push(root);
	const entrypoint = join(root, "runtime.mjs");
	await writeFile(entrypoint, source);
	return { pluginId: "example", packageRoot: root, entrypoint, runtimeDirectory };
}

afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("denies activation without starting or resolving plugin code", async () => {
	const registry = new PluginRuntimeRegistry({ ...allow, authorizeActivation: async () => false });
	registry.register(
		"example",
		createProcessPluginRuntime({
			pluginId: "example",
			packageRoot: "/missing",
			entrypoint: "/missing/runtime.mjs",
		}),
	);
	await expect(registry.activate("example", caller(scope))).rejects.toThrow("activation denied");
});

describe.skipIf(!hasRuntime)("packaged process desktop runtime", () => {
	it("delivers the owned resource cleanup receipt without a live invocation after cancellation", async () => {
		const options = await fixture(`export default async ({signal,resourcesLifecycle})=>({
 operations:{probe:{inputSchema:{type:"null"},resultSchema:{type:"number"},effect:"read",execute:async()=>process.pid}},
 async dispose(){if(!signal.aborted)throw new Error('expected deactivation');await resourcesLifecycle.dispose();}
});`);
		let finish!: () => void;
		const held = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const resourceStop = vi.fn(() => held);
		const releaseLeases = vi.fn(async () => {});
		const registry = new PluginRuntimeRegistry(allow, "lifecycle-test", {
			resources: [],
			handlers: {},
			resourcesLifecycle: { dispose: resourceStop },
			dispose: releaseLeases,
		});
		registry.register("example", createProcessPluginRuntime(options));
		const client = await registry.activate("example", caller(scope));
		const pid = (await client.invoke("probe", null)) as number;
		const closed = registry.deactivate("example");
		await vi.waitFor(() => expect(resourceStop).toHaveBeenCalledOnce());
		await new Promise((resolve) => setTimeout(resolve, 650));
		expect(releaseLeases).not.toHaveBeenCalled();
		expect(() => process.kill(pid, 0)).not.toThrow();
		finish();
		await closed;
		expect(releaseLeases).toHaveBeenCalledOnce();
		expect(() => process.kill(pid, 0)).toThrow();
	});

	it("reports resource cleanup failure while still exiting the owner and releasing final host ports", async () => {
		const options = await fixture(
			`export default async ({resourcesLifecycle})=>({operations:{},async dispose(){await resourcesLifecycle.dispose();}});`,
		);
		const releaseLeases = vi.fn(async () => {});
		const registry = new PluginRuntimeRegistry(allow, "lifecycle-failure", {
			resources: [],
			handlers: {},
			resourcesLifecycle: {
				dispose: async () => {
					throw new Error("resource exit failed");
				},
			},
			dispose: releaseLeases,
		});
		registry.register("example", createProcessPluginRuntime(options));
		await registry.activate("example", caller(scope));
		await expect(registry.deactivate("example")).rejects.toThrow("resource exit failed");
		expect(releaseLeases).toHaveBeenCalledOnce();
	});

	it("resource mode writes only host-selected derived storage and preserves capability error codes", async () => {
		const options = await fixture(`import fs from 'node:fs';import{join}from'node:path';
export default async ({storageDirectory,parameters,capabilities}) => ({
 async invoke(){fs.writeFileSync(join(storageDirectory,'cache.txt'),'derived');let denied=false,code;
 try{fs.readFileSync(parameters.outside,'utf8');}catch(error){denied=error.code==='ERR_ACCESS_DENIED';}
 try{await capabilities.call('missing',null);}catch(error){code=error.code;}
 return {pid:process.pid,denied,code};},async dispose(){}
});`);
		const storageDirectory = join(options.packageRoot, "cache");
		await mkdir(storageDirectory);
		const outside = await mkdtemp(join(tmpdir(), "drone-resource-outside-"));
		roots.push(outside);
		const path = join(outside, "synthetic.txt");
		await writeFile(path, "synthetic outside");
		const registry = new PluginRuntimeRegistry(allow, "resource-test", {
			resources: [],
			handlers: {
				missing: {
					inputSchema: { type: "null" },
					resultSchema: {},
					effect: "read",
					execute: async () => {
						throw Object.assign(new Error("synthetic missing"), { code: "ENOENT" });
					},
				},
			},
		});
		registry.register(
			"example",
			createProcessPluginRuntime({
				...options,
				resource: { storageDirectory, parameters: { outside: path } },
			}),
		);
		const client = await registry.activate("example", caller(scope));
		const receipt = (await client.invoke("request", { operation: "check", input: null })) as {
			pid: number;
			denied: boolean;
			code: string;
		};
		expect(receipt).toMatchObject({ denied: true, code: "ENOENT" });
		expect(await readFile(join(storageDirectory, "cache.txt"), "utf8")).toBe("derived");
		await registry.deactivate("example");
		expect(() => process.kill(receipt.pid, 0)).toThrow();
	});

	it("cancels a worker-local capability during approval and never accepts a late approval", async () => {
		const options = await fixture(
			`export default async()=>({operations:{run:{inputSchema:{type:"null"},resultSchema:{type:"string"},effect:"write",async execute(_,{capabilities}){const abort=new AbortController();const timer=setTimeout(()=>abort.abort(new Error('local timeout')),30);try{return await capabilities.call('execute',null,abort.signal);}finally{clearTimeout(timer);}}}},dispose:async()=>{}});`,
		);
		let approve!: (allowed: boolean) => void;
		const asked = vi.fn(
			() =>
				new Promise<boolean>((resolve) => {
					approve = resolve;
				}),
		);
		const execute = vi.fn(async () => "accepted");
		const registry = new PluginRuntimeRegistry(
			{
				...allow,
				authorizeInvocation: async (request) => (request.operation === "capability:execute" ? asked() : true),
			},
			"app",
			{
				resources: [],
				handlers: {
					execute: {
						inputSchema: { type: "null" },
						resultSchema: { type: "string" },
						effect: "write",
						execute,
					},
				},
			},
		);
		registry.register("example", createProcessPluginRuntime(options));
		const client = await registry.activate("example", caller(scope));
		await expect(client.invoke("run", null)).rejects.toThrow();
		expect(asked).toHaveBeenCalledOnce();
		approve(true);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(execute).not.toHaveBeenCalled();
		await registry.deactivate("example");
	});

	it("waits beyond the guest shutdown limit for an accepted host capability's actual owned cleanup", async () => {
		const options = await fixture(
			`export default async()=>({operations:{run:{inputSchema:{type:"null"},resultSchema:{type:"string"},effect:"write",async execute(_,{capabilities}){const abort=new AbortController();const timer=setTimeout(()=>abort.abort(new Error('local timeout')),30);try{return await capabilities.call('execute',null,abort.signal);}finally{clearTimeout(timer);}}}},dispose:async()=>{}});`,
		);
		let finish!: () => void;
		const cleanup = new Promise<void>((resolve) => {
			finish = resolve;
		});
		let accepted = false,
			canceled = false,
			released = false;
		const registry = new PluginRuntimeRegistry(allow, "app", {
			resources: [],
			handlers: {
				execute: {
					inputSchema: { type: "null" },
					resultSchema: { type: "string" },
					effect: "write",
					async execute(_, context) {
						accepted = true;
						await new Promise<void>((resolve) =>
							context.signal.addEventListener(
								"abort",
								() => {
									canceled = true;
									resolve();
								},
								{ once: true },
							),
						);
						await cleanup;
						return "terminal-after-cleanup";
					},
				},
			},
			finalRelease: async () => {
				released = true;
			},
		});
		registry.register("example", createProcessPluginRuntime(options));
		const client = await registry.activate("example", caller(scope));
		const call = client.invoke("run", null);
		const rejected = expect(call).rejects.toThrow();
		await vi.waitFor(() => expect(accepted && canceled).toBe(true));
		let stopped = false;
		const stopping = registry.deactivate("example").then(() => {
			stopped = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 650));
		expect(stopped).toBe(false);
		expect(released).toBe(false);
		finish();
		await stopping;
		await rejected;
		expect(released).toBe(true);
	});

	it("aborts and drains actual host cleanup after unexpected child exit before rejecting the parent or releasing leases", async () => {
		const options = await fixture(
			`export default async()=>({operations:{run:{inputSchema:{type:"null"},resultSchema:{type:"string"},effect:"write",async execute(_,{capabilities}){const result=capabilities.call('execute',null);setTimeout(()=>process.exit(9),50);return result;}}},dispose:async()=>{}});`,
		);
		let finish!: () => void;
		const cleanup = new Promise<void>((resolve) => {
			finish = resolve;
		});
		let hostAborted = false,
			callerSettled = false;
		const release = vi.fn(async () => {});
		const registry = new PluginRuntimeRegistry(allow, "app", {
			resources: [],
			finalRelease: release,
			handlers: {
				execute: {
					inputSchema: { type: "null" },
					resultSchema: { type: "string" },
					effect: "write",
					async execute(_, context) {
						await new Promise<void>((resolve) =>
							context.signal.addEventListener(
								"abort",
								() => {
									hostAborted = true;
									resolve();
								},
								{ once: true },
							),
						);
						await cleanup;
						return "cleaned";
					},
				},
			},
		});
		registry.register("example", createProcessPluginRuntime(options));
		const client = await registry.activate("example", caller(scope));
		const invocation = client.invoke("run", null);
		const failed = expect(invocation).rejects.toThrow("exited (9)");
		void invocation.then(
			() => {
				callerSettled = true;
			},
			() => {
				callerSettled = true;
			},
		);
		await vi.waitFor(() => expect(hostAborted).toBe(true));
		expect(callerSettled).toBe(false);
		expect(release).not.toHaveBeenCalled();
		finish();
		await failed;
		await expect(registry.deactivate("example")).rejects.toThrow("exited (9)");
		expect(release).not.toHaveBeenCalled();
	});

	it("binds local cancellation to its parent invocation while another session's host capability remains live", async () => {
		const options = await fixture(
			`export default async()=>({operations:{run:{inputSchema:{type:"boolean"},resultSchema:{type:"string"},effect:"write",async execute(cancel,{capabilities}){const abort=new AbortController();const timer=cancel?setTimeout(()=>abort.abort(new Error('only A')),30):undefined;try{return await capabilities.call('execute',null,abort.signal);}finally{clearTimeout(timer);}}}},dispose:async()=>{}});`,
		);
		const active = new Map<string, { signal: AbortSignal; finish: () => void }>();
		const registry = new PluginRuntimeRegistry(allow, "app", {
			resources: [],
			handlers: {
				execute: {
					inputSchema: { type: "null" },
					resultSchema: { type: "string" },
					effect: "write",
					async execute(_, context) {
						if (context.scope.kind !== "session") throw new Error("Expected actual session");
						const sessionId = context.scope.sessionId;
						await new Promise<void>((resolve) =>
							active.set(sessionId, { signal: context.signal, finish: resolve }),
						);
						return "finished";
					},
				},
			},
		});
		registry.register("example", createProcessPluginRuntime(options));
		const a = await registry.activate("example", caller(scope));
		const b = await registry.activate("example", caller({ ...scope, sessionId: "other-session" }));
		const first = a.invoke("run", true),
			second = b.invoke("run", false);
		const rejected = expect(first).rejects.toThrow("locally canceled");
		await vi.waitFor(() => expect(active.size).toBe(2));
		await vi.waitFor(() => expect(active.get(scope.sessionId)?.signal.aborted).toBe(true));
		expect(active.get("other-session")?.signal.aborted).toBe(false);
		active.get(scope.sessionId)!.finish();
		await rejected;
		expect(active.get("other-session")?.signal.aborted).toBe(false);
		active.get("other-session")!.finish();
		expect(await second).toBe("finished");
		await registry.deactivate("example");
	});

	it("brokers bootstrap and per-call reads with actual caller authority and payload-free events", async () => {
		const options = await fixture(`export default async ({capabilities,events,resources}) => {
 const initial=await capabilities.call("state",null);
 return {operations:{read:{inputSchema:{type:"null"},resultSchema:{type:"object"},effect:"read",execute:async()=>{const scope=await capabilities.call("scope",null);events.changed();return {initial,scope,resources};}}},dispose:async()=>{}};
};`);
		const registry = new PluginRuntimeRegistry(allow, "application", {
			resources: [{ handle: "opaque", kind: "state" }],
			handlers: {
				state: {
					inputSchema: { type: "null" },
					resultSchema: { type: "string" },
					effect: "read",
					bootstrap: true,
					execute: async (_input, ctx) => (ctx.bootstrap ? "approved-state" : "wrong"),
				},
				scope: {
					inputSchema: { type: "null" },
					resultSchema: { type: "object" },
					effect: "read",
					execute: async (_input, ctx) => ctx.scope,
				},
			},
		});
		registry.register("example", createProcessPluginRuntime(options));
		const client = await registry.activate("example", caller(scope));
		const events = vi.fn();
		client.subscribe(events);
		try {
			expect(await client.invoke("read", null)).toEqual({
				initial: "approved-state",
				scope,
				resources: [{ handle: "opaque", kind: "state" }],
			});
			expect(events).toHaveBeenCalledWith({ type: "changed", revision: 1 });
		} finally {
			await registry.deactivate("example");
		}
	});

	it("keeps one worker owner across caller scopes and cancels only the revoked caller", async () => {
		const options = await fixture(`let pending=false,count=0;
export default async ({applicationId})=>({operations:{
 receipt:{inputSchema:{type:"null"},resultSchema:{type:"object"},effect:"read",execute:async(_input,{scope})=>({applicationId,scope,pid:process.pid,count:++count,pending})},
 wait:{inputSchema:{type:"null"},resultSchema:{type:"null"},effect:"read",execute:async(_input,{signal})=>{pending=true;await new Promise(resolve=>signal.addEventListener("abort",resolve,{once:true}));pending=false;return null;}}
},dispose:async()=>{if(pending)throw new Error("pending caller cleanup");}});`);
		const registry = new PluginRuntimeRegistry(allow);
		registry.register("example", createProcessPluginRuntime(options));
		const abort = new AbortController();
		const a = await registry.activate("example", () => ({ identity: abort, scope, signal: abort.signal }));
		const other = {
			kind: "session" as const,
			workspaceId: "other",
			workspaceDirectory: "/Work/Other",
			sessionId: "other-session",
		};
		const b = await registry.activate("example", caller(other));
		try {
			const first = (await a.invoke("receipt", null)) as {
				pid: number;
				applicationId: string;
				count: number;
			};
			expect(await b.invoke("receipt", null)).toMatchObject({
				pid: first.pid,
				applicationId: first.applicationId,
				count: 2,
				scope: other,
			});
			const call = a.invoke("wait", null);
			const rejected = expect(call).rejects.toThrow();
			await vi.waitFor(async () => expect(await b.invoke("receipt", null)).toMatchObject({ pending: true }));
			abort.abort(new Error("caller revoked"));
			await rejected;
			expect(await b.invoke("receipt", null)).toMatchObject({ pid: first.pid, pending: false, scope: other });
		} finally {
			await registry.deactivate("example");
		}
	});

	it("runs in a distinct process with only package reads and no ambient credentials", async () => {
		vi.stubEnv("DRONE_RUNTIME_TEST_SECRET", "synthetic-test-value");
		let hits = 0;
		const server = createServer((_request, response) => {
			hits++;
			response.end("unexpected");
		});
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Expected bound server");
		const outside = await mkdtemp(join(tmpdir(), "drone-runtime-secret-"));
		roots.push(outside);
		const secret = join(outside, "secret.txt");
		await writeFile(secret, "host-only");
		const options = await fixture(`
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const probe = async action => { try { await action(); return "allowed"; } catch (error) { return error.cause?.code ?? error.code; } };
export default async () => ({
 operations: { probe: { inputSchema: {type:"null"}, resultSchema: {type:"object"}, effect:"read",
 execute: async (_input,{scope}) => ({ pid:process.pid, scope, env:Object.keys(process.env),
 packageRead:readFileSync(new URL("./data.txt", import.meta.url), "utf8"),
 outside:await probe(() => readFileSync(${JSON.stringify(secret)}, "utf8")),
 write:await probe(() => writeFileSync(new URL("./mutation.txt", import.meta.url), "forbidden")),
 network:await probe(() => fetch("http://127.0.0.1:${address.port}")),
 child:await probe(() => execFileSync(process.execPath, ["-e", ""])) }) } }, dispose:async()=>{}
});`);
		await writeFile(join(options.packageRoot, "data.txt"), "package-data");
		const registry = new PluginRuntimeRegistry(allow);
		registry.register("example", createProcessPluginRuntime(options));
		try {
			const client = await registry.activate("example", caller(scope));
			const result = await client.invoke("probe", null);
			expect(result).toEqual({
				pid: expect.any(Number),
				scope,
				env: expect.any(Array),
				packageRead: "package-data",
				outside: "ERR_ACCESS_DENIED",
				write: "ERR_ACCESS_DENIED",
				network: "ERR_ACCESS_DENIED",
				child: "ERR_ACCESS_DENIED",
			});
			expect((result as { pid: number }).pid).not.toBe(process.pid);
			expect((result as { env: string[] }).env).not.toEqual(
				expect.arrayContaining(["DRONE_RUNTIME_TEST_SECRET"]),
			);
			expect(hits).toBe(0);
		} finally {
			await registry.deactivate("example");
			await new Promise<void>((done) => server.close(() => done()));
		}
	});

	it("waits for actual cancellation cleanup and disposal before reactivation", async () => {
		const options = await fixture(`
let pending = false;
export default async () => ({ operations: { wait: {
 inputSchema:{type:"null"},resultSchema:{type:"string"},effect:"read",
 execute:async (_input,{signal}) => { pending=true; await new Promise(resolve=>signal.addEventListener("abort",resolve,{once:true})); await new Promise(resolve=>setTimeout(resolve,20)); pending=false; return "done"; }
}, status:{inputSchema:{type:"null"},resultSchema:{type:"boolean"},effect:"read",execute:async()=>pending}}, dispose:async()=>{if(pending)throw new Error("disposed before cleanup");} });`);
		const asked = vi.fn(async () => true);
		const registry = new PluginRuntimeRegistry({ ...allow, authorizeInvocation: asked });
		registry.register("example", createProcessPluginRuntime(options));
		const client = await registry.activate("example", caller(scope));
		const invocation = client.invoke("wait", null);
		const rejected = expect(invocation).rejects.toThrow();
		await vi.waitFor(async () => expect(await client.invoke("status", null)).toBe(true));
		await registry.deactivate("example");
		await rejected;
		await registry.activate("example", caller(scope));
		await expect(client.invoke("wait", null)).rejects.toThrow("not active");
		await registry.deactivate("example");
	});

	it("fails shutdown explicitly and closes a worker that ignores cancellation", async () => {
		const options = await fixture(
			`let started=false; export default async()=>({ operations:{status:{inputSchema:{type:"null"},resultSchema:{type:"boolean"},effect:"read",execute:async()=>started},hang:{inputSchema:{type:"null"},resultSchema:{type:"null"},effect:"read",execute:async()=>{started=true;return new Promise(()=>{});}}},dispose:async()=>{}});`,
		);
		const called = vi.fn(async () => true);
		const registry = new PluginRuntimeRegistry({ ...allow, authorizeInvocation: called });
		registry.register("example", createProcessPluginRuntime(options));
		const client = await registry.activate("example", caller(scope));
		const invocation = client.invoke("hang", null);
		const rejected = expect(invocation).rejects.toThrow("did not settle shutdown");
		await vi.waitFor(async () => expect(await client.invoke("status", null)).toBe(true));
		await expect(registry.deactivate("example")).rejects.toThrow("did not settle shutdown");
		await rejected;
		await expect(registry.activate("example", caller(scope))).rejects.toThrow("stopping");
	});

	it("rejects malformed declarations and factory failures at the child boundary", async () => {
		for (const source of [
			'export default async()=>({operations:{bad:{effect:"read"}},dispose:async()=>{}})',
			'throw new Error("factory import failed")',
		]) {
			const options = await fixture(source);
			const registry = new PluginRuntimeRegistry(allow);
			registry.register("example", createProcessPluginRuntime(options));
			await expect(registry.activate("example", caller(scope))).rejects.toThrow(
				/invalid protocol|factory import failed/,
			);
		}
	});

	it("rejects data symlinks outside the read grant before importing the plugin", async () => {
		const options = await fixture('throw new Error("must not import")');
		const outside = await fixture("synthetic-host-only-data");
		await symlink(outside.entrypoint, join(options.packageRoot, "data.txt"));
		const registry = new PluginRuntimeRegistry(allow);
		registry.register("example", createProcessPluginRuntime(options));
		await expect(registry.activate("example", caller(scope))).rejects.toThrow(
			"symlink escapes its read grant",
		);
	});

	it("rejects entrypoint symlinks that escape the package before launching", async () => {
		const options = await fixture("export default async()=>({operations:{},dispose:async()=>{}})");
		const outside = await fixture('throw new Error("must not import")');
		const entrypoint = join(options.packageRoot, "escape.mjs");
		await symlink(outside.entrypoint, entrypoint);
		const registry = new PluginRuntimeRegistry(allow);
		registry.register("example", createProcessPluginRuntime({ ...options, entrypoint }));
		await expect(registry.activate("example", caller(scope))).rejects.toThrow("escapes its package");
	});
});
