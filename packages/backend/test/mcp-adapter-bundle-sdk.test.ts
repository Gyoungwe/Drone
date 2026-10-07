import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MCP_RUNTIME_VERSION, McpContract, normalizeMcpStatus } from "@drone/shared";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { expect, it, vi } from "vitest";
import { preferBundledMcpRuntime } from "../src/project/trust-loader";

// Same tree electron-builder ships as <resources>/pi-packages/node_modules (npm run stage:pi-packages).
const PACKAGES = resolve(__dirname, "../../desktop/pi-packages/node_modules");
const ADAPTER = join(PACKAGES, "pi-mcp-adapter/index.ts");
const FIXTURE = resolve(__dirname, "fixtures/mcp/echo-server.mjs");

it("bundled pi-mcp-adapter loads in an SDK session, connects a stdio server and reports status", async () => {
	if (!existsSync(ADAPTER)) {
		if (process.env.CI) throw new Error("pi-mcp-adapter is not staged; run npm run stage:pi-packages");
		return;
	}
	const { version } = JSON.parse(await readFile(join(PACKAGES, "pi-mcp-adapter/package.json"), "utf8"));
	expect(version).toBe(MCP_RUNTIME_VERSION);
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-mcp-adapter-sdk-")));
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	try {
		await Promise.all([mkdir(cwd, { recursive: true }), mkdir(agentDir, { recursive: true })]);
		await writeFile(
			join(agentDir, "mcp.json"),
			JSON.stringify({
				mcpServers: { echo: { command: process.execPath, args: [FIXTURE], lifecycle: "eager" } },
			}),
		);
		const statuses: Array<{
			totalTools: number;
			servers: Array<{ name: string; status: string; toolCount: number }>;
		}> = [];
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
		expect(resourceLoader.getExtensions().errors).toEqual([]);
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
		expect(session.getAllTools().map((tool) => tool.name)).toContain("mcp");
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline && !statuses.some((s) => s.totalTools > 0)) {
			await new Promise((r) => setTimeout(r, 100));
		}
		// The adapter discovered the fixture's single tool (eager connect, then cached metadata).
		const seen = statuses.find((s) => s.servers.some((x) => x.name === "echo" && x.toolCount === 1));
		expect(seen?.servers.find((x) => x.name === "echo")?.status, JSON.stringify(statuses.at(-1))).toMatch(
			/^(?:connected|cached)$/,
		);
		// The raw adapter snapshot (extra fields, "blocked" etc.) must pass the strict IPC schema once normalized.
		const normalized = normalizeMcpStatus(statuses.at(-1));
		expect(Check(McpContract.methods.getStatus.result, normalized)).toBe(true);
		expect(normalized?.runtime).toBe("running");
		const proxy = session.agent.state.tools.find((tool) => tool.name === "mcp");
		const result = await proxy?.execute("call-1", { server: "echo", tool: "echo", args: { text: "hi" } });
		expect(JSON.stringify(result?.content)).toContain("echo:hi");
	} finally {
		session?.dispose?.();
		vi.unstubAllEnvs();
		// Windows: the adapter closes the stdio server asynchronously after dispose; until that child
		// exits, its cwd (the temp project) stays locked (EBUSY). Retry, and never fail on temp cleanup.
		await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch((error) => {
			if (process.platform !== "win32") throw error;
		});
	}
}, 60_000);
