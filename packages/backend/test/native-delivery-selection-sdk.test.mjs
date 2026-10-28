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
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { NativeSessionDelivery } from "../src/plugins/native-delivery";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";
import { getPluginSessionCaller } from "../src/plugins/session-caller";
import { SessionRegistry } from "../src/session/registry";
import { SessionEngine } from "../src/session-engine/engine";

const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);
const source = `export default async({capabilities})=>({operations:{},async dispose(){},createNativeSession(){
 const proof=new WeakSet();
 return {extension(){},async dispose(){},projection:{finalizeEffect:'read',async finalize(event,context){
  if(context.scope.kind!=='session')throw new Error('real session required');
  await capabilities.call('check',null);context.signal.throwIfAborted();
  const receipt={};proof.add(receipt);
  return {...event,message:{...event.message,content:[{type:'text',text:'owner checked'}],receipt}};
 },event(event){return proof.has(event.message.receipt)?event:{...event,message:{...event.message,content:[{type:'text',text:'owner rejected'}]}};},snapshot(messages){return messages;}}};
}});`;
function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function fixture({ confirmed = true, managed = true, blockCheck = false } = {}) {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-native-selected-")));
	const pkg = join(root, "package");
	await mkdir(pkg);
	const entrypoint = join(pkg, "runtime.mjs"),
		nativeEntrypoint = join(pkg, "native.mjs");
	await writeFile(entrypoint, source);
	await writeFile(nativeEntrypoint, "throw new Error('must remain in worker');");
	let current = {
		pluginId: "selected-owner",
		packageRoot: pkg,
		entrypoint,
		nativeEntrypoint,
		contentHash: "a".repeat(64),
		deliveryProjection: "required",
	};
	let state = "enabled",
		checks = 0;
	const entered = deferred(),
		release = deferred(),
		registry = new SessionRegistry();
	const bridge = new PluginRuntimeBridge({
		source: () => current,
		sources: () => [{ name: "selected", source: current, state }],
		classifySelectedPath: (path) =>
			path === nativeEntrypoint ? { kind: "managed", source: current, state } : { kind: "unconfirmed" },
		enabled: () => state === "enabled",
		approve: async () => true,
		factory: () => createProcessPluginRuntime({ ...current, runtimeDirectory }),
		getSessionContext: (id) => getPluginSessionCaller(registry, id),
		capabilities: () => ({
			resources: [],
			handlers: {
				check: {
					inputSchema: { type: "null" },
					resultSchema: { type: "null" },
					effect: "read",
					execute: async () => {
						checks++;
						entered.resolve();
						if (blockCheck) await release.promise;
						return null;
					},
				},
			},
		}),
	});
	const bootstrap = bridge.beginNative({ id: 101, isDestroyed: () => false }, (path) =>
		path === nativeEntrypoint ? "selected" : undefined,
	);
	const factories = [];
	if (managed) {
		bootstrap.delivery.observeSelectedPath(nativeEntrypoint);
		factories.push(await bootstrap.factoryForPath(nativeEntrypoint));
	}
	if (confirmed) bootstrap.delivery.confirmSelection(managed ? [nativeEntrypoint] : []);
	const settingsManager = SettingsManager.inMemory({});
	settingsManager.setProjectTrusted(true);
	const resourceLoader = new DefaultResourceLoader({
		cwd: root,
		agentDir: root,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		extensionFactories: factories,
	});
	await resourceLoader.reload({ resolveProjectTrust: async () => true });
	expect(resourceLoader.getExtensions().errors).toEqual([]);
	const modelRuntime = await ModelRuntime.create({
		authPath: join(root, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "native-selected-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey(faux.provider.id, "synthetic-offline-key");
	faux.setResponses([fauxAssistantMessage("RAW_UNCHECKED")]);
	const { session } = await createAgentSession({
		cwd: root,
		agentDir: root,
		settingsManager,
		resourceLoader,
		modelRuntime,
		model: faux.getModel(),
		sessionManager: SessionManager.inMemory(root),
		tools: [],
		hostDeliveryRunStart: (signal) => bootstrap.delivery.start(signal),
		hostDeliveryBoundary: (event, signal) => bootstrap.delivery.finalize(event, signal),
	});
	registry.add({ session, cwd: root, unsubscribe() {} });
	bootstrap.bindSession(session.sessionId, () => session.abort());
	await session.bindExtensions({});
	return {
		root,
		bridge,
		bootstrap,
		session,
		faux,
		entered,
		release,
		checks: () => checks,
		setState(value) {
			state = value;
		},
		changeHash() {
			current = { ...current, contentHash: "b".repeat(64) };
		},
		async close() {
			release.resolve();
			await new SessionEngine().dispose(session);
			await bootstrap.dispose();
			await bridge.close();
			await rm(root, { recursive: true, force: true });
		},
	};
}

it("uses confirmed actual selection, registry caller, broker and owner proof before actual SDK emit/append", async () => {
	const f = await fixture();
	try {
		const publicMessages = [];
		f.session.subscribe((event) => {
			if (event.type === "message_end" && event.message.role === "assistant")
				publicMessages.push(structuredClone(event.message));
		});
		await f.session.prompt("Offline selected owner check");
		expect(f.checks()).toBe(1);
		expect(publicMessages[0].content).toEqual([{ type: "text", text: "owner checked" }]);
		expect(
			f.session.sessionManager
				.getBranch()
				.find((entry) => entry.type === "message" && entry.message.role === "assistant").message.content,
		).toEqual(publicMessages[0].content);
		expect(JSON.stringify(f.session.sessionManager.getBranch())).not.toContain("RAW_UNCHECKED");
	} finally {
		await f.close();
	}
}, 20000);

for (const managed of [true, false])
	it(`does not infer an absent policy from unconfirmed ${managed ? "managed" : "empty"} interceptions`, async () => {
		const f = await fixture({ confirmed: false, managed });
		try {
			await f.session.prompt("Offline unconfirmed selection");
			expect(f.checks()).toBe(0);
			expect(JSON.stringify(f.session.sessionManager.getBranch())).not.toContain("RAW_UNCHECKED");
			expect(f.session.messages.find((message) => message.role === "assistant").stopReason).toBe("aborted");
		} finally {
			await f.close();
		}
	}, 20000);

it("preserves ordinary SDK delivery only after a complete host selection confirmation", async () => {
	const f = await fixture({ managed: false });
	try {
		await f.session.prompt("Ordinary offline chat");
		expect(f.session.messages.find((message) => message.role === "assistant").content).toEqual([
			{ type: "text", text: "RAW_UNCHECKED" },
		]);
		expect(f.checks()).toBe(0);
	} finally {
		await f.close();
	}
}, 20000);

it("pins required policy at actual run start across disable and rejects a changed source after awaited owner work", async () => {
	for (const change of ["disable", "hash"]) {
		const f = await fixture({ blockCheck: true });
		try {
			const prompt = f.session.prompt("Offline changing source");
			await f.entered.promise;
			if (change === "disable") f.setState("disabled");
			else f.changeHash();
			f.release.resolve();
			await prompt;
			expect(f.checks()).toBe(1);
			const body = JSON.stringify(f.session.sessionManager.getBranch());
			expect(body).not.toContain("RAW_UNCHECKED");
			expect(body).not.toContain("owner checked");
			expect(f.session.messages.find((message) => message.role === "assistant").stopReason).toBe("aborted");
		} finally {
			await f.close();
		}
	}
}, 20000);

it("deduplicates one package's selected paths and closes conflicting required packages or unknown provenance", async () => {
	const source = {
		pluginId: "one",
		packageRoot: "/one",
		entrypoint: "/one/runtime",
		contentHash: "a",
		deliveryProjection: "required",
	};
	const other = { ...source, pluginId: "two", packageRoot: "/two" };
	let calls = 0;
	const delivery = new NativeSessionDelivery(
		(path) =>
			path === "unknown"
				? { kind: "unconfirmed" }
				: { kind: "managed", source: path === "other" ? other : source, state: "enabled" },
		(a, b) => a.pluginId === b.pluginId && a.contentHash === b.contentHash,
		() => [
			{ source, state: "enabled" },
			{ source: other, state: "enabled" },
		],
	);
	delivery.attach(
		source,
		{
			hostProjection: {
				async finalize(event) {
					calls++;
					return event;
				},
				async event(event) {
					return event;
				},
			},
		},
		() => true,
	);
	const event = () => ({ type: "message_end", message: { role: "assistant", content: [] } });
	let signal = new AbortController().signal;
	delivery.confirmSelection(["one", "alias"]);
	delivery.start(signal);
	await delivery.finalize(event(), signal);
	expect(calls).toBe(1);
	for (const paths of [
		["one", "other"],
		["one", "unknown"],
	]) {
		signal = new AbortController().signal;
		delivery.confirmSelection(paths);
		delivery.start(signal);
		await expect(delivery.finalize(event(), signal)).rejects.toThrow("policy is unavailable");
	}
	expect(calls).toBe(1);
	await delivery.dispose();
});
