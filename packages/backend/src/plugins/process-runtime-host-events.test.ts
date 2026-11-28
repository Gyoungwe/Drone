import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PluginHostEventSource } from "@gyoungwe/plugin-api/host-events";
import type { PluginRuntimeScope } from "@gyoungwe/plugin-api/runtime";
import { afterEach, expect, it, vi } from "vitest";
import { HostEventBridge } from "./host-event-bridge";
import { createProcessPluginRuntime } from "./process-runtime";
import { PluginRuntimeRegistry } from "./runtime";

const runtimeDirectory = resolve(
	import.meta.dirname,
	"../../../desktop/plugin-runtime",
	`${process.platform}-${process.arch}`,
);
const hasRuntime = existsSync(join(runtimeDirectory, "runtime.json"));
const roots: string[] = [];
const scope: PluginRuntimeScope = { kind: "application" };
const policy = { authorizeActivation: async () => true, authorizeInvocation: async () => true };

async function fixture(source: string) {
	const root = await mkdtemp(join(tmpdir(), "drone-runtime-host-events-"));
	roots.push(root);
	const entrypoint = join(root, "runtime.mjs");
	await writeFile(entrypoint, source);
	return { pluginId: "host-events-fixture", packageRoot: root, entrypoint, runtimeDirectory };
}

function registryFor(
	options: Awaited<ReturnType<typeof fixture>>,
	hostEvents?: (signal: AbortSignal) => PluginHostEventSource,
) {
	const registry = new PluginRuntimeRegistry(policy, "app", ({ signal }) => ({
		resources: [],
		handlers: {},
		...(hostEvents ? { hostEvents: hostEvents(signal) } : {}),
	}));
	registry.register(options.pluginId, createProcessPluginRuntime(options));
	return registry;
}

function caller() {
	const value = { identity: {}, scope, signal: new AbortController().signal };
	return () => value;
}

function trackedSource(bridge: HostEventBridge, signal: AbortSignal) {
	const source = bridge.source(["inquiry.compute"], signal);
	let subscriptions = 0;
	let onDrained: (() => void) | undefined;
	const drained = new Promise<void>((resolve) => {
		onDrained = resolve;
	});
	const tracked: PluginHostEventSource = {
		subscribe(topic, listener) {
			subscriptions++;
			const unsubscribe = source.subscribe(topic, listener);
			let active = true;
			return () => {
				if (!active) return;
				active = false;
				subscriptions--;
				unsubscribe();
				if (subscriptions === 0) onDrained?.();
			};
		},
	};
	return { source: tracked, count: () => subscriptions, drained };
}

afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const protocolIt = it.skipIf(!hasRuntime);

protocolIt("delivers the event envelope and stops after the worker unsubscribes", async () => {
	const options = await fixture(`const events=[];export default async({hostEvents})=>{
 const unsubscribe=hostEvents.subscribe('inquiry.compute',event=>events.push(event));
 return {operations:{read:{inputSchema:{type:'null'},resultSchema:{type:'array',items:{type:'object'}},effect:'read',execute:async()=>events},off:{inputSchema:{type:'null'},resultSchema:{type:'null'},effect:'read',execute:async()=>{unsubscribe();return null}}},dispose:async()=>unsubscribe()};
};`);
	const bridge = new HostEventBridge();
	const state = { active: undefined as ReturnType<typeof trackedSource> | undefined };
	const registry = registryFor(options, (signal) => {
		state.active = trackedSource(bridge, signal);
		return state.active.source;
	});
	try {
		const client = await registry.activate(options.pluginId, caller());
		const payload = { id: "compute-1", status: "collected" };
		bridge.publish("inquiry.compute", payload);
		await vi.waitFor(async () =>
			expect(await client.invoke("read", null)).toEqual([{ topic: "inquiry.compute", sequence: 1, payload }]),
		);
		await client.invoke("off", null);
		bridge.publish("inquiry.compute", { id: "compute-2" });
		expect(await client.invoke("read", null)).toEqual([{ topic: "inquiry.compute", sequence: 1, payload }]);
		expect(state.active?.count()).toBe(0);
	} finally {
		await registry.deactivate(options.pluginId);
		expect(state.active?.count()).toBe(0);
	}
});

protocolIt("omits hostEvents from the worker factory context when the host provides none", async () => {
	const options = await fixture(
		`export default async context=>({operations:{has:{inputSchema:{type:'null'},resultSchema:{type:'boolean'},effect:'read',execute:async()=>('hostEvents' in context)}},dispose:async()=>{}});`,
	);
	const registry = registryFor(options);
	try {
		const client = await registry.activate(options.pluginId, caller());
		expect(await client.invoke("has", null)).toBe(false);
	} finally {
		await registry.deactivate(options.pluginId);
	}
});

