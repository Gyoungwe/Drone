import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { PiBackend } from "../src/pi-backend";
import * as sdk from "../src/session-engine/sdk";
import { runSubagent } from "../src/tools/subagent/runner";

it("delivers official notifications from real created/restored sessions with no knowledge plugin and revokes old contexts", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-generic-notify-")));
	const agentDir = join(root, "agent"),
		cwd = join(root, "project");
	await mkdir(agentDir);
	await mkdir(cwd);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	const path = join(cwd, "source.txt");
	await writeFile(path, "generic host read remains available\n");
	const extension = join(root, "notify.mjs");
	await writeFile(
		extension,
		`export default pi=>{
 pi.on("session_start",(_event,ctx)=>{ctx.ui.notify("startup notification","info");ctx.ui.setStatus("mcp",ctx.ui.theme.fg("accent","MCP ready"));});
 pi.on("before_agent_start",(_event,ctx)=>{for(const severity of ["info","warning","error"])ctx.ui.notify("official "+severity,severity);});
 };`,
	);
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "generic-notify-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	const backend = new PiBackend({
		projectTrust: false,
		lazyCapabilities: false,
		tools: ["read"],
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			additionalExtensionPaths: [extension],
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
		},
	});
	backend.modelRuntime = modelRuntime;
	const knowledgeNotify = vi.spyOn(backend.knowledge, "notify");
	const events = [];
	const off = backend.onEvent((sessionId, event) => events.push({ sessionId, event }));
	try {
		let meta = await backend.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id });
		for (const phase of ["create", "restore"]) {
			const session = backend.registry.get(meta.sessionId).session;
			const ui = session.extensionRunner.getUIContext();
			expect(session.extensionRunner.createContext().mode).toBe("rpc");
			const file = session.sessionFile,
				dir = session.sessionManager.getSessionDir();
			const offset = events.length;
			faux.setResponses([
				fauxAssistantMessage(fauxToolCall("read", { path })),
				fauxAssistantMessage("read complete"),
			]);
			await session.prompt(`Run notifications and read after ${phase}.`);
			await session.waitForIdle();
			expect(events.slice(offset).filter(({ event }) => event.type === "extension_notification")).toEqual(
				["info", "warning", "error"].map((severity) => ({
					sessionId: meta.sessionId,
					event: { type: "extension_notification", severity, message: `official ${severity}` },
				})),
			);
			expect(session.messages.filter((message) => message.role === "toolResult")).toEqual(
				expect.arrayContaining([expect.objectContaining({ toolName: "read", isError: false })]),
			);
			ui.setStatus("extra", "temporary");
			ui.setStatus("extra", undefined);
			expect(events.at(-1)).toEqual({
				sessionId: meta.sessionId,
				event: { type: "extension_status", key: "extra", text: null },
			});
			await backend.closeSession(meta.sessionId);
			expect(events.at(-1)).toEqual({
				sessionId: meta.sessionId,
				event: { type: "extension_status", key: null, text: null },
			});
			const closedCount = events.length;
			ui.notify("late closed context", "error");
			ui.setStatus("mcp", "late closed status");
			expect(events).toHaveLength(closedCount);
			const trace = await readFile(join(dir, "traces", `trace-${meta.sessionId}.jsonl`), "utf8");
			expect(trace).not.toContain('"type":"extension_notification"');
			expect(trace).not.toContain("extension_status");
			expect(await readFile(file, "utf8")).not.toContain("MCP ready");
			if (phase === "create") {
				meta = await backend.openSession(file);
				const reopenedCount = events.length;
				ui.notify("old context against restored identity", "warning");
				expect(events).toHaveLength(reopenedCount);
			}
		}
		expect(
			events.filter(
				({ event }) => event.type === "extension_notification" && event.message === "startup notification",
			),
		).toHaveLength(2);
		expect(knowledgeNotify).not.toHaveBeenCalled();
	} finally {
		off();
		for (const entry of backend.registry.list()) await backend.closeSession(entry.session.sessionId);
		backend.dispose();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await rm(root, { recursive: true, force: true });
	}
});

