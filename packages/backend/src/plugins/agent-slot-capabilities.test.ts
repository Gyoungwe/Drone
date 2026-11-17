import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { expect, it, onTestFinished, vi } from "vitest";
import { agentSlotCapabilityHandlers } from "./agent-slot-capabilities";
import { PluginCapabilityBroker, type PluginCapabilityContext } from "./runtime-capabilities";

function deferred<T>() {
	let resolve: (value: T | PromiseLike<T>) => void = vi.fn();
	let reject: (error: Error) => void = vi.fn();
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function caller(cwd: string, overrides: Partial<PluginCapabilityContext> = {}) {
	const controller = new AbortController();
	const finalizers: Array<() => void> = [];
	const context: PluginCapabilityContext = {
		pluginId: "plugin",
		applicationId: "app",
		callerIdentity: {},
		bootstrap: false,
		scope: { kind: "workspace", workspaceId: cwd, workspaceDirectory: cwd },
		signal: controller.signal,
		capabilities: { call: vi.fn() },
		invocationToken: {},
		onInvocationSettled: (finalizer) => finalizers.push(finalizer),
		...overrides,
	};
	return { context, controller, finalizers };
}

async function setupSlots() {
	const cwd = await mkdtemp(join(tmpdir(), "drone-agent-slot-capabilities-"));
	const handlers = agentSlotCapabilityHandlers();
	const callers: ReturnType<typeof caller>[] = [];
	const requests: Promise<unknown>[] = [];
	const createCaller = (overrides: Partial<PluginCapabilityContext> = {}) => {
		const selected = caller(cwd, overrides);
		callers.push(selected);
		return selected;
	};
	const acquire = (selected = createCaller()) => {
		const request = handlers["agent.slot.acquire"].execute({}, selected.context) as Promise<{
			lease: string;
		}>;
		requests.push(request);
		return request;
	};
	const enqueue = async (selected = createCaller()) => {
		const enqueued = deferred<void>();
		const signal = selected.context.signal;
		const add = signal.addEventListener.bind(signal);
		vi.spyOn(signal, "addEventListener").mockImplementationOnce((type, listener, options) => {
			add(type, listener, options);
			enqueued.resolve();
		});
		const acquired = acquire(selected);
		await enqueued.promise;
		return { ...selected, acquired };
	};
	const release = (lease: string, selected: ReturnType<typeof caller>) =>
		handlers["agent.slot.release"].execute({ lease }, selected.context);
	onTestFinished(async () => {
		for (const selected of callers) selected.controller.abort();
		await Promise.allSettled(requests);
		for (const selected of callers) for (const finalizer of selected.finalizers.reverse()) finalizer();
	});
	return { cwd, handlers, createCaller, acquire, enqueue, release };
}

it("shares three slots across workspaces and a double release admits only one waiter", async () => {
	const slots = await setupSlots();
	const owner = slots.createCaller();
	const { lease } = await slots.acquire(owner);
	expect(lease).toMatch(/^[0-9a-f-]{36}$/);
	await slots.acquire();
	await slots.acquire();
	const other = slots.createCaller({
		scope: { kind: "workspace", workspaceId: "other", workspaceDirectory: join(slots.cwd, "other") },
	});
	const first = await slots.enqueue(other);
	const second = await slots.enqueue();
	const admitted: string[] = [];
	const firstLease = first.acquired.then((result) => {
		admitted.push("first");
		return result.lease;
	});
	const secondLease = second.acquired.then((result) => {
		admitted.push("second");
		return result.lease;
	});
	expect(admitted).toEqual([]);
	await expect(slots.release("unknown", owner)).resolves.toEqual({ released: false });
	await expect(slots.release(lease, owner)).resolves.toEqual({ released: true });
	await expect(slots.release(lease, owner)).resolves.toEqual({ released: false });
	const granted = await firstLease;
	expect(admitted).toEqual(["first"]);
	await slots.release(granted, first);
	await secondLease;
	expect(admitted).toEqual(["first", "second"]);
});

it.each(["success", "throw", "abort"])("frees forgotten leases after invocation %s", async (outcome) => {
	const slots = await setupSlots();
	await slots.acquire();
	await slots.acquire();
	const selected = slots.createCaller();
	const ready = deferred<void>();
	const finish = deferred<void>();
	const broker = new PluginCapabilityBroker({ handlers: slots.handlers, resources: [] });
	const failure = new Error("Operation failed");
	const operation = broker.run(
		selected.context,
		"read",
		vi.fn(),
		async () => true,
		async () => {
			await broker.port.call("agent.slot.acquire", {});
			ready.resolve();
			await finish.promise;
			return "completed";
		},
	);
	await ready.promise;
	const waiting = await slots.enqueue();
	const admitted = vi.fn();
	const acquired = waiting.acquired.then(admitted);
	expect(admitted).not.toHaveBeenCalled();
	const settled =
		outcome === "success"
			? expect(operation).resolves.toBe("completed")
			: expect(operation).rejects.toBe(failure);
	if (outcome === "abort") {
		selected.context.signal.addEventListener("abort", () => finish.reject(failure), { once: true });
		selected.controller.abort(failure);
	} else if (outcome === "throw") finish.reject(failure);
	else finish.resolve();
	await settled;
	await acquired;
	expect(admitted).toHaveBeenCalledTimes(1);
});

it.each(["pluginId", "applicationId", "invocationToken"] as const)(
	"rejects another %s without freeing the owner's slot",
	async (field) => {
		const slots = await setupSlots();
		const owner = slots.createCaller();
		const { lease } = await slots.acquire(owner);
		await slots.acquire();
		await slots.acquire();
		const waiting = await slots.enqueue();
		const admitted = vi.fn();
		const acquired = waiting.acquired.then(admitted);
		const stranger = slots.createCaller({
			...owner.context,
			[field]: field === "invocationToken" ? {} : "other",
		});
		await expect(slots.release(lease, stranger)).rejects.toThrow(
			"Agent slot lease belongs to another caller",
		);
		expect(admitted).not.toHaveBeenCalled();
		await slots.release(lease, owner);
		await acquired;
		expect(admitted).toHaveBeenCalledTimes(1);
	},
);

it("rejects an application caller and missing invocation authority before acquiring", async () => {
	const acquire = vi.fn(async () => vi.fn());
	const handlers = agentSlotCapabilityHandlers({ acquire });
	for (const overrides of [
		{ scope: { kind: "application" as const } },
		{ invocationToken: undefined },
		{ onInvocationSettled: undefined },
	]) {
		const { context } = caller("/workspace", overrides);
		await expect(handlers["agent.slot.acquire"].execute({}, context)).rejects.toThrow(
			overrides.scope ? "Agent slot needs a workspace caller" : "Agent slot needs an operation invocation",
		);
	}
	expect(acquire).not.toHaveBeenCalled();
});

it("releases immediately when finalizer registration fails", async () => {
	const release = vi.fn();
	const failure = new Error("Registration failed");
	const handlers = agentSlotCapabilityHandlers({ acquire: async () => release });
	const { context } = caller("/workspace", {
		onInvocationSettled: () => {
			throw failure;
		},
	});
	await expect(handlers["agent.slot.acquire"].execute({}, context)).rejects.toBe(failure);
	expect(release).toHaveBeenCalledTimes(1);
});

it("assigns fresh invocation identities and permits release through a narrowed signal", async () => {
	const slots = await setupSlots();
	const selected = slots.createCaller();
	const broker = new PluginCapabilityBroker({ handlers: slots.handlers, resources: [] });
	await broker.run(
		selected.context,
		"read",
		vi.fn(),
		async () => true,
		async () => {
			const lease = await broker.port.call("agent.slot.acquire", {});
			await broker.run(
				selected.context,
				"read",
				vi.fn(),
				async () => true,
				async () => {
					await expect(broker.port.call("agent.slot.release", lease)).rejects.toThrow(
						"Agent slot lease belongs to another caller",
					);
				},
			);
			await expect(
				broker.port.call("agent.slot.release", lease, new AbortController().signal),
			).resolves.toEqual({ released: true });
		},
	);
});

it("cleans up a granted lease even when cancellation prevents the plugin receiving it", async () => {
	const slots = await setupSlots();
	const owner = slots.createCaller();
	const { lease } = await slots.acquire(owner);
	await slots.acquire();
	await slots.acquire();
	const selected = slots.createCaller();
	const queued = deferred<void>();
	const signal = selected.context.signal;
	const add = signal.addEventListener.bind(signal);
	vi.spyOn(signal, "addEventListener").mockImplementationOnce((type, listener, options) => {
		add(type, listener, options);
		queued.resolve();
	});
	const broker = new PluginCapabilityBroker({ handlers: slots.handlers, resources: [] });
	const operation = broker.run(
		selected.context,
		"read",
		vi.fn(),
		async () => true,
		() => broker.port.call("agent.slot.acquire", {}),
	);
	const failure = new Error("Cancelled after grant");
	const rejection = expect(operation).rejects.toBe(failure);
	await queued.promise;
	const waiting = await slots.enqueue();
	const released = slots.release(lease, owner);
	selected.controller.abort(failure);
	await released;
	await rejection;
	expect(await waiting.acquired).toHaveProperty("lease");
});

it("propagates queued cancellation without leaving an occupied slot", async () => {
	const slots = await setupSlots();
	const owner = slots.createCaller();
	const { lease } = await slots.acquire(owner);
	await slots.acquire();
	await slots.acquire();
	const cancelled = await slots.enqueue();
	const rejection = expect(cancelled.acquired).rejects.toThrow("Native subagent cancelled while queued");
	cancelled.controller.abort();
	await rejection;
	const waiting = await slots.enqueue();
	await slots.release(lease, owner);
	const granted = await waiting.acquired;
	await slots.release(granted.lease, waiting);
	await slots.acquire();
});

it("accepts only schema-valid read-effect slot calls without an approval category", async () => {
	const handlers = agentSlotCapabilityHandlers({ acquire: async () => vi.fn() });
	for (const handler of Object.values(handlers)) {
		expect(handler.effect).toBe("read");
		expect(handler.approval).toBeUndefined();
	}
	const broker = new PluginCapabilityBroker({ handlers, resources: [] });
	await broker.run(
		caller("/workspace").context,
		"read",
		vi.fn(),
		async () => true,
		async () => {
			await expect(broker.port.call("agent.slot.acquire", { extra: true })).rejects.toThrow(
				"Invalid plugin capability input",
			);
			for (const input of [{ lease: "" }, { lease: "a".repeat(129) }, { lease: "x", extra: true }]) {
				await expect(broker.port.call("agent.slot.release", input)).rejects.toThrow(
					"Invalid plugin capability input",
				);
			}
		},
	);
});

it.each([false, true])(
	"collects finalizer failures without skipping cleanup; work failed: %s",
	async (fails) => {
		const cleanup = new Error("Cleanup failed");
		const work = new Error("Work failed");
		const finalized = vi.fn();
		const broker = new PluginCapabilityBroker({
			resources: [],
			handlers: {
				read: {
					inputSchema: Type.Null(),
					resultSchema: Type.Null(),
					effect: "read",
					execute: async (_input, context) => {
						context.onInvocationSettled?.(finalized);
						context.onInvocationSettled?.(() => {
							throw cleanup;
						});
						return null;
					},
				},
			},
		});
		const invocation = broker.run(
			caller("/workspace").context,
			"read",
			vi.fn(),
			async () => true,
			async () => {
				await broker.port.call("read", null);
				if (fails) throw work;
			},
		);
		if (fails) await expect(invocation).rejects.toMatchObject({ errors: [work, cleanup] });
		else await expect(invocation).rejects.toBe(cleanup);
		expect(finalized).toHaveBeenCalledTimes(1);
	},
);
