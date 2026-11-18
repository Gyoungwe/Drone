import type { Fact, HostFactDelivery, HostFactDeliveryOwner } from "@gyoungwe/plugin-api/p5-inquiry";
import { expect, it, vi } from "vitest";
import { type createP5FactStore, p5FactSummary } from "./p5-facts";
import { createP5HostDelivery, type P5ActiveFactOwner } from "./p5-host-delivery";

function deferred<T>() {
	let resolve: (value: T | PromiseLike<T>) => void = vi.fn();
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}
function fact(index: number, kind: Fact["kind"] = "compute"): Fact {
	const metadata = {
		id: `fact:${index}`,
		sequence: index,
		kind,
		entityId: "run:1",
		at: "2026-11-18T00:00:00Z",
		status: "succeeded",
		artifactRefs: [],
		runReceiptRef: null,
		decisionKind: null,
		basis: [],
	} as const;
	return { ...metadata, summary: p5FactSummary(metadata) };
}
function acknowledge(delivery: HostFactDelivery) {
	if (delivery.cursor === null) throw new Error("Expected facts");
	return { cursor: delivery.cursor };
}
function fixture() {
	const journal = [fact(1), fact(2, "local-execution"), fact(3, "decision"), fact(4, "task-accepted")];
	const controller = new AbortController();
	const deliver = vi.fn<HostFactDeliveryOwner["deliver"]>(async (batch) => acknowledge(batch));
	const attachment: P5ActiveFactOwner = {
		workspaceId: "workspace:1",
		sessionId: "session:1",
		callerSourceHash: "a".repeat(64),
		providerSourceHash: "b".repeat(64),
		owner: { deliver },
		signal: controller.signal,
	};
	const current = {
		attachment: attachment as P5ActiveFactOwner | undefined,
		allowed: true,
		cursor: null as string | null,
	};
	const listeners = new Set<() => void>();
	const unsubscribe = vi.fn((listener: () => void) => {
		listeners.delete(listener);
	});
	const read = vi.fn<ReturnType<typeof createP5FactStore>["read"]>(async (scope, input) => {
		expect(scope).toEqual({ workspaceId: "workspace:1", sessionId: "session:1" });
		const start = input.after === null ? 0 : journal.findIndex((entry) => entry.id === input.after) + 1;
		const facts = journal.slice(start, start + input.limit);
		return { cursor: facts.at(-1)?.id ?? input.after, facts };
	});
	const authorize = vi.fn(async () => current.allowed);
	const lifecycle = createP5HostDelivery({
		facts: { read },
		currentOwner: () => current.attachment,
		authorize,
		cursorOf: async () => current.cursor,
		subscribe: (owner, listener) => {
			expect(owner).toBe(current.attachment);
			listeners.add(listener);
			return () => unsubscribe(listener);
		},
	});
	return {
		journal,
		controller,
		deliver,
		attachment,
		current,
		listeners,
		unsubscribe,
		read,
		authorize,
		lifecycle,
		wake: () => {
			for (const listener of listeners) listener();
		},
		bind: () => lifecycle.bind(attachment.owner),
	};
}

it("delivers ordered facts only to the active host owner with a private, uncopyable origin", async () => {
	const f = fixture();
	expect(f.read).not.toHaveBeenCalled();
	expect(() => f.lifecycle.bind({ deliver: vi.fn() })).toThrow("SCOPE_CHANGED");
	const binding = f.bind();
	await binding.drain();
	const batch = f.deliver.mock.calls[0]?.[0];
	expect(batch?.facts).toEqual(f.journal);
	if (!batch) throw new Error("Expected delivery");
	const origin = f.lifecycle.originOf(batch.handle);
	expect(origin).toMatchObject({ attachment: f.attachment });
	expect(f.lifecycle.originOf(JSON.parse(JSON.stringify(batch.handle)))).toBeUndefined();
	f.wake();
	await binding.drain();
	expect(f.deliver).toHaveBeenCalledTimes(1);
	binding.unsubscribe();
	expect(origin?.signal.aborted).toBe(true);
	expect(f.lifecycle.originOf(batch.handle)).toBeUndefined();
	await binding.drain();
	f.current.cursor = "fact:4";
	f.journal.push(fact(5));
	const adopted = f.bind();
	await adopted.drain();
	expect(f.deliver.mock.calls[1]?.[0].facts).toEqual([fact(5)]);
	adopted.unsubscribe();
	await adopted.drain();
});

