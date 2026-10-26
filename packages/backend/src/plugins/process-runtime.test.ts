import { existsSync } from "node:fs";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
const scope = { workspaceId: "workspace", sessionId: "session" };
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
	await expect(registry.activate("example", scope)).rejects.toThrow("activation denied");
});

describe.skipIf(!hasRuntime)("packaged process desktop runtime", () => {
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
export default async ({scope}) => ({
 operations: { probe: { inputSchema: {type:"null"}, resultSchema: {type:"object"}, effect:"read",
 execute: async () => ({ pid:process.pid, scope, env:Object.keys(process.env),
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
			const client = await registry.activate("example", scope);
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
			await registry.deactivate("example", scope);
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
		const client = await registry.activate("example", scope);
		const invocation = client.invoke("wait", null);
		const rejected = expect(invocation).rejects.toThrow();
		await vi.waitFor(async () => expect(await client.invoke("status", null)).toBe(true));
		await registry.deactivate("example", scope);
		await rejected;
		await registry.activate("example", scope);
		await expect(client.invoke("wait", null)).rejects.toThrow("not active");
		await registry.deactivate("example", scope);
	});

	it("fails shutdown explicitly and closes a worker that ignores cancellation", async () => {
		const options = await fixture(
			`let started=false; export default async()=>({ operations:{status:{inputSchema:{type:"null"},resultSchema:{type:"boolean"},effect:"read",execute:async()=>started},hang:{inputSchema:{type:"null"},resultSchema:{type:"null"},effect:"read",execute:async()=>{started=true;return new Promise(()=>{});}}},dispose:async()=>{}});`,
		);
		const called = vi.fn(async () => true);
		const registry = new PluginRuntimeRegistry({ ...allow, authorizeInvocation: called });
		registry.register("example", createProcessPluginRuntime(options));
		const client = await registry.activate("example", scope);
		const invocation = client.invoke("hang", null);
		const rejected = expect(invocation).rejects.toThrow("did not settle shutdown");
		await vi.waitFor(async () => expect(await client.invoke("status", null)).toBe(true));
		await expect(registry.deactivate("example", scope)).rejects.toThrow("did not settle shutdown");
		await rejected;
		await expect(registry.activate("example", scope)).rejects.toThrow("stopping");
	});

	it("rejects malformed declarations and factory failures at the child boundary", async () => {
		for (const source of [
			'export default async()=>({operations:{bad:{effect:"read"}},dispose:async()=>{}})',
			'throw new Error("factory import failed")',
		]) {
			const options = await fixture(source);
			const registry = new PluginRuntimeRegistry(allow);
			registry.register("example", createProcessPluginRuntime(options));
			await expect(registry.activate("example", scope)).rejects.toThrow(
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
		await expect(registry.activate("example", scope)).rejects.toThrow("symlink escapes its read grant");
	});

	it("rejects entrypoint symlinks that escape the package before launching", async () => {
		const options = await fixture("export default async()=>({operations:{},dispose:async()=>{}})");
		const outside = await fixture('throw new Error("must not import")');
		const entrypoint = join(options.packageRoot, "escape.mjs");
		await symlink(outside.entrypoint, entrypoint);
		const registry = new PluginRuntimeRegistry(allow);
		registry.register("example", createProcessPluginRuntime({ ...options, entrypoint }));
		await expect(registry.activate("example", scope)).rejects.toThrow("escapes its package");
	});
});
