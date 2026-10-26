import { mkdtemp, realpath, rm } from "node:fs/promises";
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
import { SessionEngine } from "../src/session-engine/engine";

it.each(["tool-abort", "shutdown-release", "shutdown-error"])(
	"closes a real SDK session when its %s handshake needs concurrent shutdown and abort",
	async (mode) => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "drone-shutdown-sdk-")));
		let session;
		let started;
		const toolStarted = new Promise((resolve) => {
			started = resolve;
		});
		let finishTool;
		const toolFinished = new Promise((resolve) => {
			finishTool = resolve;
		});
		let release;
		const shutdownRelease = new Promise((resolve) => {
			release = resolve;
		});
		const events = [];
		const extension = (pi) => {
			pi.registerTool({
				name: "shutdown_wait",
				label: "Shutdown wait",
				description: "Exercise a real cancellation and shutdown handshake",
				parameters: { type: "object", properties: {} },
				async execute(_id, _params, signal) {
					started();
					try {
						if (mode === "tool-abort")
							await new Promise((resolve) => {
								signal.addEventListener("abort", resolve, { once: true });
								if (signal.aborted) resolve();
							});
						else await shutdownRelease;
						events.push("tool-settled");
						return { content: [{ type: "text", text: "stopped" }] };
					} finally {
						finishTool();
					}
				},
			});
			pi.on("session_shutdown", async () => {
				events.push("shutdown-start");
				release();
				await toolFinished;
				events.push("shutdown-finished");
				if (mode === "shutdown-error") throw new Error("synthetic resource cleanup failed");
			});
		};
		try {
			const settingsManager = SettingsManager.inMemory({});
			const resourceLoader = new DefaultResourceLoader({
				cwd: root,
				agentDir: root,
				settingsManager,
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				extensionFactories: [extension],
			});
			await resourceLoader.reload({ resolveProjectTrust: async () => true });
			const modelRuntime = await ModelRuntime.create({
				authPath: join(root, "auth.json"),
				modelsPath: null,
				allowModelNetwork: false,
				refreshOnCreate: false,
			});
			const faux = fauxProvider({ provider: `shutdown-${mode}-offline`, tokensPerSecond: 0 });
			modelRuntime.registerNativeProvider(faux.provider);
			vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
			faux.setResponses([
				fauxAssistantMessage(fauxToolCall("shutdown_wait", {})),
				fauxAssistantMessage("done"),
			]);
			({ session } = await createAgentSession({
				cwd: root,
				agentDir: root,
				settingsManager,
				resourceLoader,
				modelRuntime,
				sessionManager: SessionManager.inMemory(root),
				model: faux.getModel(),
			}));
			await session.bindExtensions({});
			const sdkDispose = vi.spyOn(session, "dispose");
			const running = session.prompt("Exercise shutdown.");
			await toolStarted;
			const engine = new SessionEngine();
			const closing = engine.dispose(session);
			expect(engine.dispose(session)).toBe(closing);
			if (mode === "shutdown-error")
				await expect(closing).rejects.toMatchObject({
					message: "Session shutdown failed",
					errors: [
						expect.objectContaining({
							message: "Extension shutdown failed: synthetic resource cleanup failed",
						}),
					],
				});
			else await closing;
			await running;
			expect(events).toEqual(["shutdown-start", "tool-settled", "shutdown-finished"]);
			expect(sdkDispose).toHaveBeenCalledOnce();
			expect(session.isIdle).toBe(true);
		} finally {
			// Also make a regressed serial implementation releasable after test failure.
			release();
			if (session) {
				await session.abort();
				session.dispose();
			}
			vi.restoreAllMocks();
			await rm(root, { recursive: true, force: true });
		}
	},
	10000,
);
