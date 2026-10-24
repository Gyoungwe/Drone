import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { PluginSandboxSession } from "../src/plugin-sandbox";
import { sandboxExtensionFactory } from "../src/session-engine/sandbox-loader";
import type { ExtensionContext } from "../src/session-engine/sdk";
import { DefaultResourceLoader, SettingsManager } from "../src/session-engine/sdk";

const runtime = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);

it("intercepts untrusted code before both Pi trust-loading passes, without native fallback", async () => {
	const root = await mkdtemp(join(tmpdir(), "drone-loader-denied-"));
	const path = join(root, "extension.mjs");
	await writeFile(path, 'process.env.DRONE_UNSAFE_IMPORT="executed"; export default ()=>{}');
	const loader = new DefaultResourceLoader({
		cwd: root,
		agentDir: root,
		settingsManager: SettingsManager.inMemory({}),
		noExtensions: true,
		additionalExtensionPaths: [path],
		extensionFactoryForPath: async () => {
			throw new Error("runtime unavailable");
		},
	});
	try {
		await loader.reload({ resolveProjectTrust: async () => true });
		expect(process.env.DRONE_UNSAFE_IMPORT).toBeUndefined();
		expect(loader.getExtensions().errors).toEqual([
			expect.objectContaining({ error: "runtime unavailable" }),
		]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it.skipIf(!existsSync(join(runtime, "runtime.json")))(
	"uses shipped runtime for TS discovery, denies without consent and closes the worker on shutdown",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-loader-runtime-"));
		const path = join(root, "extension.ts");
		await writeFile(
			path,
			`process.env.DRONE_UNSAFE_IMPORT="executed";
 export default function register(pi: any) {pi.registerTool({name:"runtime_probe", label:"Probe", description:"Probe", parameters:{type:"object",properties:{url:{type:"string"}}}, async execute(_id: string, params: {url:string}) {const text=await (await fetch(params.url)).text();return {content:[{type:"text",text:JSON.stringify({pid:process.pid,text,node:process.versions.node})}]};}})}`,
		);
		let hits = 0;
		const server = createServer((_q, res) => {
			hits++;
			res.end("live-endpoint");
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("HTTP server address missing");
		const url = `http://127.0.0.1:${address.port}`;
		const loader = new DefaultResourceLoader({
			cwd: root,
			agentDir: root,
			settingsManager: SettingsManager.inMemory({}),
			noExtensions: true,
			additionalExtensionPaths: [path],
			extensionFactoryForPath: sandboxExtensionFactory(runtime, [], root),
		});
		try {
			await loader.reload({ resolveProjectTrust: async () => true });
			expect(loader.getExtensions().errors).toEqual([]);
			expect(process.env.DRONE_UNSAFE_IMPORT).toBeUndefined();
			const extension = loader.getExtensions().extensions[0];
			const tool = extension.tools.get("runtime_probe")!.definition;
			await expect(
				tool.execute("denied", { url }, undefined, undefined, {
					hasUI: true,
					ui: { confirm: async () => false },
				} as ExtensionContext),
			).rejects.toThrow("permission denied");
			expect(hits).toBe(0);
			let confirmations = 0;
			const context = {
				hasUI: true,
				ui: {
					confirm: async () => {
						confirmations++;
						return true;
					},
				},
			} as ExtensionContext;
			const [result] = await Promise.all([
				tool.execute("allowed1", { url }, undefined, undefined, context),
				tool.execute("allowed2", { url }, undefined, undefined, context),
			]);
			expect(confirmations).toBe(1);
			const data = JSON.parse((result.content[0] as { text: string }).text);
			expect(data.pid).not.toBe(process.pid);
			expect(data.node).toBe("26.12.1");
			expect(data.text).toBe("live-endpoint");
			expect(hits).toBe(2);
			for (const shutdown of extension.handlers.get("session_shutdown") ?? [])
				await shutdown({ type: "session_shutdown" }, {} as ExtensionContext);
			expect(() => process.kill(data.pid, 0)).toThrow();
		} finally {
			server.close();
			await rm(root, { recursive: true, force: true });
		}
	},
	30000,
);

it.skipIf(!existsSync(join(runtime, "runtime.json")))(
	"bundled runtime denies a reachable endpoint without network permission",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-runtime-network-"));
		const entrypoint = join(root, "entry.mjs");
		await writeFile(
			entrypoint,
			`export default pi=>pi.registerTool({name:'probe',parameters:{type:'object'},async execute(_id,p){try{await fetch(p.url);return 'allowed'}catch(e){return e.cause.code}}})`,
		);
		const server = createServer((_q, res) => res.end("ok"));
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		const a = server.address();
		if (!a || typeof a === "string") throw new Error("address");
		const url = `http://127.0.0.1:${a.port}`;
		expect(await (await fetch(url)).text()).toBe("ok");
		const session = new PluginSandboxSession({
			pluginId: "probe",
			entrypoint,
			packageRoot: root,
			cwd: root,
			runtimeDirectory: runtime,
		});
		try {
			await session.start();
			expect(await session.invoke("probe", "1", { url })).toBe("ERR_ACCESS_DENIED");
		} finally {
			await session.close();
			server.close();
			await rm(root, { recursive: true, force: true });
		}
	},
	30000,
);

it("rejects a modified shipped runtime before executing any plugin code", async () => {
	const root = await mkdtemp(join(tmpdir(), "drone-runtime-integrity-"));
	await writeFile(join(root, process.platform === "win32" ? "node.exe" : "node"), "modified runtime");
	await writeFile(join(root, "runtime.json"), JSON.stringify({ binarySha256: "not-the-binary-digest" }));
	const session = new PluginSandboxSession({
		pluginId: "integrity",
		entrypoint: join(root, "entry.mjs"),
		packageRoot: root,
		cwd: root,
		runtimeDirectory: root,
	});
	try {
		await expect(session.start()).rejects.toThrow("checksum mismatch");
	} finally {
		await session.close();
		await rm(root, { recursive: true, force: true });
	}
});
