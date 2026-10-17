import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type CapabilityResearchPorts, runCapabilityResearch } from "@drone/research";
import {
	createCapabilityRequest,
	createCapabilityResearchPlan,
	createCapabilitySourceReceipt,
} from "@drone/shared";
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

// This is the same staged tree electron-builder ships as <resources>/pi-packages/node_modules.
const PACKAGES = resolve(__dirname, "../../desktop/pi-packages/node_modules");
const ADAPTER = join(PACKAGES, "pi-mcp-adapter/index.ts");
const FIXTURE = resolve(__dirname, "fixtures/mcp/echo-server.mjs");
const MCP_MARKER = "DRONE-MCP-001";
const CONNECTOR_MARKER = "DRONE-CONN-01-UNIQUE";

type ServerStatus = { name: string; status: string; toolCount: number };
type StatusEvent = { servers: ServerStatus[]; totalTools?: number };

async function waitFor(
	statuses: readonly StatusEvent[],
	predicate: (status: StatusEvent) => boolean,
	timeoutMs = 20_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline && !statuses.some(predicate))
		await new Promise((resolve) => setTimeout(resolve, 100));
}

async function openMcpSession(input: {
	root: string;
	cwd: string;
	agentDir: string;
	statuses: StatusEvent[];
}) {
	const { cwd, agentDir, statuses } = input;
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
					statuses.push(payload as StatusEvent);
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
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		settingsManager,
		resourceLoader,
		modelRuntime: runtime,
		sessionManager: SessionManager.inMemory(cwd),
	});
	await session.bindExtensions({});
	return session;
}

