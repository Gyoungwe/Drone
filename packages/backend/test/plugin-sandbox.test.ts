import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProcessSandboxedExtension, PluginSandboxSession } from "../src/plugin-sandbox";

async function fixture(source: string): Promise<{
	root: string;
	entrypoint: string;
	secret: string;
	outsideRoot: string;
}> {
	const root = await mkdtemp(join(tmpdir(), "drone-plugin-sandbox-test-"));
	const outsideRoot = await mkdtemp(join(tmpdir(), "drone-plugin-sandbox-outside-"));
	const entrypoint = join(root, "plugin.mjs");
	const secret = join(outsideRoot, "outside-secret.txt");
	await writeFile(entrypoint, source);
	await writeFile(secret, "host-only");
	return { root, entrypoint, secret, outsideRoot };
}

describe("process-level plugin sandbox", () => {
	it("loads a real extension in another process and enforces Node permissions", async () => {
		const { root, entrypoint, secret, outsideRoot } = await fixture(`
			import { readFileSync } from "node:fs";
			export default function register(pi) {
				pi.registerTool({
					name: "sandbox_probe",
					label: "Sandbox probe",
					description: "Probe process and permission boundaries",
					parameters: { type: "object", properties: {} },
					async execute() {
						let read = "denied";
						try { read = readFileSync("__SECRET_PATH__", "utf8"); } catch (error) { read = error.code; }
						return { content: [{ type: "text", text: JSON.stringify({ pid: process.pid, secret: process.env.DRONE_TEST_SECRET ?? null, read }) }] };
					}
				});
			}
		`);
		await writeFile(entrypoint, (await readFile(entrypoint, "utf8")).replaceAll("__SECRET_PATH__", secret));
		const session = new PluginSandboxSession({
			pluginId: "fixture-sandbox",
			entrypoint,
			packageRoot: root,
			cwd: root,
		});
		try {
			const ready = await session.start();
			expect(ready.pid).not.toBe(process.pid);
			expect(ready.tools.map((tool) => tool.name)).toEqual(["sandbox_probe"]);
			const result = (await session.invoke("sandbox_probe", "call-1", {})) as {
				content: Array<{ text: string }>;
			};
			const details = JSON.parse(result.content[0].text) as {
				pid: number;
				secret: string | null;
				read: string;
			};
			expect(details.pid).toBe(ready.pid);
			expect(details.secret).toBeNull();
			expect(details.read).toMatch(/ERR_ACCESS_DENIED|EACCES/);
		} finally {
			await session.close();
			await Promise.all([
				rm(root, { recursive: true, force: true }),
				rm(outsideRoot, { recursive: true, force: true }),
			]);
		}
	});

	it("does not grant network or child-process access by default", async () => {
		const { root, entrypoint, outsideRoot } = await fixture(`
			export default function register(pi) {
				pi.registerTool({
					name: "sandbox_denied",
					label: "Sandbox denied",
					description: "Probe default denials",
					parameters: { type: "object", properties: {} },
					async execute() {
						let network = "allowed";
						let child = "allowed";
						try { await fetch("http://127.0.0.1:9"); } catch (error) { network = error.code ?? error.name; }
						try { (await import("node:child_process")).execFileSync(process.execPath, ["-e", ""]); } catch (error) { child = error.code ?? error.name; }
						return { content: [{ type: "text", text: JSON.stringify({ network, child }) }] };
					}
				});
			}
		`);
		const session = new PluginSandboxSession({
			pluginId: "fixture-denials",
			entrypoint,
			packageRoot: root,
			cwd: root,
		});
		try {
			await session.start();
			const result = (await session.invoke("sandbox_denied", "call-1", {})) as {
				content: Array<{ text: string }>;
			};
			const details = JSON.parse(result.content[0].text) as { network: string; child: string };
			expect(details.network).toMatch(/ERR_ACCESS_DENIED|Error/);
			expect(details.child).toMatch(/ERR_ACCESS_DENIED|Error/);
		} finally {
			await session.close();
			await Promise.all([
				rm(root, { recursive: true, force: true }),
				rm(outsideRoot, { recursive: true, force: true }),
			]);
		}
	}, 30_000);

	it("exposes the proxy as an inline Pi extension", async () => {
		const { root, entrypoint, outsideRoot } = await fixture(`
			export default (pi) => pi.registerTool({
				name: "proxy_tool",
				label: "Proxy tool",
				description: "A proxied tool",
				parameters: { type: "object", properties: {} },
				async execute() { return { content: [{ type: "text", text: "ok" }] }; }
		});
		`);
		const extension = createProcessSandboxedExtension({
			pluginId: "fixture-proxy",
			entrypoint,
			packageRoot: root,
			cwd: root,
		});
		const registered: Array<{ name: string; execute: (...args: any[]) => Promise<unknown> }> = [];
		try {
			if (typeof extension === "function") throw new Error("expected named inline extension");
			await extension.factory({
				registerTool(tool: any) {
					registered.push(tool);
				},
				on() {
					return () => {};
				},
			} as never);
			expect(registered.map((tool) => tool.name)).toEqual(["proxy_tool"]);
			const result = (await registered[0].execute("call-1", {}, undefined, undefined, {})) as {
				content: Array<{ text: string }>;
			};
			expect(result.content[0].text).toBe("ok");
		} finally {
			await Promise.all([
				rm(root, { recursive: true, force: true }),
				rm(outsideRoot, { recursive: true, force: true }),
			]);
		}
	}, 30_000);

	it("kills a child that exceeds its invocation budget", async () => {
		const { root, entrypoint, outsideRoot } = await fixture(`
			export default (pi) => pi.registerTool({
				name: "sandbox_hang",
				label: "Sandbox hang",
				description: "A bounded invocation",
				parameters: { type: "object", properties: {} },
				async execute() { await new Promise(() => {}); }
		});
		`);
		const session = new PluginSandboxSession({
			pluginId: "fixture-timeout",
			entrypoint,
			packageRoot: root,
			cwd: root,
			timeoutMs: 100,
		});
		try {
			await session.start();
			await expect(session.invoke("sandbox_hang", "call-1", {})).rejects.toThrow("timed out");
		} finally {
			await session.close();
			await Promise.all([
				rm(root, { recursive: true, force: true }),
				rm(outsideRoot, { recursive: true, force: true }),
			]);
		}
	}, 30_000);
});
