import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { zoteroMcpSpec } from "@drone/research/zotero-setup";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { McpService } from "../src/mcp/service";
import { preferBundledMcpRuntime } from "../src/project/trust-loader";

// Same tree electron-builder ships as <resources>/pi-packages/node_modules (npm run stage:pi-packages).
const PACKAGES = resolve(__dirname, "../../desktop/pi-packages/node_modules");
const ADAPTER = join(PACKAGES, "pi-mcp-adapter/index.ts");
const ADAPTER_CONFIG = join(PACKAGES, "pi-mcp-adapter/config.ts");
const FIXTURE = resolve(__dirname, "fixtures/mcp/echo-server.mjs");

type Translate = (
	name: string,
	value: unknown,
) => { entry: Record<string, unknown>; ignored: string[] } | string;

function staged(): boolean {
	if (existsSync(ADAPTER_CONFIG)) return true;
	if (process.env.CI) throw new Error("pi-mcp-adapter is not staged; run npm run stage:pi-packages");
	return false;
}

async function adapterTranslate(): Promise<Translate> {
	const mod = (await import(pathToFileURL(ADAPTER_CONFIG).href)) as { translatePiMcpServer: Translate };
	return mod.translatePiMcpServer;
}

describe("enabled-state as pi-mcp-adapter 5.1.0 reads Pi's mcp.json", () => {
	it("what Drone writes is what the adapter honours; legacy `disabled` is not", async () => {
		if (!staged()) return;
		const translate = await adapterTranslate();
		const dir = await mkdtemp(join(tmpdir(), "drone-mcp-translate-"));
		await writeFile(join(dir, "mcp.json"), JSON.stringify({ mcpServers: { docs: { command: "node" } } }));
		const service = new McpService({ agentDir: dir, homeDir: dir });

		await service.setServerEnabled("docs", false);
		const { readFile } = await import("node:fs/promises");
		const offRaw = JSON.parse(await readFile(join(dir, "mcp.json"), "utf8")).mcpServers.docs;
		const off = translate("docs", offRaw);
		expect(typeof off).not.toBe("string");
		expect((off as Exclude<typeof off, string>).entry.disabled).toBe(true);
		expect((off as Exclude<typeof off, string>).ignored).toEqual([]);

		await service.setServerEnabled("docs", true);
		const onRaw = JSON.parse(await readFile(join(dir, "mcp.json"), "utf8")).mcpServers.docs;
		const on = translate("docs", onRaw) as Exclude<ReturnType<Translate>, string>;
		expect(on.entry.disabled).toBeUndefined();

		// Why the old field was a bug: the adapter drops `disabled` and starts the server.
		const legacy = translate("docs", { command: "node", disabled: true }) as Exclude<
			ReturnType<Translate>,
			string
		>;
		expect(legacy.entry.disabled).toBeUndefined();
		expect(legacy.ignored).toContain("disabled");
		// A project stub without a transport is rejected outright.
		expect(typeof translate("docs", { disabled: false })).toBe("string");
	});

	it("/zotero-setup's entry uses only translated fields: hidden delete tools, singular library type, off by default", async () => {
		if (!staged()) return;
		const translate = await adapterTranslate();
		const result = translate("zotero", zoteroMcpSpec("C:\\Users\\me\\.local\\bin\\zotero-mcp.exe"));
		expect(typeof result).not.toBe("string");
		const { entry, ignored } = result as Exclude<ReturnType<Translate>, string>;
		expect(ignored).toEqual([]);
		expect(entry).toMatchObject({
			command: "C:\\Users\\me\\.local\\bin\\zotero-mcp.exe",
			args: ["serve"],
			env: { ZOTERO_LOCAL: "true", ZOTERO_LIBRARY_TYPE: "user", ZOTERO_MCP_TOOLSETS: "none" },
			disabled: true,
			requestTimeoutMs: 120_000,
			excludeTools: ["zotero_delete_item", "zotero_delete_collection", "zotero_delete_annotation"],
		});
		const enabled = translate("zotero", zoteroMcpSpec("zotero-mcp", { enabled: true })) as Exclude<
			ReturnType<Translate>,
			string
		>;
		expect(enabled.entry.disabled).toBeUndefined();
	});

	it("a server disabled through McpService is never started by the bundled adapter", async () => {
		if (!existsSync(ADAPTER)) {
			if (process.env.CI) throw new Error("pi-mcp-adapter is not staged; run npm run stage:pi-packages");
			return;
		}
		const root = await realpath(await mkdtemp(join(tmpdir(), "drone-mcp-enabled-sdk-")));
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
		let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
		try {
			await Promise.all([mkdir(cwd, { recursive: true }), mkdir(agentDir, { recursive: true })]);
			await writeFile(
				join(agentDir, "mcp.json"),
				JSON.stringify({
					mcpServers: {
						on: { command: process.execPath, args: [FIXTURE] },
						off: { command: process.execPath, args: [FIXTURE] },
					},
				}),
			);
			await new McpService({ agentDir, homeDir: root }).setServerEnabled("off", false);

			const statuses: Array<{ servers: Array<{ name: string; status: string; toolCount: number }> }> = [];
			const settingsManager = SettingsManager.create(cwd, agentDir);
			const resourceLoader = new DefaultResourceLoader({
				cwd,
				agentDir,
				settingsManager,
				additionalExtensionPaths: [ADAPTER],
				extensionsOverride: preferBundledMcpRuntime(ADAPTER),
				extensionFactories: [
					(pi) => {
						pi.events.on("pi-mcp-adapter/status/v1", (payload: unknown) => {
							statuses.push(payload as (typeof statuses)[number]);
						});
					},
				],
			});
			await resourceLoader.reload();
			const runtime = await ModelRuntime.create({
				authPath: join(agentDir, "auth.json"),
				modelsPath: null,
				modelsStorePath: join(agentDir, "models-cache.json"),
				allowModelNetwork: false,
				refreshOnCreate: false,
			});
			({ session } = await createAgentSession({
				cwd,
				agentDir,
				settingsManager,
				resourceLoader,
				modelRuntime: runtime,
				sessionManager: SessionManager.inMemory(cwd),
			}));
			await session.bindExtensions({});
			const deadline = Date.now() + 20_000;
			const ready = () => statuses.some((s) => s.servers.some((x) => x.name === "on" && x.toolCount === 1));
			while (Date.now() < deadline && !ready()) await new Promise((r) => setTimeout(r, 100));
			expect(ready(), JSON.stringify(statuses.at(-1))).toBe(true);
			const last = statuses.at(-1);
			const off = last?.servers.find((x) => x.name === "off");
			expect(off?.status, JSON.stringify(last)).toBe("disabled");
			expect(off?.toolCount).toBe(0);
			expect(statuses.some((s) => s.servers.some((x) => x.name === "off" && x.status !== "disabled"))).toBe(
				false,
			);
			const proxy = session.agent.state.tools.find((tool) => tool.name === "mcp");
			const blocked = await proxy?.execute("call-off", { server: "off", tool: "echo", args: { text: "hi" } });
			expect(JSON.stringify(blocked?.content)).not.toContain("echo:hi");
			const allowed = await proxy?.execute("call-on", { server: "on", tool: "echo", args: { text: "hi" } });
			expect(JSON.stringify(allowed?.content)).toContain("echo:hi");
		} finally {
			session?.dispose?.();
			vi.unstubAllEnvs();
			await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }).catch((error) => {
				if (process.platform !== "win32") throw error;
			});
		}
	}, 60_000);
});