describe("remaining pluginization gates", () => {
	it("MCP-01 enables a real local marker call, then becomes unavailable after disable and reload", async () => {
		if (!existsSync(ADAPTER)) {
			if (process.env.CI) throw new Error("pi-mcp-adapter is not staged; run npm run stage:pi-packages");
			return;
		}
		const root = await realpath(await mkdtemp(join(tmpdir(), "drone-mcp-gate-")));
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
		let firstSession: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
		let secondSession: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
		try {
			await Promise.all([mkdir(cwd, { recursive: true }), mkdir(agentDir, { recursive: true })]);
			await writeFile(
				join(agentDir, "mcp.json"),
				JSON.stringify({
					mcpServers: { echo_marker: { command: process.execPath, args: [FIXTURE], lifecycle: "eager" } },
				}),
			);

			const enabledStatuses: StatusEvent[] = [];
			firstSession = await openMcpSession({ root, cwd, agentDir, statuses: enabledStatuses });
			await waitFor(enabledStatuses, (status) =>
				status.servers.some((server) => server.name === "echo_marker" && server.toolCount === 1),
			);
			const connected = enabledStatuses
				.flatMap((status) => status.servers)
				.find((server) => server.name === "echo_marker" && server.toolCount === 1);
			expect(connected?.status, JSON.stringify(enabledStatuses)).toMatch(/^(?:connected|cached)$/);
			const enabledProxy = firstSession.agent.state.tools.find((tool) => tool.name === "mcp");
			const enabledCall = await enabledProxy?.execute("mcp-marker", {
				server: "echo_marker",
				tool: "echo",
				args: { text: MCP_MARKER },
			});
			expect(JSON.stringify(enabledCall?.content)).toContain(MCP_MARKER);

			firstSession.dispose();
			await new McpService({ agentDir, homeDir: root }).setServerEnabled("echo_marker", false);
			const disabledConfig = JSON.parse(
				await (await import("node:fs/promises")).readFile(join(agentDir, "mcp.json"), "utf8"),
			);
			expect(disabledConfig.mcpServers.echo_marker.enabled).toBe(false);

			const disabledStatuses: StatusEvent[] = [];
			secondSession = await openMcpSession({ root, cwd, agentDir, statuses: disabledStatuses });
			await waitFor(
				disabledStatuses,
				(status) =>
					status.servers.length === 0 ||
					status.servers.some((server) => server.name === "echo_marker" && server.status === "disabled"),
			);
			const disabled = disabledStatuses
				.flatMap((status) => status.servers)
				.find((server) => server.name === "echo_marker");
			// pi-mcp-adapter either reports an explicit disabled row or omits the server
			// entirely after reload; both prove that no disabled transport is exposed.
			expect(disabled === undefined || disabled.status === "disabled", JSON.stringify(disabledStatuses)).toBe(
				true,
			);
			expect(disabled?.toolCount ?? 0).toBe(0);
			const disabledProxy = secondSession.agent.state.tools.find((tool) => tool.name === "mcp");
			const disabledCall = await disabledProxy?.execute("mcp-marker-disabled", {
				server: "echo_marker",
				tool: "echo",
				args: { text: MCP_MARKER },
			});
			expect(JSON.stringify(disabledCall?.content)).not.toContain(MCP_MARKER);
		} finally {
			firstSession?.dispose?.();
			secondSession?.dispose?.();
			vi.unstubAllEnvs();
			await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }).catch((error) => {
				if (process.platform !== "win32") throw error;
			});
		}
	}, 60_000);

	it("CONN-01 searches a unique term through read-only CapabilityResearchPorts and records close/reopen behavior", async () => {
		const now = "2026-10-18T00:00:00.000Z";
		const sourceUrl = "https://connector.example.test/source/DRONE-CONN-01-UNIQUE";
		const request = createCapabilityRequest({
			id: "conn-gate-request",
			caseRef: { kind: "research-case", id: "conn-gate-case" },
			assay: "connector-search",
			question: `Find ${CONNECTOR_MARKER}`,
			requirements: [],
			status: "open",
			createdAt: now,
			updatedAt: now,
		});
		const calls: Array<Record<string, unknown>> = [];
		let enabled = true;
		const source = createCapabilitySourceReceipt({
			id: "source-conn-gate-001",
			sourceRef: `fixture://read-only-search/${CONNECTOR_MARKER}`,
			sourceHash: "a".repeat(64),
			locator: sourceUrl,
			observedAt: now,
		});
		const ports: CapabilityResearchPorts = {
			async createPlan(input) {
				calls.push({ action: "plan", connector: "fixture-read-only", objective: input.objective });
				return createCapabilityResearchPlan({
					id: `plan-${enabled ? "open" : "closed"}`,
					requestRef: {
						kind: input.request.kind,
						id: input.request.id,
						contentHash: input.request.contentHash,
					},
					objective: input.objective,
					questions: input.questions,
					sourceRefs: enabled ? [{ kind: source.kind, id: source.id }] : [],
					createdAt: now,
				});
			},
			async readSources(input) {
				const query = input.plan.questions.find((question) => question.includes(CONNECTOR_MARKER)) ?? "";
				if (!enabled) {
					calls.push({ action: "search-skipped-disabled", connector: "fixture-read-only", query });
					return [];
				}
				calls.push({
					action: "search",
					connector: "fixture-read-only",
					query,
					url: sourceUrl,
					readOnly: true,
				});
				return [source];
			},
		};

		const opened = await runCapabilityResearch(ports, {
			request,
			objective: "read-only unique-term search",
			questions: [CONNECTOR_MARKER],
		});
		expect(opened.sources).toHaveLength(1);
		expect(opened.sources[0]).toMatchObject({ id: source.id, locator: sourceUrl, readOnly: true });
		expect(calls).toContainEqual({
			action: "search",
			connector: "fixture-read-only",
			query: CONNECTOR_MARKER,
			url: sourceUrl,
			readOnly: true,
		});

		enabled = false;
		const closed = await runCapabilityResearch(ports, {
			request,
			objective: "read-only unique-term search after close",
			questions: [CONNECTOR_MARKER],
		});
		expect(closed.sources).toEqual([]);
		expect(calls.at(-1)).toEqual({
			action: "search-skipped-disabled",
			connector: "fixture-read-only",
			query: CONNECTOR_MARKER,
		});
		expect(calls.filter((call) => call.action === "search")).toHaveLength(1);

		enabled = true;
		const reopened = await runCapabilityResearch(ports, {
			request,
			objective: "read-only unique-term search after reopen",
			questions: [CONNECTOR_MARKER],
		});
		expect(reopened.sources[0]?.id).toBe(source.id);
		expect(calls.filter((call) => call.action === "search")).toHaveLength(2);
	});
});
