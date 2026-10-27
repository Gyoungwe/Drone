import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { PiBackend } from "../src/pi-backend";

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
 pi.on("session_start",(_event,ctx)=>{ctx.ui.notify("startup notification","info");});
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
			await backend.closeSession(meta.sessionId);
			const closedCount = events.length;
			ui.notify("late closed context", "error");
			expect(events).toHaveLength(closedCount);
			const trace = await readFile(join(dir, "traces", `trace-${meta.sessionId}.jsonl`), "utf8");
			expect(trace).not.toContain('"type":"extension_notification"');
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
