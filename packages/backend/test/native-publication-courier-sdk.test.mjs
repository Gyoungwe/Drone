import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";
import { canonicalProjectId } from "../src/project-id";
import { SessionEngine } from "../src/session-engine/engine";

const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);
const source = `export default async({events})=>({operations:{},async dispose(){},createNativeSession(){
 const proofs=new WeakSet();let disposed=false;
 const valid=message=>proofs.has(message.liveProof)&&message.content[0]?.text==='checked owner result';
 const project=message=>valid(message)?message:{...message,content:[{type:'text',text:'blocked owner result'}]};
 return {extension(){},projection:{finalizeEffect:'read',async finalize(event,context){
  context.signal.throwIfAborted();
  if(context.scope.kind!=='session')throw new Error('actual session scope required');
  const proof={id:'visible-proof-id'};proofs.add(proof);
  return {...event,message:{...event.message,content:[{type:'text',text:'checked owner result'}],liveProof:proof}};
 },async event(event,signal){
  if(event.type==='held'){
   events.changed();
   await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
   await new Promise(resolve=>setImmediate(resolve));
   events.changed();
  }
  if(disposed)throw new Error('owner disposed');return {...event,message:project(event.message)};},snapshot(messages,persisted){return messages.map(message=>persisted.includes(message)?message:project(message));}},async dispose(){disposed=true;}};
}});`;

it("executes real owner WeakSet projection across a restricted worker and the actual pinned SDK fence", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-publication-courier-")));
	const sessions = [],
		natives = [];
	let runtime, markProjectionEntered;
	let changes = 0;
	try {
		const pkg = join(root, "package");
		await mkdir(pkg);
		const entrypoint = join(pkg, "runtime.mjs");
		await writeFile(entrypoint, source);
		runtime = await createProcessPluginRuntime({
			pluginId: "courier-proof-fixture",
			packageRoot: pkg,
			entrypoint,
			runtimeDirectory,
		})({
			applicationId: "courier-proof-app",
			signal: new AbortController().signal,
			resources: [],
			capabilities: {
				async call() {
					throw new Error("No capability granted");
				},
			},
			events: {
				changed() {
					changes++;
					markProjectionEntered?.();
				},
			},
		});
		const native = await runtime.createNativeSession();
		natives.push(native);
		const settingsManager = SettingsManager.inMemory({});
		const resourceLoader = new DefaultResourceLoader({
			cwd: root,
			agentDir: root,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			extensionFactories: [native.extension],
		});
		await resourceLoader.reload({ resolveProjectTrust: async () => true });
		expect(resourceLoader.getExtensions().errors).toEqual([]);
		const modelRuntime = await ModelRuntime.create({
			authPath: join(root, "auth.json"),
			modelsPath: null,
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		const faux = fauxProvider({ provider: "owner-courier-offline", tokensPerSecond: 0 });
		modelRuntime.registerNativeProvider(faux.provider);
		await modelRuntime.setRuntimeApiKey(faux.provider.id, "synthetic-offline-key");
		faux.setResponses([fauxAssistantMessage("UNRELEASED_WORKER_DRAFT")]);
		let session;
		({ session } = await createAgentSession({
			cwd: root,
			agentDir: root,
			settingsManager,
			resourceLoader,
			modelRuntime,
			model: faux.getModel(),
			tools: [],
			sessionManager: SessionManager.inMemory(root),
			hostDeliveryBoundary: async (event, signal) => {
				const result = await native.projection.finalize(event, {
					scope: {
						kind: "session",
						workspaceId: canonicalProjectId(root),
						workspaceDirectory: root,
						sessionId: session.sessionId,
					},
					signal,
					capabilities: {
						async call() {
							throw new Error("No capability granted");
						},
					},
				});
				for (const key of Object.keys(event.message)) delete event.message[key];
				Object.assign(event.message, result.message);
				const projected = await native.projection.event(event);
				expect(projected.message.content[0].text).toBe("checked owner result");
			},
		}));
		sessions.push(session);
		await session.bindExtensions({});
		await session.prompt("Synthetic owner-local publication.");
		const message = session.messages.find((message) => message.role === "assistant");
		expect(message.content[0].text).toBe("checked owner result");
		expect((await native.projection.event({ type: "message_end", message })).message.content[0].text).toBe(
			"checked owner result",
		);
		expect((await native.projection.snapshot([message], []))[0].content[0].text).toBe("checked owner result");
		const controller = new AbortController();
		const entered = new Promise((resolve) => {
			markProjectionEntered = resolve;
		});
		const held = native.projection.event({ type: "held", message }, controller.signal);
		const cancelled = expect(held).rejects.toThrow();
		await entered;
		expect((await native.projection.event({ type: "message_end", message })).message.content[0].text).toBe(
			"checked owner result",
		);
		controller.abort();
		await cancelled;
		expect(changes).toBe(2); // The real worker's abort cleanup completed before the parent rejection.
		expect((await native.projection.snapshot([message], []))[0].content[0].text).toBe("checked owner result");
		expect(Object.keys(message)).not.toContain("references");
		expect(Object.keys(message)).not.toContain("signal");
		const copy = structuredClone(message);
		copy.reference = "1";
		expect(
			(await native.projection.event({ type: "message_end", message: copy })).message.content[0].text,
		).toBe("blocked owner result");
		const other = await runtime.createNativeSession();
		natives.push(other);
		expect((await other.projection.event({ type: "message_end", message })).message.content[0].text).toBe(
			"blocked owner result",
		);
		const originalContent = message.content;
		message.content = [{ type: "text", text: "tampered same actual SDK object" }];
		expect((await native.projection.event({ type: "message_end", message })).message.content[0].text).toBe(
			"blocked owner result",
		);
		message.content = originalContent;
		await session.reload();
		const historyNative = await runtime.createNativeSession();
		natives.push(historyNative);
		const restored = session.messages.find((value) => value.role === "assistant");
		const engine = new SessionEngine();
		expect(engine.historicalMessageOrigin(session, restored)).toBeDefined();
		const stranger = structuredClone(restored);
		expect(engine.historicalMessageOrigin(session, stranger)).toBeUndefined();
		const trustedPersisted = [restored].filter((value) => engine.historicalMessageOrigin(session, value));
		expect(
			(await historyNative.projection.snapshot([restored, stranger], trustedPersisted)).map(
				(value) => value.content[0].text,
			),
		).toEqual(["checked owner result", "blocked owner result"]);
		// A genuine historical alias grants display only, never this attachment's live WeakSet proof.
		expect(
			(await historyNative.projection.event({ type: "message_end", message: restored })).message.content[0]
				.text,
		).toBe("blocked owner result");
		const user = session.sessionManager
			.getBranch()
			.find((entry) => entry.type === "message" && entry.message.role === "user");
		session.sessionManager.branch(user.id);
		session.refreshContext();
		expect(engine.historicalMessageOrigin(session, restored)).toBeUndefined();
		expect((await historyNative.projection.snapshot([restored], [])).at(0).content[0].text).toBe(
			"blocked owner result",
		);

		await native.dispose();
		await expect(
			Promise.resolve().then(() => native.projection.event({ type: "message_end", message })),
		).rejects.toThrow("Native attachment closed");
		expect(JSON.stringify(session.sessionManager.getBranch())).not.toContain("UNRELEASED_WORKER_DRAFT");
	} finally {
		for (const session of sessions) await new SessionEngine().dispose(session);
		for (const native of natives) await native.dispose();
		if (runtime) await runtime.dispose();
		await rm(root, { recursive: true, force: true });
	}
});