protocolIt.each([
	[
		"rejects an undeclared known topic",
		`process.stdout.write(JSON.stringify({type:'host_events_subscribe',id:'1',topic:'inquiry.decision'})+'\\n');`,
		"not declared",
		true,
	],
	[
		"rejects an unknown topic",
		`process.stdout.write(JSON.stringify({type:'host_events_subscribe',id:'1',topic:'unknown.topic'})+'\\n');`,
		"invalid host event topic",
		true,
	],
	[
		"rejects a reused subscription id after unsubscribe",
		`const value={type:'host_events_subscribe',id:'1',topic:'inquiry.compute'};process.stdout.write(JSON.stringify(value)+'\\n'+JSON.stringify({type:'host_events_unsubscribe',id:'1'})+'\\n'+JSON.stringify(value)+'\\n');`,
		"reused a host event subscription id",
		true,
	],
	[
		"rejects malformed closed-schema messages",
		`process.stdout.write(JSON.stringify({type:'host_events_subscribe',id:'',topic:'inquiry.compute',extra:true})+'\\n');`,
		"invalid protocol message",
		true,
	],
	[
		"rejects subscriptions when hostEvents was not provided",
		`process.stdout.write(JSON.stringify({type:'host_events_subscribe',id:'1',topic:'inquiry.compute'})+'\\n');`,
		"without an approved source",
		false,
	],
])("%s", async (_name, output, message, provideSource) => {
	const options = await fixture(
		`export default async()=>{${output}return {operations:{},dispose:async()=>{}}};`,
	);
	const bridge = new HostEventBridge();
	const registry = registryFor(
		options,
		provideSource ? (signal) => bridge.source(["inquiry.compute"], signal) : undefined,
	);
	try {
		await expect(registry.activate(options.pluginId, caller())).rejects.toThrow(message);
	} finally {
		await Promise.allSettled([registry.deactivate(options.pluginId)]);
	}
});

protocolIt("fails activation on an encoded queue overflow and releases that subscription", async () => {
	const options = await fixture(`export default async({hostEvents})=>{
 hostEvents.subscribe('inquiry.compute',()=>{});
 await new Promise(resolve=>setTimeout(resolve,100));
 return {operations:{},dispose:async()=>{}};
};`);
	const bridge = new HostEventBridge();
	const state = { active: undefined as ReturnType<typeof trackedSource> | undefined };
	const registry = registryFor(options, (signal) => {
		const tracked = trackedSource(bridge, signal);
		state.active = {
			source: {
				subscribe(topic, listener) {
					const unsubscribe = tracked.source.subscribe(topic, listener);
					queueMicrotask(() => bridge.publish(topic as "inquiry.compute", "x".repeat(1024 * 1024)));
					return unsubscribe;
				},
			},
			count: tracked.count,
			drained: tracked.drained,
		};
		return state.active.source;
	});
	try {
		await expect(registry.activate(options.pluginId, caller())).rejects.toThrow(
			"Plugin host event queue overflow: host-events-fixture inquiry.compute",
		);
		expect(state.active?.count()).toBe(0);
	} finally {
		await Promise.allSettled([registry.deactivate(options.pluginId)]);
	}
});

protocolIt("removes subscriptions when the worker exits and when activation stops", async () => {
	const options = await fixture(`export default async({hostEvents})=>{
 hostEvents.subscribe('inquiry.compute',()=>{});
 setTimeout(()=>process.exit(1),50);
 return {operations:{},dispose:async()=>{}};
};`);
	const bridge = new HostEventBridge();
	const state = { active: undefined as ReturnType<typeof trackedSource> | undefined };
	const registry = registryFor(options, (signal) => {
		state.active = trackedSource(bridge, signal);
		return state.active.source;
	});
	try {
		await registry.activate(options.pluginId, caller());
		await state.active?.drained;
		expect(state.active?.count()).toBe(0);
	} finally {
		await Promise.allSettled([registry.deactivate(options.pluginId)]);
	}

	const stopped = await fixture(
		`export default async({hostEvents})=>{hostEvents.subscribe('inquiry.compute',()=>{});return {operations:{},dispose:async()=>{}}};`,
	);
	const stoppedBridge = new HostEventBridge();
	const stoppedState = { active: undefined as ReturnType<typeof trackedSource> | undefined };
	const stoppedRegistry = registryFor(stopped, (signal) => {
		stoppedState.active = trackedSource(stoppedBridge, signal);
		return stoppedState.active.source;
	});
	try {
		await stoppedRegistry.activate(stopped.pluginId, caller());
		expect(stoppedState.active?.count()).toBe(1);
		await stoppedRegistry.deactivate(stopped.pluginId);
		expect(stoppedState.active?.count()).toBe(0);
	} finally {
		await Promise.allSettled([stoppedRegistry.deactivate(stopped.pluginId)]);
	}
});
