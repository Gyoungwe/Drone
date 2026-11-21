import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import type { Fact } from "@gyoungwe/plugin-api/p5-inquiry";
import { expect, it, vi } from "vitest";
import { createNativeSessionFacade } from "./native-session-facade";
import { attachFactOwner, type P5OwnerAttachmentPort } from "./p5-owner-attachments";
import type { P5CommittedProjection } from "./p5-owner-facade";
import type { PluginSessionCallerContext } from "./session-caller";

const scope = {
	workspaceId: "workspace-1",
	sessionId: "session-1",
	callerSourceHash: "a".repeat(64),
	providerSourceHash: "b".repeat(64),
};
const source = { pluginId: "example", packageRoot: "/example", entrypoint: "/example/runtime.mjs" };

function deferred<Result>() {
	let resolve: (value: Result) => void = vi.fn();
	const promise = new Promise<Result>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

function fixture() {
	const controller = new AbortController();
	const session: PluginSessionCallerContext = {
		identity: {},
		scope: { kind: "session", workspaceDirectory: "/workspace", ...scope },
		signal: controller.signal,
		readOnly: false,
		projectTrusted: true,
	};
	const journal: { sessionId: string; fact: Fact }[] = [];
	const listeners = new Map<() => void, string>();
	const unsubscribe = vi.fn((listener: () => void) => listeners.delete(listener));
	const facts: P5OwnerAttachmentPort["facts"] = {
		read: async (selected, { after }) => {
			const start = journal.findIndex(({ fact }) => fact.id === after) + 1;
			const facts = journal
				.slice(start)
				.filter(({ sessionId }) => sessionId === selected.sessionId)
				.map(({ fact }) => fact);
			return { facts, cursor: facts.at(-1)?.id ?? after };
		},
		subscribe: (selected, changed) => {
			listeners.set(changed, selected.sessionId);
			return () => unsubscribe(changed);
		},
	};
	const port = { scopeOf: vi.fn(() => scope), facts, authorize: vi.fn(async () => true) };
	const deliver = vi.fn<P5CommittedProjection["deliver"]>(async (batch) => {
		assert(batch.cursor);
		return { cursor: batch.cursor };
	});
	const owner = { cursor: vi.fn(async () => null), deliver };
	const append = (sessionId: string = scope.sessionId) => {
		const sequence = journal.length + 1;
		const fact: Fact = {
			id: `fact-${sequence}`,
			sequence,
			kind: "compute",
			entityId: "run-1",
			at: "2026-11-18T00:00:00Z",
			status: "succeeded",
			artifactRefs: [],
			runReceiptRef: null,
			decisionKind: null,
			basis: [],
			summary: "Sample compute fact",
		};
		journal.push({ sessionId, fact });
		for (const [listener, subscribedSession] of listeners) if (sessionId === subscribedSession) listener();
		return fact;
	};
	const attach = () => attachFactOwner(port, owner, source, session, controller.signal);
	return { append, attach, controller, deliver, owner, port, session, unsubscribe };
}

it("wakes on a committed append and delivers only the bound session's facts", async () => {
	const test = fixture();
	const attachment = test.attach();
	await setImmediate();
	test.append("session-2");
	const scoped = test.append();
	await setImmediate();
	expect(test.deliver).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ facts: [scoped] }));
	expect(test.owner.cursor).toHaveBeenCalledOnce();
	expect(test.port.scopeOf).toHaveBeenCalledExactlyOnceWith(source, test.session);
	expect(test.port.authorize).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(scope));
	await attachment.release();
});

it("unsubscribes immediately, drains an in-flight delivery, and ignores later appends", async () => {
	const test = fixture();
	const inFlight = deferred<{ cursor: string }>();
	test.deliver.mockReturnValueOnce(inFlight.promise);
	const attachment = test.attach();
	const fact = test.append();
	await setImmediate();
	expect(test.deliver).toHaveBeenCalledOnce();
	const released = vi.fn();
	const releasing = attachment.release();
	const completion = releasing.then(released);
	expect(attachment.release()).toBe(releasing);
	expect(test.unsubscribe).toHaveBeenCalledOnce();
	await setImmediate();
	expect(released).not.toHaveBeenCalled();
	inFlight.resolve({ cursor: fact.id });
	await completion;
	test.append();
	await setImmediate();
	expect(test.deliver).toHaveBeenCalledOnce();
});

it("stops delivery when the attachment signal aborts", async () => {
	const test = fixture();
	const attachment = test.attach();
	test.append();
	test.controller.abort();
	test.append();
	await setImmediate();
	expect(test.deliver).not.toHaveBeenCalled();
	expect(test.unsubscribe).toHaveBeenCalledOnce();
	await attachment.release();
});

it("propagates a delivery drain error through release", async () => {
	const test = fixture();
	test.deliver.mockRejectedValueOnce(new Error("Delivery failed"));
	const attachment = test.attach();
	test.append();
	await setImmediate();
	await expect(attachment.release()).rejects.toThrow("OUTCOME_UNKNOWN");
});

function nativeFacade(dispose: () => Promise<void>) {
	const factOwner = { cursor: async () => null, deliver: async () => ({ cursor: "fact-1" }) };
	return createNativeSessionFacade({
		native: { extension: () => undefined, dispose, factOwner },
		lifetime: new AbortController(),
		call: async () => undefined,
		resolveCaller: () => undefined,
	});
}

it("waits for all retained releases before disposing the underlying native once", async () => {
	const dispose = vi.fn(async () => undefined);
	const native = nativeFacade(dispose);
	assert(native.retainFactOwner);
	const first = deferred<void>();
	const second = deferred<void>();
	native.retainFactOwner(() => first.promise);
	native.retainFactOwner(() => second.promise);
	const closing = native.dispose();
	expect(native.dispose()).toBe(closing);
	first.resolve();
	await setImmediate();
	expect(dispose).not.toHaveBeenCalled();
	second.resolve();
	await closing;
	expect(dispose).toHaveBeenCalledOnce();
});

it.each([false, true])("disposes even after release fails (native failure: %s)", async (fails) => {
	const releaseFailure = new Error("Release failed");
	const disposalFailure = new Error("Dispose failed");
	const dispose = vi.fn(async () => {
		if (fails) throw disposalFailure;
	});
	const native = nativeFacade(dispose);
	assert(native.retainFactOwner);
	native.retainFactOwner(() => Promise.reject(releaseFailure));
	await expect(native.dispose()).rejects.toBeInstanceOf(AggregateError);
	await expect(native.dispose()).rejects.toMatchObject({
		errors: fails ? [releaseFailure, disposalFailure] : [releaseFailure],
	});
	expect(dispose).toHaveBeenCalledOnce();
});
