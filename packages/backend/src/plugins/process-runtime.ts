import { AsyncResource } from "node:async_hooks";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type {
	PluginNativeRuntimeFactory,
	PluginNativeRuntimeInstance,
	PluginNativeSession,
} from "@gyoungwe/plugin-api/native";
import type {
	PluginNativeSessionFacts,
	PluginRuntimeContext,
	PluginRuntimeFactory,
	PluginRuntimeFactoryContext,
} from "@gyoungwe/plugin-api/runtime";
import { pluginRuntimeExecutable } from "../plugin-runtime-executable";
import { attachProcessNative, type ProcessNativeHost } from "./process-native-attachment";
import {
	type Declarations,
	executeProcessRuntimeCapability,
	type Message,
	type NativeToolUpdate,
	type PendingInvocation,
	readProcessRuntimeMessages,
} from "./process-runtime-messages";
import { PROCESS_RUNTIME_WORKER } from "./process-runtime-worker";

export interface ProcessPluginRuntimeOptions {
	readonly pluginId: string;
	readonly entrypoint: string;
	readonly packageRoot: string;
	/** Archive-verified Node runtime already shipped by the host. */
	readonly runtimeDirectory?: string;
	/** Host-selected derived-data directory, never a path supplied by worker messages. */
	readonly resource?: { readonly storageDirectory: string; readonly parameters: unknown };
}

function staysInPackage(root: string, path: string): boolean {
	const pathRelative = relative(root, path);
	return pathRelative !== ".." && !pathRelative.startsWith(`..${sep}`) && !isAbsolute(pathRelative);
}

/** Node's read permission follows data symlinks; validate every grant target before launch. */
function checkPackageLinks(root: string, directory = root): void {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isSymbolicLink() && !staysInPackage(root, realpathSync(path))) {
			throw new Error("Plugin runtime package symlink escapes its read grant");
		}
		if (entry.isDirectory()) checkPackageLinks(root, path);
	}
}

/** Only called after registry authorization. No plugin import occurs in this process. */
export function createProcessPluginRuntime(
	options: ProcessPluginRuntimeOptions & { resource: NonNullable<ProcessPluginRuntimeOptions["resource"]> },
): PluginRuntimeFactory;
export function createProcessPluginRuntime(options: ProcessPluginRuntimeOptions): PluginNativeRuntimeFactory;
export function createProcessPluginRuntime(options: ProcessPluginRuntimeOptions): PluginNativeRuntimeFactory {
	return async (context) => {
		context.signal.throwIfAborted();
		const executable = pluginRuntimeExecutable(options.runtimeDirectory);
		const packageRoot = realpathSync(options.packageRoot);
		const entrypoint = realpathSync(options.entrypoint);
		if (!staysInPackage(packageRoot, entrypoint)) {
			throw new Error("Plugin runtime entrypoint escapes its package");
		}
		checkPackageLinks(packageRoot);
		const child = spawn(
			executable,
			[
				"--permission",
				// Node FS permissions do not cover node:sqlite; domain code must use host capabilities.
				...(options.resource ? [] : ["--no-experimental-sqlite"]),
				`--allow-fs-read=${packageRoot}`,
				...(options.resource
					? [
							`--allow-fs-read=${options.resource.storageDirectory}`,
							`--allow-fs-write=${options.resource.storageDirectory}`,
						]
					: []),
				"--input-type=module",
				"--eval",
				PROCESS_RUNTIME_WORKER,
				entrypoint,
			],
			{
				cwd: packageRoot,
				// No inherited secrets, PATH, NODE_OPTIONS, filesystem write, network or subprocess grants.
				env: {
					NODE_ENV: "production",
					...(process.versions.electron && !options.runtimeDirectory ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
				},
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
			},
		);
		return new RuntimeProcess(options.pluginId, child, context, options.resource).start();
	};
}

/** The existing 15 s watchdog counts guest time, excluding actual host capability settlement. */
class GuestTimeBudget {
	private remaining = 15000;
	private startedAt = performance.now();
	private waiting = 0;
	private finished = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	constructor(private readonly expire: () => void) {
		this.arm();
	}
	private arm(): void {
		this.startedAt = performance.now();
		this.timer = setTimeout(() => {
			this.finished = true;
			this.expire();
		}, this.remaining);
	}
	pause(): void {
		if (this.finished) return;
		if (this.waiting++ === 0) {
			this.remaining = Math.max(0, this.remaining - (performance.now() - this.startedAt));
			clearTimeout(this.timer);
		}
	}
	resume(): void {
		if (this.finished) return;
		if (--this.waiting === 0) this.arm();
	}
	dispose(): void {
		this.finished = true;
		clearTimeout(this.timer);
	}
}

class RuntimeProcess {
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
	private readonly capabilityIds = new Set<string>();
	private readonly resourceCleanups = new Set<Promise<void>>();
	private readonly hostCapabilities = new Map<
		string,
		{
			callId: string;
			cancelKey: string;
			abort: AbortController;
			settled: Promise<void>;
		}
	>();
	private readonly pending = new Map<
		string,
		PendingInvocation & {
			budget: GuestTimeBudget;
			context?: PluginRuntimeContext;
		}
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
			capabilities: { call: AsyncResource.bind(context.capabilities.call) },
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
		this.bootstrapBudget?.dispose();
		for (const pending of this.pending.values()) pending.budget.dispose();
		for (const call of this.hostCapabilities.values()) call.abort.abort(this.failure);
		this.child.kill("SIGKILL");
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
		void cleanup.then(
			() => {
				this.resourceCleanups.delete(cleanup);
				budget.resume();
			},
			() => {
				this.resourceCleanups.delete(cleanup);
				budget.resume();
			},
		);
		if (this.shutdownPending) {
			clearTimeout(this.shutdownTimer);
			this.shutdownTimer = undefined;
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
			// This is a cleanup receipt, not a fresh capability invocation after caller revocation.
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
		if (!context || this.capabilityIds.has(message.id)) {
			this.fail(new Error("Plugin capability requested without a unique live host invocation"));
			return;
		}
		this.capabilityIds.add(message.id);
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
		void settled.then(
			() => {
				this.hostCapabilities.delete(message.id);
				budget?.resume();
			},
			() => {
				this.hostCapabilities.delete(message.id);
				budget?.resume();
			},
		);
	}

	async start(): Promise<PluginNativeRuntimeInstance> {
		const budget = new GuestTimeBudget(() =>
			this.fail(new Error(`Plugin runtime ${this.pluginId} startup timed out after 15000ms`)),
		);
		this.bootstrapBudget = budget;
		this.send({
			type: "start",
			applicationId: this.context.applicationId,
			resources: this.context.resources,
			resourcesLifecycle: this.context.resourcesLifecycle !== undefined,
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
									capabilities: { call: AsyncResource.bind(context.capabilities.call) },
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

	private attachNative(facts?: PluginNativeSessionFacts): Promise<PluginNativeSession> {
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
