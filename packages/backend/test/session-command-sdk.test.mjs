import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { createBackend } from "../src/create-backend";
import { inboxFor, inboxPath } from "../src/session/durable-inbox";

const roots = [],
	backends = [];
afterEach(async () => {
	for (const backend of backends.splice(0)) await backend.dispose();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-session-command-")));
	roots.push(root);
	const cwd = join(root, "project"),
		agentDir = join(root, "agent"),
		extensionPath = join(root, "commands.mjs");
	await mkdir(cwd);
	await mkdir(agentDir);
	const extension = `import {mkdirSync} from "node:fs";
 export default pi => {
  pi.on("input", (event) => {
   if(event.text.startsWith("local storage-failure ")) {
    mkdirSync(event.text.slice("local storage-failure ".length));
    return {action:"handled"};
   }
   if(event.text === "local summary") {
    pi.appendEntry("local-summary", {local:true});
    return {action:"handled"};
   }
   return {action:"continue"};
  });
  pi.registerCommand("record", { description:"Record exact command scope", handler:async (args,ctx) => {
   if(args === "fail") throw new Error("Synthetic command failed");
   if(args === "wait") await ctx.waitForIdle();
   if(args === "select" && (await ctx.ui.select("Command permission", ["allow"], {signal:ctx.signal}) !== "allow" || ctx.signal?.aborted)) return;
   pi.appendEntry("command-record", {args,cwd:ctx.cwd});
  }});
 };`;
	await writeFile(extensionPath, extension);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "knowledge"));
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "session-command-offline", tokensPerSecond: 0 });
	runtime.registerNativeProvider(faux.provider);
	vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
	const backend = createBackend({
		projectTrust: false,
		lazyCapabilities: false,
		webFetch: false,
		subagentPreferBuiltin: false,
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalExtensionPaths: [extensionPath],
			additionalSkillPaths: [],
		},
	});
	backends.push(backend);
	const service = backend.sessions;
	service.modelRuntime = runtime;
	const meta = await service.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id });
	const session = service.registry.get(meta.sessionId).session;
	return { root, cwd, extensionPath, extension, service, session, meta, faux };
}
it("rejects missing and reloaded-away commands before any model request; actual handler errors reject and diagnose once", async () => {
	const { service, session, meta, faux, extensionPath } = await setup();
	await expect(service.command(meta.sessionId, "task-action", "stale UI input")).rejects.toThrow(
		"Extension command unavailable: task-action",
	);
	expect(faux.state.callCount).toBe(0);
	const errors = [];
	const stop = session.extensionRunner.onError((error) => errors.push(error));
	await expect(service.command(meta.sessionId, "record", "fail")).rejects.toThrow("Synthetic command failed");
	expect(errors).toMatchObject([
		{ event: "command", extensionPath: "command:record", error: "Synthetic command failed" },
	]);
	stop();
	await rm(extensionPath);
	await session.reload();
	await expect(service.command(meta.sessionId, "record", "after reload")).rejects.toThrow(
		"Extension command unavailable: record",
	);
	expect(faux.state.callCount).toBe(0);
}, 20000);

it("dispatches to the exact real session and preserves read-only, recovery, and revoked-entry boundaries", async () => {
	const { root, cwd, service, session, meta, faux } = await setup();
	const secondCwd = join(root, "second");
	await mkdir(secondCwd);
	const second = await service.createSession({
		cwd: secondCwd,
		provider: faux.provider.id,
		modelId: faux.getModel().id,
	});
	await expect(service.command(second.sessionId, "record", "second only")).resolves.toEqual({
		kind: "command",
	});
	expect(service.registry.get(second.sessionId).session.sessionManager.getEntries()).toContainEqual(
		expect.objectContaining({
			type: "custom",
			customType: "command-record",
			data: { args: "second only", cwd: secondCwd },
		}),
	);
	expect(JSON.stringify(session.sessionManager.getEntries())).not.toContain("second only");
	const entry = service.registry.get(meta.sessionId);
	entry.readOnly = true;
	await expect(service.command(meta.sessionId, "record", "read only")).rejects.toThrow("read-only");
	entry.readOnly = false;
	const recovery = vi.spyOn(service.recovery, "isRecovering").mockReturnValue(true);
	await expect(service.command(meta.sessionId, "record", "recovering")).rejects.toThrow("recovery");
	recovery.mockRestore();
	service.registry.revoke(meta.sessionId);
	await expect(service.command(meta.sessionId, "record", "revoked")).rejects.toThrow("revoked");
	expect(faux.state.callCount).toBe(0);
	expect(cwd).not.toBe(secondCwd);
}, 20000);

