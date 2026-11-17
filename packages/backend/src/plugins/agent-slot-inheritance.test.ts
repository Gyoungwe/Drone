import { AsyncResource } from "node:async_hooks";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import {
	acquireNativeSubagentSlot,
	nativeSubagentSlotCounts,
	withNativeSubagentSlot,
} from "../tools/subagent/slots";
import { agentSlotCapabilityHandlers } from "./agent-slot-capabilities";
import { PluginRuntimeRegistry } from "./runtime";
import { PluginCapabilityBroker, type PluginCapabilityContext } from "./runtime-capabilities";

function deferred<T>() {
	let resolve: (value: T | PromiseLike<T>) => void = vi.fn();
	const promise = new Promise<T>((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
}

function caller(cwd: string, signal: AbortSignal, sessionId = "native-child") {
	const identity = {};
	return {
		pluginId: "plugin",
		applicationId: "app",
		callerIdentity: identity,
		sessionIdentity: identity,
		bootstrap: false,
		signal,
		scope: { kind: "session", workspaceId: cwd, workspaceDirectory: cwd, sessionId },
	} satisfies Omit<PluginCapabilityContext, "capabilities">;
}

function nativeRun(cwd: string, finish: Promise<void>, work: () => Promise<unknown>) {
	const ready = deferred<void>();
	const operation = withNativeSubagentSlot(cwd, undefined, async () => {
		await work();
		ready.resolve();
		await finish;
	});
	return { ready: ready.promise, operation };
}

async function setup() {
	const cwd = await mkdtemp(join(tmpdir(), "drone-agent-slot-inheritance-"));
	await mkdir(join(cwd, ".pi"));
	await writeFile(join(cwd, ".pi/research-workspace.json"), '{"maxConcurrentSubagents":1}');
	const acquire = vi.fn(acquireNativeSubagentSlot);
	const broker = new PluginCapabilityBroker({
		handlers: agentSlotCapabilityHandlers({ acquire }),
		resources: [],
	});
	const controllers: AbortController[] = [];
	const operations: Promise<unknown>[] = [];
	const finishers: Array<() => void> = [];
	function gate() {
		const finish = deferred<void>();
		finishers.push(finish.resolve);
		return finish;
	}
	function invoke<T>(work: (controller: AbortController) => Promise<T>, sessionId = "native-child") {
		const controller = new AbortController();
		controllers.push(controller);
		const operation = broker.run(
			caller(cwd, controller.signal, sessionId),
			"read",
			vi.fn(),
			async () => true,
			() => work(controller),
		);
		operations.push(operation);
		return operation;
	}
	onTestFinished(async () => {
		for (const controller of controllers) controller.abort();
		for (const finish of finishers) finish();
		await Promise.allSettled(operations);
	});
	const holdNative = (work: () => Promise<unknown>) => {
		const finish = gate();
		const run = nativeRun(cwd, finish.promise, work);
		operations.push(run.operation);
		return {
			ready: run.ready,
			release: async () => {
				finish.resolve();
				await run.operation;
			},
		};
	};
	return { cwd, broker, invoke, acquire, gate, holdNative };
}

async function bounded<T>(request: Promise<T>): Promise<T | "pending"> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			request,
			new Promise<"pending">((resolve) => {
				timer = setTimeout(() => resolve("pending"), 100);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

it("inherits the only project slot inside a native subagent invocation without waiting", async () => {
	const slots = await setup();
	expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 0, project: 0 });
	await withNativeSubagentSlot(slots.cwd, undefined, async () => {
		const operation = slots.invoke(async () => {
			const lease = await slots.broker.port.call("agent.slot.acquire", {});
			expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 1, project: 1 });
			return lease;
		});
		expect(await bounded(operation)).toHaveProperty("lease");
		expect(slots.acquire).not.toHaveBeenCalled();
		expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 1, project: 1 });
	});
	expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 0, project: 0 });
});

async function enqueue(slots: Awaited<ReturnType<typeof setup>>, sessionId = "ordinary") {
	const queued = deferred<void>(),
		acquired = deferred<unknown>(),
		finish = slots.gate();
	const admitted = vi.fn();
	const operation = slots.invoke(async (controller) => {
		const signal = controller.signal;
		const add = signal.addEventListener.bind(signal);
		vi.spyOn(signal, "addEventListener").mockImplementationOnce((type, listener, options) => {
			add(type, listener, options);
			queued.resolve();
		});
		const lease = await slots.broker.port.call("agent.slot.acquire", {});
		admitted();
		acquired.resolve(lease);
		await finish.promise;
	}, sessionId);
	await queued.promise;
	return {
		acquired: acquired.promise,
		admitted,
		release: async () => {
			finish.resolve();
			await operation;
		},
	};
}

it("keeps the outer slot after explicit inherited release and admits an unrelated caller exactly once", async () => {
	const slots = await setup();
	const outer = slots.holdNative(() =>
		slots.invoke(async () => {
			const lease = await slots.broker.port.call("agent.slot.acquire", {});
			await expect(slots.broker.port.call("agent.slot.release", lease)).resolves.toEqual({ released: true });
			await expect(slots.broker.port.call("agent.slot.release", lease)).resolves.toEqual({ released: false });
		}),
	);
	await outer.ready;
	expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 1, project: 1 });
	const waiting = await enqueue(slots);
	expect(waiting.admitted).not.toHaveBeenCalled();
	await outer.release();
	await waiting.acquired;
	expect(waiting.admitted).toHaveBeenCalledTimes(1);
	expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 1, project: 1 });
	await outer.release();
	expect(waiting.admitted).toHaveBeenCalledTimes(1);
	await waiting.release();
	expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 0, project: 0 });
});

