import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { PermissionGate } from "../src/permissions/gate";
import { AskGate } from "../src/session/ask-gate";
import { makeUiContext } from "../src/session/ui-context";
import { SessionEngine } from "../src/session-engine/engine";

// SDK 1.1.0 has 28 distinct UI members (setWidget's overload is one member).
const terminalOnly = [
	"onTerminalInput",
	"setWorkingMessage",
	"setWorkingVisible",
	"setWorkingIndicator",
	"setHiddenThinkingLabel",
	"setWidget",
	"setFooter",
	"setHeader",
	"setTitle",
	"custom",
	"pasteToEditor",
	"setEditorText",
	"getEditorText",
	"editor",
	"addAutocompleteProvider",
	"setEditorComponent",
	"getEditorComponent",
	"getToolsExpanded",
	"setToolsExpanded",
];
it("the real SDK observes all 28 Desktop UI capabilities truthfully and keeps read working after rejected tools/hooks", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-ui-capabilities-")));
	const agentDir = join(root, "agent");
	await mkdir(agentDir);
	await writeFile(join(root, "source.txt"), "ordinary read after UI rejection");
	let session;
	const results = {},
		hookErrors = [],
		notices = [],
		statuses = [];
	const permission = new PermissionGate((request) => permission.respond(request.id, "allow"));
	const asks = new AskGate((request) => {
		asks.respond(request.id, {
			kind: "answer",
			answers: {
				value: request.questions[0].type === "single" ? { values: ["A"] } : { customText: "answer" },
			},
		});
		return true;
	});
	try {
		const settingsManager = SettingsManager.inMemory({});
		const resourceLoader = new DefaultResourceLoader({
			cwd: root,
			agentDir,
			settingsManager,
			noExtensions: true,
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", (_event, ctx) => ctx.ui.setTitle("unavailable terminal title"));
					pi.registerTool({
						name: "ui_probe",
						label: "UI probe",
						description: "Probe real official UI",
						parameters: { type: "object", properties: { method: { type: "string" } }, required: ["method"] },
						async execute(_id, { method }, _signal, _update, ctx) {
							expect(ctx.mode).toBe("rpc");
							expect(ctx.hasUI).toBe(true);
							if (method === "supported") {
								results.select = await ctx.ui.select("Choice", ["A", "B"]);
								results.confirm = await ctx.ui.confirm("Permission", "Synthetic permission");
								results.input = await ctx.ui.input("Input");
								ctx.ui.notify("official notification", "warning");
								ctx.ui.setStatus("research", ctx.ui.theme.fg("accent", "live research"));
								ctx.ui.setStatus("research", undefined);
								results.theme = ctx.ui.theme.getColorMode();
								results.getAllThemes = ctx.ui.getAllThemes();
								results.getTheme = ctx.ui.getTheme("drone-desktop") === ctx.ui.theme;
								expect(ctx.ui.getTheme("missing")).toBeUndefined();
								results.setTheme = ctx.ui.setTheme("other");
							} else {
								const terminalFactory = () => {
									throw new Error("Terminal component must not run");
								};
								const argumentsByMethod = {
									onTerminalInput: [() => undefined],
									setWorkingMessage: ["Working"],
									setWorkingVisible: [false],
									setWorkingIndicator: [{ frames: [] }],
									setHiddenThinkingLabel: ["Thinking"],
									setWidget: ["probe", ["Widget"]],
									setFooter: [terminalFactory],
									setHeader: [terminalFactory],
									setTitle: ["Title"],
									custom: [terminalFactory],
									pasteToEditor: ["text"],
									setEditorText: ["text"],
									getEditorText: [],
									editor: ["Editor", "text"],
									addAutocompleteProvider: [(current) => current],
									setEditorComponent: [terminalFactory],
									getEditorComponent: [],
									getToolsExpanded: [],
									setToolsExpanded: [true],
								};
								await ctx.ui[method](...argumentsByMethod[method]);
							}
							return { content: [{ type: "text", text: "UI probe completed" }] };
						},
					});
				},
			],
		});
		await resourceLoader.reload({ resolveProjectTrust: async () => true });
		expect(resourceLoader.getExtensions().errors).toEqual([]);
		const modelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: null,
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		const faux = fauxProvider({ provider: "terminal-ui-truth-offline", tokensPerSecond: 0 });
		modelRuntime.registerNativeProvider(faux.provider);
		vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
		({ session } = await createAgentSession({
			cwd: root,
			agentDir,
			settingsManager,
			resourceLoader,
			modelRuntime,
			sessionManager: SessionManager.create(root, agentDir),
			model: faux.getModel(),
		}));
		permission.bindSession(session.sessionId);
		asks.bindSession(session.sessionId);
		await session.bindExtensions({
			mode: "rpc",
			uiContext: makeUiContext(
				permission,
				asks,
				(message, severity) => notices.push({ message, severity }),
				(key, text) => statuses.push({ key, text }),
			),
			onError: (failure) => hookErrors.push(failure),
		});
		const replies = [...terminalOnly, "supported"].map((method) =>
			fauxAssistantMessage(fauxToolCall("ui_probe", { method })),
		);
		faux.setResponses([
			...replies,
			fauxAssistantMessage(fauxToolCall("read", { path: "source.txt" })),
			fauxAssistantMessage("read completed"),
		]);
		await session.prompt("Probe UI methods, then read.");
		await session.waitForIdle();
		const toolResults = session.messages.filter((message) => message.role === "toolResult");
		expect(toolResults).toHaveLength(21);
		for (const result of toolResults.slice(0, 19)) {
			expect(result.isError).toBe(true);
			expect(JSON.stringify(result.content)).toContain("Drone Desktop does not support terminal");
		}
		expect(toolResults[19].isError).toBe(false);
		expect(toolResults[20].isError).toBe(false);
		expect(JSON.stringify(toolResults[20].content)).toContain("ordinary read after UI rejection");
		expect(results).toEqual({
			select: "A",
			confirm: true,
			input: "answer",
			theme: "truecolor",
			getAllThemes: [{ name: "drone-desktop", path: undefined }],
			getTheme: true,
			setTheme: { success: false, error: "Drone Desktop does not support terminal UI themes" },
		});
		expect(notices).toEqual([{ message: "official notification", severity: "warning" }]);
		expect(statuses).toEqual([
			{ key: "research", text: "live research" },
			{ key: "research", text: undefined },
		]);
		expect(hookErrors).toHaveLength(1);
		expect(hookErrors[0].error).toContain("setTitle");
		expect(await readFile(session.sessionFile, "utf8")).not.toContain("live research");
	} finally {
		asks.dispose();
		permission.dispose();
		if (session) await new SessionEngine().dispose(session);
		vi.restoreAllMocks();
		await rm(root, { recursive: true, force: true });
	}
}, 20000);
