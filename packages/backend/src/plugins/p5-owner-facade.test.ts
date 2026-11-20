import assert from "node:assert/strict";
import type {
	HostFactDelivery,
	HostFactDeliveryAcknowledgement,
	HostFactDeliveryHandle,
} from "@gyoungwe/plugin-api/p5-inquiry";
import { describe, expect, it, vi } from "vitest";
import type { HostNativeSession, P5CommittedProjection } from "./p5-owner-facade";
import { PluginRuntimeRegistry } from "./runtime";

const delivery: HostFactDelivery = {
	cursor: "fact-1",
	facts: [],
	handle: Object.freeze({}) as HostFactDeliveryHandle,
};

async function attachNative(factOwner?: {
	cursor(): Promise<unknown>;
	deliver(delivery: HostFactDelivery): Promise<unknown>;
}) {
	const authorizeInvocation = vi.fn(async () => false);
	const registry = new PluginRuntimeRegistry({
		authorizeActivation: async () => true,
		authorizeInvocation,
	});
	registry.register("projector", async () => ({
		operations: {},
		dispose: async () => undefined,
		createNativeSession(): HostNativeSession {
			return {
				extension: () => undefined,
				dispose: async () => undefined,
				...(factOwner ? { factOwner: factOwner as P5CommittedProjection } : {}),
			};
		},
	}));
	await registry.activate("projector", () => undefined);
	const native = await registry.attachNative("projector", () => undefined);
	return { native, authorizeInvocation };
}

describe("managed native fact owner", () => {
	it("forwards cursor and delivery through a frozen facade without invocation authorization", async () => {
		const acknowledgement = { cursor: "fact-1", extra: true };
		const owner = {
			cursor: vi
				.fn<() => Promise<string | null>>()
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce("fact-1"),
			deliver: vi.fn(async () => acknowledgement),
		};
		const { native, authorizeInvocation } = await attachNative(owner);
		const { hostFactOwner } = native;
		expect(native).toHaveProperty("factOwner", undefined);
		assert(hostFactOwner);
		expect(hostFactOwner).not.toBe(owner);
		expect(Object.isFrozen(hostFactOwner)).toBe(true);
		await expect(hostFactOwner.cursor()).resolves.toBeNull();
		await expect(hostFactOwner.cursor()).resolves.toBe("fact-1");
		expect(owner.cursor).toHaveBeenCalledTimes(2);
		const returned = await hostFactOwner.deliver(delivery);
		expect(returned).toEqual({ cursor: "fact-1" });
		expect(returned).not.toBe(acknowledgement);
		expect(owner.deliver).toHaveBeenCalledExactlyOnceWith(delivery);
		expect(authorizeInvocation).not.toHaveBeenCalled();
	});

	it("rejects both methods without invoking the owner after disposal", async () => {
		const owner = {
			cursor: vi.fn(async () => null),
			deliver: vi.fn(async () => ({ cursor: "fact-1" })),
		};
		const { native } = await attachNative(owner);
		const { hostFactOwner } = native;
		assert(hostFactOwner);
		await native.dispose();
		await expect(hostFactOwner.cursor()).rejects.toThrow("Native provider attachment closed");
		await expect(hostFactOwner.deliver(delivery)).rejects.toThrow("Native provider attachment closed");
		expect(owner.cursor).not.toHaveBeenCalled();
		expect(owner.deliver).not.toHaveBeenCalled();
	});

	it("discards an acknowledgement when disposed during pending delivery", async () => {
		let acknowledge: (() => void) | undefined;
		const response = new Promise<HostFactDeliveryAcknowledgement>((resolve) => {
			acknowledge = () => resolve({ cursor: "fact-1" });
		});
		const deliver = vi.fn(() => response);
		const { native } = await attachNative({ cursor: async () => null, deliver });
		const { hostFactOwner } = native;
		assert(hostFactOwner);
		const pending = hostFactOwner.deliver(delivery);
		expect(deliver).toHaveBeenCalledOnce();
		const rejected = expect(pending).rejects.toThrow("Native provider attachment closed");
		await native.dispose();
		assert(acknowledge);
		acknowledge();
		await rejected;
	});
});

describe("managed native fact owner responses", () => {
	it.each([
		["no cursor", {}],
		["an empty cursor", { cursor: "" }],
		["a non-string cursor", { cursor: 1 }],
		["an inherited cursor", Object.create({ cursor: "fact-1" })],
	])("rejects an acknowledgement with %s", async (_name, acknowledgement) => {
		const { native } = await attachNative({ cursor: async () => null, deliver: async () => acknowledgement });
		const { hostFactOwner } = native;
		assert(hostFactOwner);
		await expect(hostFactOwner.deliver(delivery)).rejects.toThrow("Invalid fact owner response");
	});

	it("rejects a numeric committed cursor", async () => {
		const { native } = await attachNative({
			cursor: async () => 1,
			deliver: async () => ({ cursor: "fact-1" }),
		});
		const { hostFactOwner } = native;
		assert(hostFactOwner);
		await expect(hostFactOwner.cursor()).rejects.toThrow("Invalid fact owner response");
	});
});

it("omits the facade when the session has no fact owner", async () => {
	const { native } = await attachNative();
	expect(native).not.toHaveProperty("hostFactOwner");
});
