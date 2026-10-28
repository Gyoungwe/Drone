import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { createBackend } from "../src/create-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";

let root, backend, bridge;
afterEach(async () => {
	if (bridge) await bridge.close();
	if (backend) await backend.dispose();
	bridge = undefined;
	backend = undefined;
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (root) await rm(root, { recursive: true, force: true });
});
const answer = (value) => ({ kind: "answer", mode: "submit", answers: { value: { values: [value] } } });
async function setup({ ui = true, isolated = false } = {}) {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-session-question-")));
	const cwd = join(root, "project"),
		agentDir = join(root, "agent");
	await mkdir(cwd);
	await mkdir(agentDir);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "session-question-offline", tokensPerSecond: 0 });
	runtime.registerNativeProvider(faux.provider);
	vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
	backend = createBackend({
		projectTrust: false,
		lazyCapabilities: false,
		permissionGates: ui,
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
		},
	});
	const service = backend.sessions;
	service.modelRuntime = runtime;
	const meta = await service.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id });
	const entry = service.registry.get(meta.sessionId),
		requests = [],
		resolved = [],
		accepted = [];
	const source = { pluginId: "question-client", packageRoot: root, entrypoint: join(root, "client.mjs") };
	if (isolated)
		await writeFile(
			source.entrypoint,
			`export default async()=>{
  const accepted=[];
  return {operations:{
   input:{effect:"write",inputSchema:{type:"object"},resultSchema:{type:"object"},execute:async(input,context)=>{const value=await context.capabilities.call("session.input",input);accepted.push(value);return value;}},
   snapshot:{effect:"read",inputSchema:{type:"null"},resultSchema:{type:"array"},execute:async()=>accepted}
  },dispose:async()=>{}};
 };`,
		);

	const owners = [1, 2].map((id) => ({ id, isDestroyed: () => false }));
	bridge = new PluginRuntimeBridge({
		source: () => source,
		enabled: () => true,
		approve: async () => true,
		getSessionContext: (id) => service.getPluginCallerContext(id),
		questionTransport: (owner) => ({
			ownerId: owner.id,
			send: (request) => {
				requests.push({ owner: owner.id, request });
				return true;
			},
			resolved: (result) => resolved.push({ owner: owner.id, ...result }),
		}),
		capabilities: () => ({ handlers: service.getPluginSessionCapabilities(), resources: [] }),
		factory: () =>
			isolated
				? createProcessPluginRuntime({
						...source,
						runtimeDirectory: resolve(
							import.meta.dirname,
							`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
						),
					})
				: async () => ({
						operations: Object.fromEntries(
							["select", "input", "confirm"].map((kind) => [
								kind,
								{
									effect: "write",
									inputSchema: { type: "object" },
									resultSchema: { type: "object" },
									execute: async (input, ctx) => {
										const result = await ctx.capabilities.call(`session.${kind}`, input);
										accepted.push(kind);
										return result;
									},
								},
							]),
						),
						dispose: async () => {},
					}),
	});
	const clients = await Promise.all(
		owners.map(async (owner) => ({
			owner,
			binding: await bridge.bind("question-client", owner),
			selection: bridge.selectSession(owner, meta.sessionId),
		})),
	);
	const invoke = (index, kind, input, requestId) => {
		const client = clients[index];
		return bridge.invoke(client.owner, client.binding, kind, input, client.selection, requestId);
	};
	return { service, entry, requests, resolved, accepted, owners, clients, invoke, faux };
}
it("calls real SDK select/input and AskGate-only confirm, targets the original window, and grants no tool permission", async () => {
	const { service, entry, requests, resolved, invoke, faux } = await setup();
	let pending = invoke(0, "select", { title: "Choose proposal", options: ["first", "second"] });
	await vi.waitFor(() => expect(requests).toHaveLength(1));
	expect(requests[0].owner).toBe(1);
	expect(requests[0].request.sessionId).toBe(entry.session.sessionId);
	expect(service.respondAsk(requests[0].request.id, answer("second"), 2)).toBe(false);
	expect(service.respondAsk(requests[0].request.id, answer("second"), 1)).toBe(true);
	await expect(pending).resolves.toEqual({ kind: "selected", value: "second" });
	pending = invoke(1, "input", { title: "Reason", placeholder: "Short explanation" });
	await vi.waitFor(() => expect(requests).toHaveLength(2));
	service.respondAsk(
		requests[1].request.id,
		{ kind: "answer", answers: { value: { customText: "Synthetic reason" } } },
		2,
	);
	await expect(pending).resolves.toEqual({ kind: "input", value: "Synthetic reason" });
	const permissions = [];
	const stop = backend.approvals.onRequest((request) => permissions.push(request));
	pending = invoke(0, "confirm", { title: "Confirm proposal", message: "Ordinary choice only" });
	await vi.waitFor(() => expect(requests).toHaveLength(3));
	expect(permissions).toHaveLength(0);
	service.respondAsk(requests[2].request.id, answer(requests[2].request.questions[0].options[0].value), 1);
	await expect(pending).resolves.toEqual({ kind: "confirmed", value: true });
	const gate = backend.approvals.getGate(entry.session.sessionId);
	expect(gate.isRunAllowed()).toBe(false);
	const actualPermission = gate.confirm("Confirm proposal", "A real execution permission");
	expect(permissions).toHaveLength(1);
	backend.approvals.respond(permissions[0].id, "deny");
	await expect(actualPermission).resolves.toBe(false);
	expect(resolved).toHaveLength(3);
	expect(faux.state.callCount).toBe(0);
	stop();
});
it("keeps concurrent same-session windows isolated; cancellation removes the same pending and rejects late replies", async () => {
	const { service, requests, resolved, accepted, clients, invoke } = await setup();
	const a = invoke(0, "select", { title: "Window A", options: ["A"] }, "A-request").catch((error) => error);
	const b = invoke(1, "select", { title: "Window B", options: ["B"] }, "B-request");
	await vi.waitFor(() => expect(requests).toHaveLength(2));
	const requestA = requests.find((value) => value.owner === 1).request,
		requestB = requests.find((value) => value.owner === 2).request;
	expect(service.respondAsk(requestA.id, answer("A"), 2)).toBe(false);
	await expect(
		bridge.cancel(clients[0].owner, clients[0].binding, clients[0].selection, "A-request"),
	).resolves.toBe(true);
	expect(await a).toMatchObject({ message: "Plugin invocation canceled" });
	expect(resolved).toContainEqual({ owner: 1, sessionId: requestA.sessionId, requestId: requestA.id });
	expect(service.respondAsk(requestA.id, answer("A"), 1)).toBe(false);
	expect(accepted).toHaveLength(0);
	service.respondAsk(requestB.id, answer("B"), 2);
	await expect(b).resolves.toEqual({ kind: "selected", value: "B" });
	expect(accepted).toEqual(["select"]);
	const stale = invoke(0, "input", { title: "Original generation" }, "stale").catch((error) => error);
	await vi.waitFor(() => expect(requests).toHaveLength(3));
	const priorResolved = resolved.length;
	expect(service.respondAsk(requestA.id, answer("A"), 1)).toBe(false);
	expect(resolved).toHaveLength(priorResolved);
	expect(requests[2].request.id).not.toBe(requestA.id);
	bridge.selectSession(clients[0].owner, null);
	expect(await stale).toBeInstanceOf(Error);
	expect(
		service.respondAsk(
			requests[2].request.id,
			{ kind: "answer", answers: { value: { customText: "late" } } },
			1,
		),
	).toBe(false);
	expect(accepted).toEqual(["select"]);
	const closing = invoke(1, "input", { title: "Before actual session close" }).catch((error) => error);
	await vi.waitFor(() => expect(requests).toHaveLength(4));
	await service.closeSession(requestB.sessionId);
	expect(await closing).toBeInstanceOf(Error);
	expect(
		service.respondAsk(
			requests[3].request.id,
			{ kind: "answer", answers: { value: { customText: "closed" } } },
			2,
		),
	).toBe(false);
	expect(accepted).toEqual(["select"]);
});
it("cannot borrow PermissionGate allowRun or allowAlways for ordinary confirmations", async () => {
	const { service, entry, requests, invoke } = await setup();
	const permissions = [];
	backend.approvals.onRequest((request) => permissions.push(request));
	const gate = backend.approvals.getGate(entry.session.sessionId);
	let permission = gate.confirm("Repeated title", "Real permission");
	backend.approvals.respond(permissions[0].id, "allowRun");
	await permission;
	let pending = invoke(0, "confirm", { title: "Repeated title", message: "Still a question" });
	await vi.waitFor(() => expect(requests).toHaveLength(1));
	service.respondAsk(requests[0].request.id, { kind: "cancel" }, 1);
	await expect(pending).resolves.toEqual({ kind: "cancelled" });
	gate.endRun();
	permission = gate.confirm("Repeated title", "Real permission");
	backend.approvals.respond(permissions[1].id, "allowAlways");
	await permission;
	pending = invoke(0, "confirm", { title: "Repeated title", message: "Still not authorization" });
	await vi.waitFor(() => expect(requests).toHaveLength(2));
	service.respondAsk(requests[1].request.id, answer(requests[1].request.questions[0].options[1].value), 1);
	await expect(pending).resolves.toEqual({ kind: "confirmed", value: false });
	expect(permissions).toHaveLength(2);
});
it("rejects readonly and untrusted callers, revokes a waiting readonly answer, and rejects application scope", async () => {
	const { entry, requests, clients, invoke } = await setup();
	entry.readOnly = true;
	await expect(invoke(0, "input", { title: "Readonly" })).rejects.toThrow(/denied/);
	entry.readOnly = false;
	entry.session.settingsManager.setProjectTrusted(false);
	await expect(invoke(0, "input", { title: "Untrusted" })).rejects.toThrow(/denied/);
	entry.session.settingsManager.setProjectTrusted(true);
	const waiting = invoke(0, "input", { title: "Becomes readonly while waiting" }).catch((error) => error);
	await vi.waitFor(() => expect(requests).toHaveLength(1));
	entry.readOnly = true;
	backend.sessions.respondAsk(
		requests[0].request.id,
		{ kind: "answer", answers: { value: { customText: "stale permission" } } },
		1,
	);
	expect(await waiting).toMatchObject({ message: "Session questions require a writable trusted session" });
	entry.readOnly = false;
	clients[0].selection = bridge.selectSession(clients[0].owner, null);
	await expect(invoke(0, "input", { title: "No session" })).rejects.toThrow(/live session/);
	expect(requests).toHaveLength(1);
});
it("does not invent UI for an actual SDK session without a bound UI context", async () => {
	const { requests, invoke } = await setup({ ui: false });
	await expect(invoke(0, "select", { title: "No UI", options: ["x"] })).rejects.toThrow(/UI is unavailable/);
	expect(requests).toHaveLength(0);
});

it("rejects an answer from a real SDK UI context replaced by reload", async () => {
	const { service, entry, requests, accepted, invoke } = await setup();
	expect(entry.session.extensionRunner.createContext().signal).toBeUndefined();
	const pending = invoke(0, "input", { title: "Before SDK reload" }).catch((error) => error);
	await vi.waitFor(() => expect(requests).toHaveLength(1));
	await entry.session.reload();
	service.respondAsk(
		requests[0].request.id,
		{ kind: "answer", answers: { value: { customText: "old context" } } },
		1,
	);
	expect(await pending).toMatchObject({ message: "Session question SDK context was reloaded" });
	expect(accepted).toHaveLength(0);
});

it("uses the actual active SDK signal to cancel its existing AskGate pending", async () => {
	const { service, entry, requests, accepted, invoke, faux } = await setup();
	let release;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	faux.setResponses([
		async () => {
			await held;
			return fauxAssistantMessage("Released synthetic response");
		},
	]);
	await service.prompt(entry.session.sessionId, "Hold a synthetic response");
	await vi.waitFor(() => expect(entry.session.isStreaming).toBe(true));
	const actualSignal = entry.session.extensionRunner.createContext().signal;
	expect(actualSignal).toBeInstanceOf(AbortSignal);
	const pending = invoke(0, "input", { title: "During actual SDK run" }).catch((error) => error);
	try {
		await vi.waitFor(() => expect(requests).toHaveLength(1));
		const stopping = service.abort(entry.session.sessionId);
		release();
		await stopping;
		expect(actualSignal.aborted).toBe(true);
		expect(await pending).toBeInstanceOf(Error);
		expect(
			service.respondAsk(
				requests[0].request.id,
				{ kind: "answer", answers: { value: { customText: "late" } } },
				1,
			),
		).toBe(false);
		expect(accepted).toHaveLength(0);
	} finally {
		release();
		await entry.session.waitForIdle();
	}
});

it("preserves legitimate empty and whitespace input through the real SDK binding and AskGate", async () => {
	const { service, requests, invoke } = await setup();
	for (const value of ["", "  exact user input  "]) {
		const pending = invoke(0, "input", { title: "Native input permits empty text" });
		await vi.waitFor(() => expect(requests).toHaveLength(value === "" ? 1 : 2));
		const request = requests.at(-1).request;
		expect(request.questions[0]).toMatchObject({ type: "text", required: false });
		service.respondAsk(request.id, { kind: "answer", answers: { value: { customText: value } } }, 1);
		await expect(pending).resolves.toEqual({ kind: "input", value });
	}
	const cancelled = invoke(0, "input", { title: "Actual cancellation" });
	await vi.waitFor(() => expect(requests).toHaveLength(3));
	service.respondAsk(requests[2].request.id, { kind: "cancel" }, 1);
	await expect(cancelled).resolves.toEqual({ kind: "cancelled" });
});

it("round-trips real answers and cancellation through the restricted production worker without a second question ledger", async () => {
	const { service, requests, clients, invoke } = await setup({ isolated: true });
	const pending = invoke(0, "input", { title: "Restricted worker asks" });
	await vi.waitFor(() => expect(requests).toHaveLength(1));
	service.respondAsk(requests[0].request.id, { kind: "answer", answers: { value: { customText: "" } } }, 1);
	await expect(pending).resolves.toEqual({ kind: "input", value: "" });
	const stopped = invoke(1, "input", { title: "Restricted worker cancelled" }, "worker-question").catch(
		(error) => error,
	);
	await vi.waitFor(() => expect(requests).toHaveLength(2));
	await bridge.cancel(clients[1].owner, clients[1].binding, clients[1].selection, "worker-question");
	expect(await stopped).toBeInstanceOf(Error);
	expect(
		service.respondAsk(
			requests[1].request.id,
			{ kind: "answer", answers: { value: { customText: "late" } } },
			2,
		),
	).toBe(false);
	const client = clients[0];
	await expect(
		bridge.invoke(client.owner, client.binding, "snapshot", null, client.selection),
	).resolves.toEqual([{ kind: "input", value: "" }]);
}, 20000);