it("rejects absent or revoked owners without subscribing or implicitly attaching", () => {
	const f = fixture();
	f.current.attachment = undefined;
	expect(f.bind).toThrow("SCOPE_CHANGED");
	f.current.attachment = f.attachment;
	f.controller.abort();
	expect(f.bind).toThrow("SCOPE_CHANGED");
	expect(f.listeners.size).toBe(0);
});

it("retains denied facts and resumes only when current S allows the original owner", async () => {
	const f = fixture();
	f.current.allowed = false;
	const binding = f.bind();
	await binding.drain();
	expect(f.deliver).not.toHaveBeenCalled();
	expect(f.journal).toHaveLength(4);
	binding.unsubscribe();
	await binding.drain();
	f.current.allowed = true;
	const adopted = f.bind();
	await adopted.drain();
	expect(f.deliver.mock.calls[0]?.[0].facts).toEqual(f.journal);
	adopted.unsubscribe();
	await adopted.drain();
});

it("serializes notifications, paginates, and advances only to a committed acknowledgement", async () => {
	const f = fixture();
	f.journal.splice(0, 4, ...Array.from({ length: 66 }, (_, index) => fact(index + 1)));
	f.deliver.mockImplementationOnce(async () => ({ cursor: "fact:1" }));
	const binding = f.bind();
	await binding.drain();
	f.wake();
	f.wake();
	await binding.drain();
	expect(f.deliver.mock.calls.map(([batch]) => batch.facts.length)).toEqual([64, 64, 1]);
	expect(f.read.mock.calls.map(([, input]) => input.after)).toEqual([null, "fact:1", "fact:65", "fact:66"]);
	binding.unsubscribe();
	await binding.drain();
});

it.each(["unsubscribe", "revoke", "switch"])(
	"%s stops queued work and drains before owner replacement",
	async (action) => {
		const f = fixture();
		const started = deferred<HostFactDelivery>();
		const completion = deferred<{ cursor: string }>();
		f.deliver.mockImplementationOnce((batch) => {
			started.resolve(batch);
			return completion.promise;
		});
		const binding = f.bind();
		const batch = await started.promise;
		f.wake();
		if (action === "revoke") f.controller.abort();
		else if (action === "switch") {
			f.current.attachment = { ...f.attachment, sessionId: "session:2", owner: { deliver: vi.fn() } };
			f.wake();
		} else binding.unsubscribe();
		expect(f.lifecycle.originOf(batch.handle)).toBeUndefined();
		expect(f.unsubscribe).toHaveBeenCalledTimes(1);
		const drained = vi.fn();
		const draining = binding.drain().then(drained);
		await Promise.resolve();
		expect(drained).not.toHaveBeenCalled();
		expect(() => f.lifecycle.bind(f.current.attachment?.owner ?? f.attachment.owner)).toThrow();
		completion.resolve({ cursor: "fact:4" });
		await draining;
		expect(f.deliver).toHaveBeenCalledTimes(1);
		expect(f.current.attachment?.owner.deliver).toHaveBeenCalledTimes(action === "switch" ? 0 : 1);
		expect(f.journal).toHaveLength(4);
	},
);

it.each(["read", "authorize"])("rechecks the active attachment after awaited %s", async (stage) => {
	const f = fixture();
	const waiting = deferred<void>();
	const started = deferred<void>();
	if (stage === "read")
		f.read.mockImplementationOnce(async () => {
			started.resolve();
			await waiting.promise;
			return { cursor: "fact:4", facts: f.journal };
		});
	else
		f.authorize.mockImplementationOnce(async () => {
			started.resolve();
			await waiting.promise;
			return true;
		});
	const binding = f.bind();
	await started.promise;
	f.current.attachment = { ...f.attachment, providerSourceHash: "c".repeat(64) };
	waiting.resolve();
	await binding.drain();
	expect(f.deliver).not.toHaveBeenCalled();
	expect(f.listeners.size).toBe(0);
});

it.each(["rejection", "foreign cursor"])(
	"keeps failed delivery pending and exposes only a public code: %s",
	async (failure) => {
		const f = fixture();
		if (failure === "rejection") f.deliver.mockRejectedValueOnce(new Error("Synthetic private diagnostic"));
		else f.deliver.mockResolvedValueOnce({ cursor: "foreign:1" });
		const binding = f.bind();
		await expect(binding.drain()).rejects.toMatchObject({
			code: failure === "rejection" ? "OUTCOME_UNKNOWN" : "INVALID_INPUT",
			message: failure === "rejection" ? "OUTCOME_UNKNOWN" : "INVALID_INPUT",
		});
		expect(f.journal).toHaveLength(4);
		expect(f.listeners.size).toBe(0);
	},
);
