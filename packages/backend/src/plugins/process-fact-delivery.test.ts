import assert from "node:assert/strict";
import type { HostFactDelivery, HostFactDeliveryHandle } from "@gyoungwe/plugin-api/p5-inquiry";
import { expect, it } from "vitest";
import { attachProcessNative, type ProcessNativeHost } from "./process-native-attachment";
import { PluginRuntimeRegistry } from "./runtime";

const delivery: HostFactDelivery = {
	cursor: "fact:1",
	facts: [
		{
			id: "fact:1",
			sequence: 1,
			kind: "compute",
			entityId: "run:1",
			at: "2026-11-18T00:00:00Z",
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
const acknowledgement = { cursor: "fact:1" };

function deferred<Result>() {
	let handlers: { resolve: (value: Result) => void; reject: (error: Error) => void } | undefined;
	const promise = new Promise<Result>((resolve, reject) => {
		handlers = { resolve, reject };
	});
	assert(handlers);
	return { promise, ...handlers };
}

function recordRequest(
	type: Parameters<ProcessNativeHost["request"]>[0],
	payload: object,
	signal?: AbortSignal,
) {
	return { type, payload, signal, ...deferred<unknown>() };
}

function createHost() {
	const requests: ReturnType<typeof recordRequest>[] = [];
	const lifetime = new AbortController();
	const attaching = deferred<ReturnType<typeof recordRequest>>();
	const detaching = deferred<ReturnType<typeof recordRequest>>();
	const host: ProcessNativeHost = {
		context: {
			signal: lifetime.signal,
			capabilities: {
				async call() {
					throw new Error("Unexpected capability call");
				},
			},
		},
		nativeDisposers: new Set(),
		request(type, payload, signal) {
			const request = recordRequest(type, payload, signal);
			requests.push(request);
			if (type === "native_attach") attaching.resolve(request);
			if (type === "native_detach") detaching.resolve(request);
			return request.promise;
		},
	};
	return {
		host,
		lifetime,
		attaching: attaching.promise,
		detaching: detaching.promise,
		requestTypes: () => requests.map(({ type }) => type),
		latestRequest() {
			const request = requests.at(-1);
			assert(request);
			return request;
		},
	};
}

async function declareNative(transport: ReturnType<typeof createHost>, factOwner?: true) {
	const request = await transport.attaching;
	request.resolve({
		commands: [],
		tools: [],
		effects: {},
		commandEffects: {},
		eventEffects: {},
		nativeOperations: {},
		events: [],
		...(factOwner === true ? { factOwner } : {}),
	});
	return request.payload;
}

async function attach(factOwner?: true) {
	const transport = createHost();
	const creating = attachProcessNative(transport.host);
	const address = await declareNative(transport, factOwner);
	return { ...transport, address, session: await creating };
}

it("omits a fact owner unless the child declares one", async () => {
	const undeclared = await attach();
	expect(undeclared.session).not.toHaveProperty("factOwner");
	const declared = await attach(true);
	expect(declared.session.factOwner).toEqual({ cursor: expect.any(Function), deliver: expect.any(Function) });
});

it("sends attachment-bound cursor and delivery requests without the live handle", async () => {
	const { address, latestRequest, session } = await attach(true);
	const { factOwner } = session;
	assert(factOwner);
	const cursor = factOwner.cursor();
	const cursorRequest = latestRequest();
	expect(cursorRequest.type).toBe("native_fact_cursor");
	expect(cursorRequest.payload).toEqual(address);
	cursorRequest.resolve(null);
	await expect(cursor).resolves.toBeNull();

	const delivered = factOwner.deliver(delivery);
	const deliveryRequest = latestRequest();
	expect(deliveryRequest.type).toBe("native_fact_deliver");
	expect(deliveryRequest.payload).not.toHaveProperty("facts.handle");
	const expected = { ...address, facts: { cursor: "fact:1", facts: delivery.facts } };
	expect(deliveryRequest.payload).toEqual(expected);
	expect(JSON.parse(JSON.stringify(deliveryRequest.payload))).toEqual(expected);
	deliveryRequest.resolve(acknowledgement);
	await expect(delivered).resolves.toBe(acknowledgement);
});

it("aborts and drains all in-flight requests before sending native_detach", async () => {
	const { address, detaching, host, latestRequest, requestTypes, session } = await attach(true);
	const { factOwner } = session;
	assert(factOwner);
	const cursor = factOwner.cursor();
	const cursorRequest = latestRequest();
	const delivered = factOwner.deliver(delivery);
	const deliveryRequest = latestRequest();
	const stopping = session.dispose();
	expect(session.dispose()).toBe(stopping);
	expect(cursorRequest.signal?.aborted).toBe(true);
	expect(deliveryRequest.signal?.aborted).toBe(true);
	await Promise.resolve();
	const inFlightTypes = ["native_attach", "native_fact_cursor", "native_fact_deliver"];
	expect(requestTypes()).toEqual(inFlightTypes);

	cursorRequest.resolve(null);
	await cursor;
	expect(requestTypes()).toEqual(inFlightTypes);
	deliveryRequest.resolve(acknowledgement);
	await delivered;
	const detachRequest = await detaching;
	expect(requestTypes()).toEqual([...inFlightTypes, "native_detach"]);
	expect(detachRequest.payload).toEqual(address);
	expect(host.nativeDisposers.has(session.dispose)).toBe(true);
	detachRequest.resolve(undefined);
	await stopping;
	expect(host.nativeDisposers.has(session.dispose)).toBe(false);
});

it("still detaches when an in-flight delivery rejects", async () => {
	const { detaching, latestRequest, session } = await attach(true);
	const { factOwner } = session;
	assert(factOwner);
	const delivered = factOwner.deliver(delivery);
	const deliveryRequest = latestRequest();
	const stopping = session.dispose();
	const failure = new Error("Child canceled delivery");
	const rejected = expect(delivered).rejects.toBe(failure);
	deliveryRequest.reject(failure);
	await rejected;
	(await detaching).resolve(undefined);
	await expect(stopping).resolves.toBeUndefined();
});

it("rejects delivery after disposal without sending it", async () => {
	const { detaching, requestTypes, session } = await attach(true);
	const { factOwner } = session;
	assert(factOwner);
	const stopping = session.dispose();
	(await detaching).resolve(undefined);
	await stopping;
	await expect(factOwner.deliver(delivery)).rejects.toThrow("Native attachment closed");
	expect(requestTypes()).toEqual(["native_attach", "native_detach"]);
});

it("rejects delivery after a host abort without sending it", async () => {
	const { lifetime, requestTypes, session } = await attach(true);
	const { factOwner } = session;
	assert(factOwner);
	const reason = new Error("Host closed");
	lifetime.abort(reason);
	await expect(factOwner.deliver(delivery)).rejects.toBe(reason);
	expect(requestTypes()).toEqual(["native_attach"]);
});

it("exposes the process owner through the real registry's host fact facade", async () => {
	const transport = createHost();
	const registry = new PluginRuntimeRegistry({
		authorizeActivation: async () => true,
		authorizeInvocation: async () => false,
	});
	registry.register("projector", async () => ({
		operations: {},
		dispose: async () => undefined,
		createNativeSession: () => attachProcessNative(transport.host),
	}));
	await registry.activate("projector", () => undefined);
	const attaching = registry.attachNative("projector", () => undefined);
	await declareNative(transport, true);
	const { hostFactOwner } = await attaching;
	assert(hostFactOwner);
	const cursor = hostFactOwner.cursor();
	transport.latestRequest().resolve("fact:1");
	await expect(cursor).resolves.toBe("fact:1");
	const delivered = hostFactOwner.deliver(delivery);
	transport.latestRequest().resolve({ ...acknowledgement, extra: true });
	await expect(delivered).resolves.toEqual(acknowledgement);
	expect(transport.requestTypes()).toEqual(["native_attach", "native_fact_cursor", "native_fact_deliver"]);
});
