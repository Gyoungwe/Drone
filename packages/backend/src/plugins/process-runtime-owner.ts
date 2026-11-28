import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import type { PluginHostEvent } from "@gyoungwe/plugin-api/host-events";
import type {
	PluginNativeSessionFacts,
	PluginRuntimeContext,
	PluginRuntimeFactoryContext,
	PluginRuntimeInstance,
} from "@gyoungwe/plugin-api/runtime";
import type { HostNativeSession } from "./p5-owner-facade";
import { attachProcessNative, type ProcessNativeHost } from "./process-native-attachment";
import type { ProcessPluginRuntimeOptions } from "./process-runtime";
import { GuestTimeBudget } from "./process-runtime-budget";
import {
	bindProcessRuntimeCapabilities,
	type Declarations,
	executeProcessRuntimeCapability,
	type HostEventSubscribeMessage,
	type Message,
	type NativeToolUpdate,
	type PendingInvocation,
	readProcessRuntimeMessages,
} from "./process-runtime-messages";

const MAX_QUEUE_COUNT = 256;
const MAX_QUEUE_BYTES = 1024 * 1024;
type HostEventSubscription = {
	unsubscribe: () => void;
	queue: { encoded: string; bytes: number }[];
	queuedBytes: number;
	draining: boolean;
};
export class RuntimeProcess {
	private sequence = 0;
	private failure: Error | undefined;
	private stderr = "";
	private disposed = false;
	private readonly nativeDisposers = new Set<() => Promise<void>>();
	private shutdownTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly closed: Promise<void>;
	private bootstrapBudget: GuestTimeBudget | undefined;
	private childClosed = false;
	private shutdownPending: Promise<void> | undefined;
	private readonly messageIds = new Set<string>();
	private readonly hostEventSubscriptions = new Map<string, HostEventSubscription>();
	private readonly resourceCleanups = new Set<Promise<void>>();
	private readonly hostCapabilities = new Map<
		string,
		Record<"callId" | "cancelKey", string> & { abort: AbortController; settled: Promise<void> }
	>();
	private readonly pending = new Map<
		string,
		PendingInvocation & { budget: GuestTimeBudget; context?: PluginRuntimeContext }
	>();
	private readonly ready: Promise<Declarations>;
	private readonly bootstrapContext: PluginRuntimeFactoryContext;
	private resolveReady!: (operations: Declarations) => void;
	private rejectReady!: (error: Error) => void;
	constructor(
		private readonly pluginId: string,
		private readonly child: ChildProcessWithoutNullStreams,
		private readonly context: PluginRuntimeFactoryContext,
		private readonly resource: ProcessPluginRuntimeOptions["resource"],
	) {
		this.bootstrapContext = {
			...context,
			capabilities: bindProcessRuntimeCapabilities(context.capabilities),
		};
		this.ready = new Promise((resolve, reject) => {
			this.resolveReady = resolve;
			this.rejectReady = reject;
		});
		const lines = readProcessRuntimeMessages(child.stdout, {
			failed: () => this.failure !== undefined,
			context,
			pending: this.pending,
			fail: (error) => this.fail(error),
			ready: (declarations) => this.resolveReady(declarations),
			disposeResources: (message) => this.receiveResourceCleanup(message),
			cancelCapability: (message) => {
				const call = this.hostCapabilities.get(message.id);
				if (call?.callId === message.callId && call.cancelKey === message.cancelKey)
					call.abort.abort(new Error("Plugin capability locally canceled"));
			},
			subscribeHostEvent: (message) => this.subscribeHostEvent(message),
			unsubscribeHostEvent: (message) => this.unsubscribeHostEvent(message.id),
			capability: (message) => this.capability(message),
		});
		child.stderr.on("data", (chunk: Buffer) => {
			this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-8000);
		});
		child.once("error", (error) => this.fail(error));
		child.stdin.on("error", (error) => this.fail(error));
		this.closed = new Promise((resolve) =>
			child.once("close", async (code) => {
				this.childClosed = true;
				this.disposeHostEventSubscriptions();
				clearTimeout(this.shutdownTimer);
				context.signal.removeEventListener("abort", this.stop);
				lines.close();
				if (!this.disposed || code !== 0) {
					this.failure ??= new Error(`Plugin runtime ${pluginId} exited (${code}): ${this.stderr.trim()}`);
				}
				const error = this.failure ?? new Error(`Plugin runtime ${pluginId} is closed`);
				this.bootstrapBudget?.dispose();
				for (const pending of this.pending.values()) pending.budget.dispose();
				await this.drainCapabilities(error);
				this.rejectReady(error);
				for (const pending of this.pending.values()) {
					pending.cleanup();
					pending.reject(error);
				}
				this.pending.clear();
				resolve();
			}),
		);
		context.signal.addEventListener("abort", this.stop, { once: true });
		if (context.signal.aborted) this.stop();
	}
	private readonly stop = () => {
		this.disposeHostEventSubscriptions();
		this.send({ type: "stop" });
		this.boundShutdown();
	};
	private boundShutdown(): void {
		if (this.shutdownPending) return;
		const waiting = this.drainCapabilities();
		this.shutdownPending = waiting;
		void waiting.then(() => {
			if (this.childClosed || this.shutdownPending !== waiting) return;
			this.shutdownTimer = setTimeout(
				() => this.fail(new Error(`Plugin runtime ${this.pluginId} did not settle shutdown within 500ms`)),
				500,
			);
		});
	}
	private async drainCapabilities(reason?: Error): Promise<void> {
		while (this.hostCapabilities.size || this.resourceCleanups.size) {
			const active = [...this.hostCapabilities.values()];
			if (reason) for (const call of active) call.abort.abort(reason);
			await Promise.allSettled([...active.map((call) => call.settled), ...this.resourceCleanups]);
		}
	}
	private fail(error: Error): void {
		this.failure ??= error;
		this.disposeHostEventSubscriptions();
		this.bootstrapBudget?.dispose();
		for (const pending of this.pending.values()) pending.budget.dispose();
		for (const call of this.hostCapabilities.values()) call.abort.abort(this.failure);
		this.child.kill("SIGKILL");
	}
	private subscribeHostEvent({ id, topic }: HostEventSubscribeMessage): void {
		const source = this.context.hostEvents;
		if (!source) {
			this.fail(new Error("Requested host events without an approved source"));
			return;
		}
		if (this.messageIds.has(id)) {
			this.fail(new Error("Plugin reused a host event subscription id"));
			return;
		}
		this.messageIds.add(id);
		const subscription: HostEventSubscription = {
			unsubscribe: () => undefined,
			queue: [],
			queuedBytes: 0,
			draining: false,
		};
		this.hostEventSubscriptions.set(id, subscription);
		try {
			const unsubscribe = source.subscribe(topic, (event) => this.enqueueHostEvent(id, subscription, event));
			if (this.hostEventSubscriptions.get(id) === subscription) subscription.unsubscribe = unsubscribe;
			else unsubscribe();
		} catch (error) {
			this.hostEventSubscriptions.delete(id);
			this.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}
	private unsubscribeHostEvent(id: string): void {
		const subscription = this.hostEventSubscriptions.get(id);
		if (!subscription) return;
		this.hostEventSubscriptions.delete(id);
		subscription.unsubscribe();
		subscription.queue.length = subscription.queuedBytes = 0;
	}
	private disposeHostEventSubscriptions(): void {
		for (const id of this.hostEventSubscriptions.keys()) this.unsubscribeHostEvent(id);
	}
	private enqueueHostEvent(id: string, subscription: HostEventSubscription, event: PluginHostEvent): void {
		if (this.hostEventSubscriptions.get(id) !== subscription || this.failure) return;
		const encoded = `${JSON.stringify({ type: "host_event", id, ...event })}\n`;
		const bytes = Buffer.byteLength(encoded, "utf8");
		if (subscription.queue.length < MAX_QUEUE_COUNT && subscription.queuedBytes + bytes <= MAX_QUEUE_BYTES) {
			subscription.queue.push({ encoded, bytes });
			subscription.queuedBytes += bytes;
			void this.flushHostEventQueue(id, subscription);
			return;
		}
		this.unsubscribeHostEvent(id);
		this.fail(new Error(`Plugin host event queue overflow: ${this.pluginId} ${event.topic}`));
	}
	private async flushHostEventQueue(id: string, subscription: HostEventSubscription): Promise<void> {
		if (subscription.draining) return;
		subscription.draining = true;
		try {
			while (subscription.queue.length && !this.failure) {
				if (this.hostEventSubscriptions.get(id) !== subscription) break;
				const next = subscription.queue[0];
				if (!next) break;
				if (!this.child.stdin.write(next.encoded))
					await Promise.race([once(this.child.stdin, "drain"), this.closed]);
				if (this.childClosed || this.hostEventSubscriptions.get(id) !== subscription) return;
				subscription.queue.shift();
				subscription.queuedBytes -= next.bytes;
			}
		} catch (error) {
			this.fail(error instanceof Error ? error : new Error(String(error)));
		} finally {
			subscription.draining = false;
		}
	}
	private send(message: unknown): void {
		if (!this.failure) this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}
	private receiveResourceCleanup(message: Extract<Message, { type: "dispose_resources" }>): void {
		const budget =
			message.callId === "bootstrap" ? this.bootstrapBudget : this.pending.get(message.callId)?.budget;
		if (!budget) {
			this.fail(new Error("Plugin resource cleanup requires its actual parent invocation"));
			return;
		}
		budget.pause();
		const cleanup = this.disposeResources(message.id);
		this.resourceCleanups.add(cleanup);
		const finish = () => {
			this.resourceCleanups.delete(cleanup);
			budget.resume();
		};
		void cleanup.then(finish, finish);
		if (this.shutdownPending) {
			clearTimeout(this.shutdownTimer);
			this.shutdownPending = undefined;
			this.boundShutdown();
		}
	}
	private async disposeResources(id: string): Promise<void> {
		try {
			if (!this.context.resourcesLifecycle) throw new Error("Plugin resource lifecycle was not granted");
			await this.context.resourcesLifecycle.dispose();
			this.send({ type: "capability_result", id, ok: true, value: null });
		} catch (error) {
			this.send({
				type: "capability_result",
				id,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	private capability(message: Extract<Message, { type: "capability" }>): void {
		const context =
			message.callId === "bootstrap" ? this.bootstrapContext : this.pending.get(message.callId)?.context;
		if (!context || this.messageIds.has(message.id)) {
			this.fail(new Error("Plugin capability requested without a unique live host invocation"));
			return;
		}
		this.messageIds.add(message.id);
		const budget =
			message.callId === "bootstrap" ? this.bootstrapBudget : this.pending.get(message.callId)?.budget;
		budget?.pause();
		const abort = new AbortController();
		const settled = Promise.resolve().then(() =>
			executeProcessRuntimeCapability(message, context, abort, (response) => this.send(response)),
		);
		this.hostCapabilities.set(message.id, {
			callId: message.callId,
			cancelKey: message.cancelKey,
			abort,
			settled,
		});
		const finish = () => {
			this.hostCapabilities.delete(message.id);
			budget?.resume();
		};
		void settled.then(finish, finish);
	}
	async start(): Promise<PluginRuntimeInstance<HostNativeSession>> {
		const budget = new GuestTimeBudget(() =>
			this.fail(new Error(`Plugin runtime ${this.pluginId} startup timed out after 15000ms`)),
		);
		this.bootstrapBudget = budget;
		this.send({
			type: "start",
			applicationId: this.context.applicationId,
			resources: this.context.resources,
			resourcesLifecycle: this.context.resourcesLifecycle !== undefined,
			hostEvents: this.context.hostEvents !== undefined,
			resource: this.resource,
		});
		try {
			const declarations = await this.ready;
			return {
				operations: Object.fromEntries(
					Object.entries(declarations.operations).map(([name, declaration]) => [
						name,
						{
							...declaration,
							execute: (input: unknown, context: PluginRuntimeContext) =>
								this.request("invoke", { operation: name, input, scope: context.scope }, context.signal, {
									...context,
									capabilities: bindProcessRuntimeCapabilities(context.capabilities),
								}),
						},
					]),
				),
				...(declarations.native
					? { createNativeSession: (facts?: PluginNativeSessionFacts) => this.attachNative(facts) }
					: {}),
				dispose: async () => {
					if (this.failure) {
						await this.closed;
						throw this.failure;
					}
					this.boundShutdown();
					const attachments = await Promise.allSettled([...this.nativeDisposers].map((dispose) => dispose()));
					try {
						await this.request("dispose", {});
					} catch (error) {
						// A disposal failure must still close the isolated process before teardown returns.
						this.fail(error as Error);
						await this.closed;
						throw error;
					}
					this.disposed = true;
					await this.closed;
					if (this.failure) throw this.failure;
					const failed = attachments.filter((result) => result.status === "rejected");
					if (failed.length)
						throw new AggregateError(
							failed.map((result) => result.reason),
							"Native attachment disposal failed",
						);
				},
			};
		} catch (error) {
			this.fail(error as Error);
			await this.closed;
			throw this.failure;
		} finally {
			budget.dispose();
			this.bootstrapBudget = undefined;
		}
	}
	private attachNative(facts?: PluginNativeSessionFacts): Promise<HostNativeSession> {
		return attachProcessNative(
			{ request: this.request.bind(this), context: this.context, nativeDisposers: this.nativeDisposers },
			facts,
		);
	}
	private request(
		type: Parameters<ProcessNativeHost["request"]>[0],
		payload: Record<string, unknown>,
		signal?: AbortSignal,
		context?: PluginRuntimeContext,
		onUpdate?: NativeToolUpdate,
	): Promise<unknown> {
		if (this.failure) return Promise.reject(this.failure);
		const id = `${++this.sequence}`;
		// Serialization is a trust boundary; fail before registering a pending request.
		const encoded = `${JSON.stringify({ type, id, ...payload })}\n`;
		return new Promise((resolve, reject) => {
			const budget = new GuestTimeBudget(() =>
				this.fail(new Error(`Plugin runtime ${this.pluginId} invocation timed out after 15000ms`)),
			);
			const cancel = () => this.send({ type: "cancel", id });
			this.pending.set(id, {
				budget,
				context,
				onUpdate,
				signal,
				resolve,
				reject,
				cleanup: () => {
					budget.dispose();
					signal?.removeEventListener("abort", cancel);
				},
			});
			this.child.stdin.write(encoded);
			signal?.addEventListener("abort", cancel, { once: true });
			if (signal?.aborted) cancel();
		});
	}
}
