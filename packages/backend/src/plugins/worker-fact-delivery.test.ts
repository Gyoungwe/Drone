import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PluginNativeFactOwner, PluginNativeSession } from "@gyoungwe/plugin-api/native";
import type { HostFactDelivery, HostFactDeliveryHandle } from "@gyoungwe/plugin-api/p5-inquiry";
import { expect, it, onTestFinished } from "vitest";
import type { HostNativeSession } from "./p5-owner-facade";
import { createProcessPluginRuntime } from "./process-runtime";
import { PluginRuntimeRegistry } from "./runtime";

type GuestSessionWithFactOwner = PluginNativeSession & { readonly factOwner: PluginNativeFactOwner };
type AcceptsHostSession<Session extends HostNativeSession> = Session;
// @ts-expect-error A guest fact owner requires a worker-supplied signal.
type _GuestSessionIsNotHostSession = AcceptsHostSession<GuestSessionWithFactOwner>;

const delivery: HostFactDelivery = {
	cursor: "fact:1",
	facts: [
		{
			id: "fact:1",
			sequence: 1,
			kind: "compute",
			entityId: "run:1",
			at: "2026-11-20T00:00:00Z",
			status: "succeeded",
			artifactRefs: [],
			runReceiptRef: null,
			decisionKind: null,
			summary: "Compute succeeded",
			basis: [],
		},
	],
	handle: Object.freeze({}) as HostFactDeliveryHandle,
};

const owner = `
  factOwner: {
    async cursor() { return state.cursor; },
    async deliver(delivery, signal) {
      state.received = delivery;
      markers.push("deliver:entered");
      signal.addEventListener("abort", () => {
        markers.push("deliver:aborted");
        aborted.resolve();
      }, { once: true });
      entered.resolve();
      await released.promise;
      markers.push("deliver:settled");
      if (!signal.aborted) state.cursor = delivery.cursor;
      return { cursor: delivery.cursor };
    },
  },
`;

function fixtureSource(factOwner: string) {
	return `
const entered = Promise.withResolvers();
const aborted = Promise.withResolvers();
const released = Promise.withResolvers();
const markers = [];
const state = { cursor: null, received: null };
const operation = execute => ({ inputSchema: { type: "null" }, resultSchema: {}, effect: "read", execute });
export default async ({ capabilities }) => ({
  operations: {
    state: operation(async () => ({ markers, received: state.received })),
    entered: operation(async () => { await entered.promise; return null; }),
    aborted: operation(async () => { await aborted.promise; return null; }),
    release: operation(async () => { released.resolve(); return null; }),
  },
  async createNativeSession() {
    return {
      extension() {},
      ${factOwner}
      async dispose() { markers.push("adapter:disposed"); },
    };
  },
  async dispose() {},
});
`;
}

async function startRuntime(factOwner = owner) {
	const root = await mkdtemp(join(tmpdir(), "drone-fact-delivery-"));
	const registry = new PluginRuntimeRegistry({
		authorizeActivation: async () => true,
		authorizeInvocation: async () => true,
	});
	onTestFinished(async () => {
		try {
			await registry.deactivate("example");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	const entrypoint = join(root, "runtime.mjs");
	await writeFile(entrypoint, fixtureSource(factOwner));
	const runtimeDirectory = resolve(
		import.meta.dirname,
		"../../../desktop/plugin-runtime",
		`${process.platform}-${process.arch}`,
	);
	registry.register(
		"example",
		createProcessPluginRuntime({ pluginId: "example", packageRoot: root, entrypoint, runtimeDirectory }),
	);
	const caller = {
		identity: {},
		scope: {
			kind: "session" as const,
			workspaceId: "workspace",
			workspaceDirectory: "/Work/One",
			sessionId: "session",
		},
		signal: new AbortController().signal,
	};
	const resolveCaller = () => caller;
	const client = await registry.activate("example", resolveCaller);
	return { client, attach: () => registry.attachNative("example", resolveCaller, resolveCaller) };
}

it("forwards the cursor and acknowledges only the fact payload, without the host handle", async () => {
	const { attach, client } = await startRuntime();
	const { hostFactOwner } = await attach();
	assert(hostFactOwner);
	await expect(hostFactOwner.cursor()).resolves.toBeNull();
	await client.invoke("release", null);
	await expect(hostFactOwner.deliver(delivery)).resolves.toEqual({ cursor: "fact:1" });
	await expect(hostFactOwner.cursor()).resolves.toBe("fact:1");
	expect(await client.invoke("state", null)).toEqual({
		markers: ["deliver:entered", "deliver:settled"],
		received: { cursor: delivery.cursor, facts: delivery.facts },
	});
});

it("lets the worker resolve its bound session during both fact requests", async () => {
	const { attach } = await startRuntime(`
    factOwner: {
      async cursor() { return JSON.stringify(await capabilities.call("caller.scope", null)); },
      async deliver() { return { cursor: await this.cursor() }; },
    },
  `);
	const { hostFactOwner } = await attach();
	assert(hostFactOwner);
	const cursor = await hostFactOwner.cursor();
	assert(cursor);
	expect(JSON.parse(cursor)).toEqual({
		kind: "session",
		workspaceId: "workspace",
		workspaceDirectory: "/Work/One",
		sessionId: "session",
	});
	await expect(hostFactOwner.deliver(delivery)).resolves.toEqual({ cursor });
});

it("does not expose a host fact owner for an adapter without one", async () => {
	const { attach } = await startRuntime("");
	expect(await attach()).not.toHaveProperty("hostFactOwner");
});

it("rejects and disposes an adapter with a malformed fact owner", async () => {
	const { attach, client } = await startRuntime(
		"factOwner: { async cursor() { return null; }, deliver: false },",
	);
	await expect(attach()).rejects.toThrow("Invalid native fact owner");
	expect(await client.invoke("state", null)).toMatchObject({ markers: ["adapter:disposed"] });
});

it("aborts an in-flight delivery and drains it before replying or disposing the adapter", async () => {
	const { attach, client } = await startRuntime();
	const attachment = await attach();
	const { hostFactOwner } = attachment;
	assert(hostFactOwner);
	const outcomes: string[] = [];
	const pending = hostFactOwner.deliver(delivery);
	const reply = pending.then(
		() => outcomes.push("acknowledged"),
		() => outcomes.push("rejected"),
	);
	await client.invoke("entered", null);
	const stopping = attachment.dispose();
	const detach = stopping.then(() => outcomes.push("detached"));
	try {
		await client.invoke("aborted", null);
		expect(await client.invoke("state", null)).toMatchObject({
			markers: ["deliver:entered", "deliver:aborted"],
		});
		expect([...outcomes]).toEqual([]);
	} finally {
		await client.invoke("release", null);
		await Promise.allSettled([reply, detach]);
	}
	await expect(pending).rejects.toThrow("Native provider attachment closed");
	await expect(stopping).resolves.toBeUndefined();
	expect(outcomes).toEqual(["rejected", "detached"]);
	expect(await client.invoke("state", null)).toMatchObject({
		markers: ["deliver:entered", "deliver:aborted", "deliver:settled", "adapter:disposed"],
	});
});

it("rejects deliveries after detach without reaching the plugin", async () => {
	const { attach, client } = await startRuntime();
	const attachment = await attach();
	const { hostFactOwner } = attachment;
	assert(hostFactOwner);
	await attachment.dispose();
	await expect(hostFactOwner.deliver(delivery)).rejects.toThrow("Native provider attachment closed");
	expect(await client.invoke("state", null)).toEqual({ markers: ["adapter:disposed"], received: null });
});
