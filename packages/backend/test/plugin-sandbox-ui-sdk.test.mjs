import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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