it("cancel and close revoke a command paused on the SDK idle boundary before it appends", async () => {
	const { service, session, meta, faux } = await setup();
	const cancelled = service.command(meta.sessionId, "record", "wait").catch((error) => error);
	await service.abort(meta.sessionId);
	expect(await cancelled).toMatchObject({ message: "Session command cancelled" });
	expect(JSON.stringify(session.sessionManager.getEntries())).not.toContain('"args":"wait"');
	const closing = service.command(meta.sessionId, "record", "wait").catch((error) => error);
	await service.closeSession(meta.sessionId);
	expect(await closing).toMatchObject({ message: "Session caller revoked" });
	expect(faux.state.callCount).toBe(0);
}, 20000);

it("cancel removes a pending real command question and prevents its late answer from committing", async () => {
	const { service, session, meta, faux } = await setup();
	let request;
	service.onAskRequest((value) => {
		request = value;
	});
	const result = service.command(meta.sessionId, "record", "select").catch((error) => error);
	await vi.waitFor(() => expect(request).toBeTruthy());
	await service.abort(meta.sessionId);
	service.respondAsk(request.id, {
		kind: "answer",
		mode: "submit",
		answers: { value: { values: ["allow"] } },
	});
	expect(await result).toMatchObject({ message: "Session command cancelled" });
	expect(JSON.stringify(session.sessionManager.getEntries())).not.toContain('"args":"select"');
	expect(faux.state.callCount).toBe(0);
}, 20000);

it("reports actual input interception without a model run or a durable queued replay", async () => {
	const { service, session, meta, faux } = await setup();
	expect(await service.prompt(meta.sessionId, "local summary")).toEqual({ kind: "command" });
	expect(faux.state.callCount).toBe(0);
	let release;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	faux.setResponses([
		async () => {
			await held;
			return fauxAssistantMessage("Finished background answer");
		},
	]);
	expect(await service.prompt(meta.sessionId, "Start background answer")).toEqual({ kind: "agent" });
	await vi.waitFor(() => expect(session.isStreaming && faux.state.callCount === 1).toBe(true));
	expect(await service.prompt(meta.sessionId, "local summary", undefined, "intercepted-summary")).toEqual({
		kind: "command",
	});
	expect(faux.state.callCount).toBe(1);
	expect(inboxFor(session.sessionFile).pending()).toEqual([]);
	expect(session.getFollowUpMessages()).toEqual([]);
	release();
	await session.waitForIdle();
	expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
}, 20000);

it("rejects the real handled receipt when durable queue reconciliation cannot be saved", async () => {
	const { service, session, meta, faux } = await setup();
	let release;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	faux.setResponses([
		async () => {
			await held;
			return fauxAssistantMessage("Background response");
		},
	]);
	await service.prompt(meta.sessionId, "Start held background response");
	await vi.waitFor(() => expect(session.isStreaming && faux.state.callCount === 1).toBe(true));
	const path = inboxPath(session.sessionFile);
	const obstruction = path + "." + process.pid + ".tmp";
	try {
		await expect(
			service.prompt(
				meta.sessionId,
				"local storage-failure " + obstruction,
				undefined,
				"handled-storage-failure",
			),
		).rejects.toMatchObject({ code: "EISDIR" });
		expect(JSON.parse(await readFile(path, "utf8")).queued.map((item) => item.requestId)).toContain(
			"handled-storage-failure",
		);
	} finally {
		await rm(obstruction, { recursive: true, force: true });
		release();
		await session.waitForIdle();
	}
}, 20000);