it("forwards real child SDK notifications with child identity through the host event stream and revokes them at completion", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-child-notify-")));
	const agentDir = join(root, "agent"),
		cwd = join(root, "project");
	await mkdir(agentDir);
	await mkdir(cwd);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	const path = join(cwd, "source.txt");
	await writeFile(path, "child generic read\n");
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "child-notify-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	const backend = new PiBackend({
		projectTrust: false,
		lazyCapabilities: false,
		tools: ["read"],
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
		},
	});
	backend.modelRuntime = modelRuntime;
	const events = [];
	const off = backend.onEvent((sessionId, event) => events.push({ sessionId, event }));
	let child;
	const create = sdk.createAgentSession;
	vi.spyOn(sdk, "createAgentSession").mockImplementation(async (options) => {
		const value = await create(options);
		child = value.session;
		return value;
	});
	try {
		const parent = await backend.createSession({
			cwd,
			provider: faux.provider.id,
			modelId: faux.getModel().id,
		});
		const progress = [];
		faux.setResponses([
			fauxAssistantMessage(fauxToolCall("set_status", {})),
			fauxAssistantMessage(fauxToolCall("read", { path })),
			fauxAssistantMessage("Child completed."),
		]);
		const result = await runSubagent(
			{
				getModelRuntime: async () => modelRuntime,
				getSubagentModel: async () => undefined,
				gate: { confirm: async () => true },
				traces: backend.traces,
				onEvent: (id, event) => backend.emitEvent(id, event),
				coreHost: {
					makeStatusTool: () => ({
						name: "set_status",
						label: "Notify child",
						description: "Exercise official child UI notifications",
						parameters: { type: "object", properties: {} },
						async execute(_id, _input, _signal, _update, ctx) {
							for (const severity of ["info", "warning", "error"])
								ctx.ui.notify(`child ${severity}`, severity);
							ctx.ui.setStatus("mcp", ctx.ui.theme.fg("accent", "Child MCP ready"));
							expect(ctx.mode).toBe("rpc");
							await expect(ctx.ui.input("unsupported child question")).rejects.toThrow(
								"input without a question transport",
							);
							return { content: [{ type: "text", text: "Notifications requested" }] };
						},
					}),
				},
			},
			{
				cwd,
				projectTrusted: true,
				model: faux.getModel(),
				parentSessionId: parent.sessionId,
				agent: {
					name: "notification-reader",
					tools: ["read", "set_status"],
					systemPrompt: "Read the provided local text.",
				},
				task: "Notify then read source.txt",
				onProgress: (value) =>
					progress.push({ sessionId: value.sessionId, parentSessionId: value.parentSessionId }),
			},
		);
		expect(result.exitCode, result.error).toBe(0);
		expect(result.sessionId).not.toBe(parent.sessionId);
		expect(
			events.filter(
				({ event }) => event.type === "extension_notification" && event.message.startsWith("child "),
			),
		).toEqual(
			["info", "warning", "error"].map((severity) => ({
				sessionId: result.sessionId,
				event: { type: "extension_notification", severity, message: `child ${severity}` },
			})),
		);
		expect(progress).toEqual(
			expect.arrayContaining([{ sessionId: result.sessionId, parentSessionId: parent.sessionId }]),
		);
		expect(events).toEqual(
			expect.arrayContaining([
				{
					sessionId: result.sessionId,
					event: expect.objectContaining({ type: "tool_execution_end", toolName: "read", isError: false }),
				},
			]),
		);
		const raw = await readFile(result.artifactPaths.jsonlPath, "utf8");
		const trace = await readFile(
			join(dirname(result.artifactPaths.jsonlPath), "traces", `trace-${result.sessionId}.jsonl`),
			"utf8",
		);
		for (const text of [raw, trace]) {
			expect(text).not.toContain('"type":"extension_notification"');
			expect(text).not.toContain("child warning");
		}
		expect(events.filter(({ event }) => event.type === "extension_status")).toEqual([
			{
				sessionId: result.sessionId,
				event: { type: "extension_status", key: "mcp", text: "Child MCP ready" },
			},
			{ sessionId: result.sessionId, event: { type: "extension_status", key: null, text: null } },
		]);
		const count = events.length;
		child.extensionRunner.getUIContext().notify("late child context", "error");
		child.extensionRunner.getUIContext().setStatus("mcp", "late child");
		expect(events).toHaveLength(count);
		backend.registry
			.get(parent.sessionId)
			.session.extensionRunner.getUIContext()
			.notify("parent still alive", "info");
		expect(events.at(-1)).toEqual({
			sessionId: parent.sessionId,
			event: { type: "extension_notification", severity: "info", message: "parent still alive" },
		});
	} finally {
		off();
		for (const entry of backend.registry.list()) await backend.closeSession(entry.session.sessionId);
		backend.dispose();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await rm(root, { recursive: true, force: true });
	}
});
