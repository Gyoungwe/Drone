import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { ApprovalService } from "../src/services/approvals";
import { makeUiContext } from "../src/session/ui-context";
import { SessionEngine } from "../src/session-engine/engine";
import { sandboxExtensionFactory } from "../src/session-engine/sandbox-loader";

const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);
const source = `export default pi => pi.registerTool({
 name:"ui_probe", label:"UI probe", description:"Exercise official Pi UI primitives", parameters:{type:"object",properties:{}},
 async execute(_id,_params,_signal,_update,ctx) {
   if(!ctx.hasUI) throw new Error("interactive UI required");
   if(!await ctx.ui.confirm("Research consent","Allow synthetic read?")) return {content:[{type:"text",text:"denied"}]};
   const selected=await ctx.ui.select("Method",["synthetic-a","synthetic-b"]);
   const entered=await ctx.ui.input("Label","example");
   ctx.ui.notify("synthetic-complete","info");
   return {content:[{type:"text",text:JSON.stringify({selected,entered,pid:process.pid})}]};
 }
});`;

it("the real SDK receives truthful Desktop UI refusals and continues with read", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-ui-refusal-sdk-")));
	const agentDir = join(root, "agent");
	await mkdir(agentDir);
	await writeFile(join(root, "evidence.txt"), "local evidence remains readable");
	let session;
	try {
		const settingsManager = SettingsManager.inMemory({});
		const resourceLoader = new DefaultResourceLoader({
			cwd: root,
			agentDir,
			settingsManager,
			noExtensions: true,
			extensionFactories: [
				(pi) => {
					pi.registerTool({
						name: "custom_probe",
						label: "Custom probe",
						description: "Try terminal custom UI",
						parameters: { type: "object", properties: {} },
						async execute(_id, _input, _signal, _update, ctx) {
							await ctx.ui.custom(() => {
								throw new Error("Terminal component must not run");
							});
							return { content: [{ type: "text", text: "custom completed" }] };
						},
					});
					pi.registerTool({
						name: "theme_probe",
						label: "Theme probe",
						description: "Try terminal theme change",
						parameters: { type: "object", properties: {} },
						async execute(_id, _input, _signal, _update, ctx) {
							return { content: [{ type: "text", text: JSON.stringify(ctx.ui.setTheme("solarized")) }] };
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
		const faux = fauxProvider({ provider: "desktop-ui-refusal-offline", tokensPerSecond: 0 });
		modelRuntime.registerNativeProvider(faux.provider);
		vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
		faux.setResponses([
			fauxAssistantMessage(fauxToolCall("custom_probe", {})),
			fauxAssistantMessage(fauxToolCall("theme_probe", {})),
			fauxAssistantMessage(fauxToolCall("read", { path: "evidence.txt" })),
			fauxAssistantMessage("read still works"),
		]);
		({ session } = await createAgentSession({
			cwd: root,
			agentDir,
			settingsManager,
			resourceLoader,
			modelRuntime,
			sessionManager: SessionManager.inMemory(root),
			model: faux.getModel(),
		}));
		await session.bindExtensions({ uiContext: makeUiContext({ confirm: async () => false }), mode: "tui" });
		await session.prompt("Try the UI probes, then read local evidence.");
		await session.waitForIdle();
		const results = session.messages.filter((message) => message.role === "toolResult");
		const custom = results.find((message) => message.toolName === "custom_probe");
		expect(custom.isError).toBe(true);
		expect(JSON.stringify(custom.content)).toContain("Drone Desktop does not support terminal custom UI");
		const theme = results.find((message) => message.toolName === "theme_probe");
		expect(JSON.parse(theme.content[0].text)).toMatchObject({ success: false });
		const read = results.find((message) => message.toolName === "read");
		expect(read.isError).toBe(false);
		expect(JSON.stringify(read.content)).toContain("local evidence remains readable");
	} finally {
		if (session) await new SessionEngine().dispose(session);
		vi.restoreAllMocks();
		await rm(root, { recursive: true, force: true });
	}
}, 20000);

it.each(["native", "sandbox"])(
	"same official Pi extension completes a real %s AgentSession UI/tool loop",
	async (mode) => {
		if (mode === "sandbox" && !existsSync(join(runtimeDirectory, "runtime.json")))
			throw new Error("Stage the packaged plugin runtime to run the SDK acceptance");
		const root = await realpath(await mkdtemp(join(tmpdir(), "drone-ui-sdk-")));
		const agentDir = join(root, "agent");
		await mkdir(agentDir);
		const entrypoint = join(root, "extension.mjs");
		await writeFile(entrypoint, source);
		let session;
		let workerPid;
		const ui = {
			confirm: vi.fn(async () => true),
			select: vi.fn(async () => "synthetic-b"),
			input: vi.fn(async () => "test-label"),
			notify: vi.fn(),
		};
		try {
			const settingsManager = SettingsManager.inMemory({});
			const resourceLoader = new DefaultResourceLoader({
				cwd: root,
				agentDir,
				settingsManager,
				noExtensions: true,
				additionalExtensionPaths: [entrypoint],
				...(mode === "sandbox"
					? { extensionFactoryForPath: sandboxExtensionFactory(runtimeDirectory, [], root) }
					: {}),
			});
			await resourceLoader.reload({ resolveProjectTrust: async () => true });
			expect(resourceLoader.getExtensions().errors).toEqual([]);
			const modelRuntime = await ModelRuntime.create({
				authPath: join(agentDir, "auth.json"),
				modelsPath: null,
				allowModelNetwork: false,
				refreshOnCreate: false,
			});
			const faux = fauxProvider({ provider: `ui-${mode}-offline`, tokensPerSecond: 0 });
			modelRuntime.registerNativeProvider(faux.provider);
			vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
			faux.setResponses([
				fauxAssistantMessage(fauxToolCall("ui_probe", {})),
				fauxAssistantMessage("verified"),
			]);
			({ session } = await createAgentSession({
				cwd: root,
				agentDir,
				settingsManager,
				resourceLoader,
				modelRuntime,
				sessionManager: SessionManager.inMemory(root),
				model: faux.getModel(),
			}));
			await session.bindExtensions({ uiContext: ui });
			expect(session.getActiveToolNames()).toContain("ui_probe");
			await session.prompt("Run the synthetic UI probe.");
			await session.waitForIdle();
			const result = session.messages.find(
				(message) => message.role === "toolResult" && message.toolName === "ui_probe",
			);
			expect(result?.isError, JSON.stringify(result)).toBe(false);
			const details = JSON.parse(result.content[0].text);
			expect(details).toMatchObject({ selected: "synthetic-b", entered: "test-label" });
			expect(ui.confirm.mock.calls.some(([title]) => title === "Research consent")).toBe(true);
			expect(ui.select.mock.calls[0].slice(0, 2)).toEqual(["Method", ["synthetic-a", "synthetic-b"]]);
			expect(ui.input.mock.calls[0].slice(0, 2)).toEqual(["Label", "example"]);
			expect(ui.notify).toHaveBeenCalledWith("synthetic-complete", "info");
			if (mode === "sandbox") {
				workerPid = details.pid;
				expect(workerPid).not.toBe(process.pid);
				expect(ui.confirm).toHaveBeenCalledTimes(2);
			} else expect(details.pid).toBe(process.pid);
			expect(
				session.messages.some(
					(message) =>
						message.role === "assistant" &&
						message.content.some((part) => part.type === "text" && part.text === "verified"),
				),
			).toBe(true);
		} finally {
			if (session) await new SessionEngine().dispose(session);
			if (workerPid)
				await vi.waitFor(() => expect(() => process.kill(workerPid, 0)).toThrow(), { timeout: 3000 });
			vi.restoreAllMocks();
			await rm(root, { recursive: true, force: true });
		}
	},
	20000,
);

it("real Desktop approval signal authorizes a real sandbox network tool and an ordinary SDK read", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-desktop-sandbox-confirm-")));
	const agentDir = join(root, "agent");
	await mkdir(agentDir);
	await writeFile(join(root, "evidence.txt"), "read after sandbox network permission");
	const server = createServer((_request, response) => {
		response.end("synthetic local research data");
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${server.address().port}/synthetic`;
	const entrypoint = join(root, "network-extension.mjs");
	await writeFile(
		entrypoint,
		`export default pi=>pi.registerTool({name:"network_probe",label:"Network probe",description:"Fetch synthetic local data",parameters:{type:"object",properties:{}},async execute(_id,_params,signal,_update,ctx){if(!await ctx.ui.confirm("Synthetic tool consent","Allow test request?",{signal}))throw new Error("Synthetic consent denied");const response=await fetch(${JSON.stringify(url)});return{content:[{type:"text",text:JSON.stringify({text:await response.text(),pid:process.pid})}]};}});`,
	);
	const approvals = new ApprovalService();
	const gate = approvals.createGate();
	const requests = [],
		resolved = [];
	approvals.onRequest((request) => {
		requests.push(request);
		queueMicrotask(() => approvals.respond(request.id, "allow"));
	});
	approvals.onResolved((result) => resolved.push(result));
	let session, workerPid;
	try {
		const settingsManager = SettingsManager.inMemory({});
		const resourceLoader = new DefaultResourceLoader({
			cwd: root,
			agentDir,
			settingsManager,
			noExtensions: true,
			additionalExtensionPaths: [entrypoint],
			extensionFactoryForPath: sandboxExtensionFactory(runtimeDirectory, [], root),
		});
		await resourceLoader.reload({ resolveProjectTrust: async () => true });
		expect(resourceLoader.getExtensions().errors).toEqual([]);
		const modelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: null,
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		const faux = fauxProvider({ provider: "desktop-real-permission-offline", tokensPerSecond: 0 });
		modelRuntime.registerNativeProvider(faux.provider);
		vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
		({ session } = await createAgentSession({
			cwd: root,
			agentDir,
			settingsManager,
			resourceLoader,
			modelRuntime,
			sessionManager: SessionManager.inMemory(root),
			model: faux.getModel(),
		}));
		gate.bindSession(session.sessionId);
		approvals.register(session.sessionId, gate);
		await session.bindExtensions({ mode: "rpc", uiContext: makeUiContext(gate) });
		faux.setResponses([
			fauxAssistantMessage(fauxToolCall("network_probe", {})),
			fauxAssistantMessage(fauxToolCall("read", { path: "evidence.txt" })),
			fauxAssistantMessage("Done"),
		]);
		await session.prompt("Fetch synthetic data and read evidence.");
		await session.waitForIdle();
		const toolResult = session.messages.find(
			(message) => message.role === "toolResult" && message.toolName === "network_probe",
		);
		expect(toolResult?.isError, JSON.stringify(toolResult)).toBe(false);
		const details = JSON.parse(toolResult.content[0].text);
		expect(details.text).toBe("synthetic local research data");
		workerPid = details.pid;
		expect(workerPid).not.toBe(process.pid);
		expect(requests).toHaveLength(2);
		expect(requests[1].title).toBe("Synthetic tool consent");
		expect(resolved).toEqual(
			requests.map((request) => ({ sessionId: session.sessionId, requestId: request.id, answered: true })),
		);
		expect(approvals.listPending()).toEqual([]);
		expect(
			session.messages.some(
				(message) => message.role === "toolResult" && message.toolName === "read" && !message.isError,
			),
		).toBe(true);
	} finally {
		if (session) await new SessionEngine().dispose(session);
		if (workerPid)
			await vi.waitFor(() => expect(() => process.kill(workerPid, 0)).toThrow(), { timeout: 3000 });
		approvals.dispose();
		await new Promise((resolve) => server.close(resolve));
		vi.restoreAllMocks();
		await rm(root, { recursive: true, force: true });
	}
}, 20000);
