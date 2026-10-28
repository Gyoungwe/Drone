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
const source = `export default async()=>({operations:{},async dispose(){},createNativeSession(){
 const proofs=new WeakSet();let disposed=false;
 const valid=message=>proofs.has(message.liveProof)&&message.content[0]?.text==='checked owner result';
 const project=message=>valid(message)?message:{...message,content:[{type:'text',text:'blocked owner result'}]};
 return {extension(){},projection:{finalizeEffect:'read',async finalize(event,context){
  context.signal.throwIfAborted();
  if(context.scope.kind!=='session')throw new Error('actual session scope required');
  const proof={id:'visible-proof-id'};proofs.add(proof);
  return {...event,message:{...event.message,content:[{type:'text',text:'checked owner result'}],liveProof:proof}};
 },event(event){if(disposed)throw new Error('owner disposed');return {...event,message:project(event.message)};},snapshot(messages){return messages.map(project);}},async dispose(){disposed=true;}};
}});`;

it("executes real owner WeakSet projection across a restricted worker and the actual pinned SDK fence", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-publication-courier-")));
	const sessions = [],
		natives = [];
	let runtime;
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
			events: { changed() {} },
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
		message.content = [{ type: "text", text: "tampered same actual SDK object" }];
		expect((await native.projection.event({ type: "message_end", message })).message.content[0].text).toBe(
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