it.each(["success", "throw", "abort"])(
	"keeps the outer slot after inherited invocation %s",
	async (outcome) => {
		const slots = await setup();
		const failure = new Error("Invocation failed");
		const outer = slots.holdNative(async () => {
			const operation = slots.invoke(async (controller) => {
				await slots.broker.port.call("agent.slot.acquire", {});
				if (outcome === "throw") throw failure;
				if (outcome === "abort") {
					controller.abort(failure);
					controller.signal.throwIfAborted();
				}
			});
			if (outcome === "success") await operation;
			else await expect(operation).rejects.toBe(failure);
		});
		await outer.ready;
		expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 1, project: 1 });
		const waiting = await enqueue(slots);
		expect(waiting.admitted).not.toHaveBeenCalled();
		await outer.release();
		await waiting.acquired;
		expect(waiting.admitted).toHaveBeenCalledTimes(1);
		await waiting.release();
		expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 0, project: 0 });
	},
);

it.each(["ordinary", "subagent-vault-reader"])(
	"queues session %s when its run holds no native slot",
	async (sessionId) => {
		const slots = await setup();
		const outer = slots.holdNative(async () => undefined);
		await outer.ready;
		const waiting = await enqueue(slots, sessionId);
		expect(waiting.admitted).not.toHaveBeenCalled();
		expect(slots.acquire).toHaveBeenCalledTimes(1);
		expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 1, project: 1 });
		await outer.release();
		await waiting.acquired;
		expect(waiting.admitted).toHaveBeenCalledTimes(1);
		await waiting.release();
		expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 0, project: 0 });
	},
);

it("makes an inherited lease inert when the outer run finishes first", async () => {
	const slots = await setup();
	const acquired = deferred<void>(),
		releaseInherited = slots.gate();
	let operation: Promise<unknown> = Promise.resolve();
	await withNativeSubagentSlot(slots.cwd, undefined, async () => {
		operation = slots.invoke(async () => {
			const lease = await slots.broker.port.call("agent.slot.acquire", {});
			acquired.resolve();
			await releaseInherited.promise;
			await expect(slots.broker.port.call("agent.slot.release", lease)).resolves.toEqual({ released: true });
		});
		await acquired.promise;
	});
	const waiting = await enqueue(slots);
	await waiting.acquired;
	releaseInherited.resolve();
	await operation;
	expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 1, project: 1 });
	const next = await enqueue(slots);
	expect(next.admitted).not.toHaveBeenCalled();
	await waiting.release();
	await next.acquired;
	expect(next.admitted).toHaveBeenCalledTimes(1);
	await next.release();
	expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 0, project: 0 });
});

it("does not lend an expired native run's async context to a later invocation", async () => {
	const slots = await setup();
	let invokeLater: () => Promise<unknown> = vi.fn();
	await withNativeSubagentSlot(slots.cwd, undefined, async () => {
		invokeLater = AsyncResource.bind(() =>
			slots.invoke(() => slots.broker.port.call("agent.slot.acquire", {})),
		);
	});
	const outer = slots.holdNative(async () => undefined);
	await outer.ready;
	const operation = invokeLater();
	expect(await bounded(operation)).toBe("pending");
	expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 1, project: 1 });
	await outer.release();
	await expect(operation).resolves.toHaveProperty("lease");
	expect(slots.acquire).toHaveBeenCalledTimes(1);
	expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 0, project: 0 });
});

it("inherits independently when all three global slots belong to native runs", async () => {
	const projects = await Promise.all([setup(), setup(), setup()]);
	const runs = projects.map((slots) =>
		slots.holdNative(() => slots.invoke(() => slots.broker.port.call("agent.slot.acquire", {}))),
	);
	await Promise.all(runs.map((run) => run.ready));
	for (const slots of projects) {
		expect(slots.acquire).not.toHaveBeenCalled();
		expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 3, project: 1 });
	}
	await Promise.all(runs.map((run) => run.release()));
	for (const slots of projects)
		expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 0, project: 0 });
});

it("settles inherited leases during owner disposal without releasing the native run's slot", async () => {
	const slots = await setup();
	const ready = deferred<void>();
	const registry = new PluginRuntimeRegistry(
		{
			authorizeActivation: async () => true,
			authorizeInvocation: async () => true,
		},
		"app",
		{ handlers: agentSlotCapabilityHandlers(), resources: [] },
	);
	registry.register("plugin", async () => ({
		operations: {
			hold: {
				inputSchema: { type: "null" },
				resultSchema: { type: "null" },
				effect: "read",
				execute: async (_input, { signal, capabilities }) => {
					await capabilities.call("agent.slot.acquire", {});
					ready.resolve();
					await new Promise<void>((resolve) =>
						signal.addEventListener("abort", () => resolve(), { once: true }),
					);
					return null;
				},
			},
		},
		dispose: async () => undefined,
	}));
	const context = caller(slots.cwd, new AbortController().signal);
	const client = await registry.activate("plugin", () => ({ ...context, identity: context.callerIdentity }));
	onTestFinished(() => registry.deactivate("plugin"));
	let invocation: Promise<unknown> = Promise.resolve();
	const outer = slots.holdNative(async () => {
		invocation = client.invoke("hold", null);
		await ready.promise;
	});
	await outer.ready;
	const rejected = expect(invocation).rejects.toThrow("deactivated");
	await registry.deactivate("plugin");
	await rejected;
	expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 1, project: 1 });
	const waiting = await enqueue(slots);
	expect(waiting.admitted).not.toHaveBeenCalled();
	await outer.release();
	await waiting.acquired;
	expect(waiting.admitted).toHaveBeenCalledTimes(1);
	await waiting.release();
	expect(nativeSubagentSlotCounts(slots.cwd)).toEqual({ active: 0, project: 0 });
});
