import { AsyncResource } from "node:async_hooks";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
	PluginNativeRuntimeFactory,
	PluginNativeRuntimeInstance,
	PluginNativeSession,
} from "@gyoungwe/plugin-api/native";
import type {
	PluginRuntimeContext,
	PluginRuntimeFactory,
	PluginRuntimeFactoryContext,
} from "@gyoungwe/plugin-api/runtime";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { pluginRuntimeExecutable } from "../plugin-runtime-executable";
import { canonicalProjectId } from "../project-id";
import { toolProgressSchema } from "../tool-progress";
import { NATIVE_EVENTS, type NativeEventName } from "./native-events";
import { NativeMessageCourier, type NativeMessageReferences } from "./native-message-courier";
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

const declarationSchema = Type.Record(
	Type.String(),
	Type.Object({
		inputSchema: Type.Record(Type.String(), Type.Unknown()),
		resultSchema: Type.Record(Type.String(), Type.Unknown()),
		effect: Type.Union([Type.Literal("read"), Type.Literal("write")]),
	}),
);
type NativeToolUpdate = NonNullable<Parameters<ToolDefinition["execute"]>[3]>;

const messageSchema = Type.Union([
	Type.Object({ type: Type.Literal("native_update"), id: Type.String(), value: toolProgressSchema }),
	Type.Object(
		{
			type: Type.Literal("dispose_resources"),
			id: Type.String({ minLength: 1 }),
			callId: Type.String({ minLength: 1 }),
		},
		{ additionalProperties: false },
	),
	Type.Object({ type: Type.Literal("ready"), operations: declarationSchema, native: Type.Boolean() }),
	Type.Object({
		type: Type.Literal("result"),
		id: Type.String(),
		ok: Type.Literal(true),
		value: Type.Unknown(),
	}),
	Type.Object({
		type: Type.Literal("result"),
		id: Type.String(),
		ok: Type.Literal(false),
		error: Type.String(),
	}),
	Type.Object({ type: Type.Literal("error"), error: Type.String() }),
	Type.Object({ type: Type.Literal("canceled") }),
	Type.Object({ type: Type.Literal("changed") }),
	Type.Object({
		type: Type.Literal("capability"),
		cancelKey: Type.String({ minLength: 1 }),
		id: Type.String({ minLength: 1 }),
		callId: Type.String({ minLength: 1 }),
		name: Type.String({ minLength: 1 }),
		input: Type.Unknown(),
	}),
	Type.Object(
		{
			type: Type.Literal("cancel_capability"),
			id: Type.String({ minLength: 1 }),
			callId: Type.String({ minLength: 1 }),
			cancelKey: Type.String({ minLength: 1 }),
		},
		{ additionalProperties: false },
	),
]);
type Message = Static<typeof messageSchema>;
type Declarations = { operations: Static<typeof declarationSchema>; native: boolean };
const nativeDeclarationsSchema = Type.Object({
	tools: Type.Array(
		Type.Object({
			name: Type.String({ minLength: 1 }),
			label: Type.String(),
			description: Type.String(),
			parameters: Type.Record(Type.String(), Type.Unknown()),
			outputSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
			constrainedSampling: Type.Optional(
				Type.Union([Type.Literal(false), Type.Record(Type.String(), Type.Unknown())]),
			),
			renderShell: Type.Optional(Type.Union([Type.Literal("default"), Type.Literal("self")])),
			promptSnippet: Type.Optional(Type.String()),
			promptGuidelines: Type.Optional(Type.Array(Type.String())),
			exposure: Type.Optional(
				Type.Union(
					["direct", "model-only", "codemode", "deferred", "hidden"].map((value) => Type.Literal(value)),
				),
			),
			namespace: Type.Optional(
				Type.Object({
					name: Type.String(),
					description: Type.Optional(Type.String()),
					instructions: Type.Optional(Type.String()),
				}),
			),
			annotations: Type.Optional(
				Type.Object({
					readOnlyHint: Type.Optional(Type.Boolean()),
					destructiveHint: Type.Optional(Type.Boolean()),
					idempotentHint: Type.Optional(Type.Boolean()),
					openWorldHint: Type.Optional(Type.Boolean()),
				}),
			),
			defaultActive: Type.Optional(Type.Boolean()),
			executionMode: Type.Optional(Type.Union([Type.Literal("sequential"), Type.Literal("parallel")])),
			drone: Type.Optional(Type.Unknown()),
		}),
	),
	commands: Type.Array(
		Type.Object(
			{ name: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()) },
			{ additionalProperties: false },
		),
	),
	effects: Type.Record(Type.String(), Type.Union([Type.Literal("read"), Type.Literal("write")])),
	commandEffects: Type.Record(Type.String(), Type.Union([Type.Literal("read"), Type.Literal("write")])),
	eventEffects: Type.Record(Type.String(), Type.Union([Type.Literal("read"), Type.Literal("write")])),
	nativeOperations: Type.Record(
		Type.String(),
		Type.Object(
			{
				event: Type.Union([Type.Literal("message_start"), Type.Literal("tool_execution_end")]),
				inputSchema: Type.Record(Type.String(), Type.Unknown()),
				resultSchema: Type.Record(Type.String(), Type.Unknown()),
				effect: Type.Union([Type.Literal("read"), Type.Literal("write")]),
			},
			{ additionalProperties: false },
		),
	),
	projection: Type.Optional(
		Type.Object(
			{ finalize: Type.Boolean(), effect: Type.Union([Type.Literal("read"), Type.Literal("write")]) },
			{ additionalProperties: false },
		),
	),
	events: Type.Array(
		Type.Object({
			name: Type.Union(NATIVE_EVENTS.map((name) => Type.Literal(name))),
			index: Type.Integer({ minimum: 0 }),
		}),
	),
});

const nativeCallResponseSchema = Type.Object(
	{
		value: Type.Unknown(),
		references: Type.Object(
			{
				message: Type.Optional(Type.String()),
				messages: Type.Optional(Type.Array(Type.Union([Type.String(), Type.Null()]))),
			},
			{ additionalProperties: false },
		),
	},
	{ additionalProperties: false },
);

const nativeSnapshotResponseSchema = Type.Object(
	{ messages: Type.Array(Type.Unknown()) },
	{ additionalProperties: false },
);

const jsonValueSchema = Type.Cyclic(
	{
		Json: Type.Union([
			Type.Null(),
			Type.Boolean(),
			Type.Number(),
			Type.String(),
			Type.Array(Type.Ref("Json")),
			Type.Record(Type.String(), Type.Ref("Json")),
		]),
	},
	"Json",
);
const beforeAgentStartResponseSchema = Type.Object(
	{
		systemPromptOptions: Type.Record(Type.String(), jsonValueSchema),
		result: Type.Union([Type.Null(), Type.Record(Type.String(), jsonValueSchema)]),
	},
	{ additionalProperties: false },
);

const nativeToolCallResponseSchema = Type.Object(
	{
		input: Type.Record(Type.String(), jsonValueSchema),
		result: Type.Union([
			Type.Null(),
			Type.Object(
				{
					block: Type.Optional(Type.Boolean()),
					reason: Type.Optional(Type.String()),
					terminate: Type.Optional(Type.Boolean()),
				},
				{ additionalProperties: false },
			),
		]),
	},
	{ additionalProperties: false },
);

const nativeInputResponseSchema = Type.Union([
	Type.Null(),
	Type.Object({ action: Type.Literal("continue") }, { additionalProperties: false }),
	Type.Object({ action: Type.Literal("handled") }, { additionalProperties: false }),
	Type.Object(
		{
			action: Type.Literal("transform"),
			text: Type.String(),
			images: Type.Optional(
				Type.Array(
					Type.Object(
						{ type: Type.Literal("image"), data: Type.String(), mimeType: Type.String() },
						{ additionalProperties: false },
					),
				),
			),
		},
		{ additionalProperties: false },
	),
]);

const nativeTurnEndResponseSchema = Type.Union([
	Type.Null(),
	Type.Object({ continue: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
]);

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
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
			cleanup: () => void;
			budget: GuestTimeBudget;
			context?: PluginRuntimeContext;
			onUpdate?: NativeToolUpdate;
			signal?: AbortSignal;
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
		const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
		child.stderr.on("data", (chunk: Buffer) => {
			this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-8000);
		});
		lines.on("line", (line) => {
			let message: unknown;
			try {
				message = JSON.parse(line);
			} catch (error) {
				this.fail(new Error("Plugin runtime emitted invalid JSON", { cause: error }));
				return;
			}
			if (!Check(messageSchema, message)) {
				this.fail(new Error("Plugin runtime emitted an invalid protocol message"));
				return;
			}
			this.receive(message as Message);
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

	private receive(message: Message): void {
		if (this.failure) return;
		if (message.type === "canceled") {
			this.fail(
				this.context.signal.aborted
					? this.context.signal.reason
					: new Error("Plugin runtime canceled without host cancellation"),
			);
			return;
		}
		if (message.type === "dispose_resources") {
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
			return;
		}
		if (message.type === "cancel_capability") {
			const call = this.hostCapabilities.get(message.id);
			if (call?.callId === message.callId && call.cancelKey === message.cancelKey)
				call.abort.abort(new Error("Plugin capability locally canceled"));
			return;
		}
		if (message.type === "capability") {
			this.capability(message);
			return;
		}
		if (message.type === "changed") {
			if (!this.context.signal.aborted) this.context.events.changed();
			return;
		}
		if (message.type === "ready") {
			this.resolveReady({ operations: message.operations, native: message.native });
			return;
		}
		if (message.type === "error") {
			this.fail(new Error(message.error));
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) {
			this.fail(new Error("Plugin runtime replied to an unknown invocation"));
			return;
		}
		if (message.type === "native_update") {
			if (!pending.onUpdate) {
				this.fail(new Error("Plugin runtime sent an unrequested tool update"));
				return;
			}
			if (!pending.signal?.aborted) {
				try {
					pending.onUpdate(message.value as Parameters<NativeToolUpdate>[0]);
				} catch (error) {
					// A failed SDK observer must reject this runtime, never escape the protocol listener.
					this.fail(error as Error);
				}
			}
			return;
		}
		this.pending.delete(message.id);
		pending.cleanup();
		if (message.ok) pending.resolve(message.value);
		else pending.reject(new Error(message.error));
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
		const settled = Promise.resolve().then(() => this.executeCapability(message, context, abort));
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

	private async executeCapability(
		message: Extract<Message, { type: "capability" }>,
		context: PluginRuntimeFactoryContext | PluginRuntimeContext,
		abort: AbortController,
	): Promise<void> {
		try {
			context.signal.throwIfAborted();
			const value = await context.capabilities.call(message.name, message.input, abort.signal);
			context.signal.throwIfAborted();
			this.send({ type: "capability_result", id: message.id, ok: true, value });
		} catch (error) {
			this.send({
				type: "capability_result",
				id: message.id,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
				...(error instanceof Error &&
				Object.hasOwn(error, "code") &&
				typeof (error as Error & { code?: unknown }).code === "string"
					? { code: (error as Error & { code: string }).code }
					: {}),
			});
		}
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
				...(declarations.native ? { createNativeSession: () => this.attachNative() } : {}),
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

	private async attachNative(): Promise<PluginNativeSession> {
		const attachment = randomUUID();
		const declared = await this.request("native_attach", { attachment });
		if (!Check(nativeDeclarationsSchema, declared)) throw new Error("Invalid native plugin declarations");
		const declarations = declared as Static<typeof nativeDeclarationsSchema>;
		const lifecycle = new AbortController();
		const courier = new NativeMessageCourier();
		const unwrap = (response: unknown, original?: object): unknown => {
			if (!Check(nativeCallResponseSchema, response)) throw new Error("Invalid native invocation response");
			const { value, references } = response as { value: unknown; references: NativeMessageReferences };
			if (references.message !== undefined || references.messages !== undefined)
				courier.remember(value, references, original);
			return value;
		};
		let stopping: Promise<void> | undefined;
		const invoke = (
			kind: "tool" | "event" | "command",
			name: string,
			input: unknown,
			ctx: ExtensionContext,
			signal?: AbortSignal,
			toolCallId?: string,
			hookIndex?: number,
			onUpdate?: NativeToolUpdate,
		) => {
			const combined = AbortSignal.any([this.context.signal, lifecycle.signal, ...(signal ? [signal] : [])]);
			combined.throwIfAborted();
			return this.request(
				"native_call",
				{
					attachment,
					kind,
					name,
					input,
					references: kind === "event" ? courier.encode(input) : {},
					toolCallId,
					hookIndex,
					updates: onUpdate !== undefined,
					context: { cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId() },
				},
				combined,
				{
					signal: combined,
					scope: {
						kind: "session",
						workspaceId: canonicalProjectId(ctx.cwd),
						workspaceDirectory: ctx.cwd,
						sessionId: ctx.sessionManager.getSessionId(),
					},
					capabilities: { call: AsyncResource.bind(this.context.capabilities.call) },
				},
				onUpdate,
			).then((response) => {
				combined.throwIfAborted();
				return unwrap(
					response,
					kind === "event" && name === "message_end" ? (input as { message: object }).message : undefined,
				);
			});
		};
		const project = (
			kind: "finalize" | "event" | "snapshot",
			input: unknown,
			context?: PluginRuntimeContext,
			callerSignal?: AbortSignal,
		) => {
			const signal = AbortSignal.any([
				this.context.signal,
				lifecycle.signal,
				...(context ? [context.signal] : []),
				...(callerSignal ? [callerSignal] : []),
			]);
			signal.throwIfAborted();
			return this.request(
				"native_projection",
				{
					attachment,
					kind,
					input,
					references:
						kind === "snapshot"
							? courier.encodeSnapshot(
									(input as { messages: unknown[] }).messages,
									(input as { persisted: unknown[] }).persisted,
								)
							: courier.encode(input),
					...(context ? { scope: context.scope } : {}),
				},
				signal,
				context
					? { ...context, capabilities: { call: AsyncResource.bind(context.capabilities.call) } }
					: undefined,
			).then((response) => {
				signal.throwIfAborted();
				return unwrap(response, kind === "finalize" ? (input as { message: object }).message : undefined);
			});
		};
		const dispose = () => {
			if (!stopping) {
				lifecycle.abort(new Error("Native attachment closed"));
				stopping = this.request("native_detach", { attachment }).then(() => {
					this.nativeDisposers.delete(dispose);
				});
			}
			return stopping;
		};
		this.nativeDisposers.add(dispose);
		return {
			toolEffects: declarations.effects,
			commandEffects: declarations.commandEffects,
			eventEffects: declarations.eventEffects,
			nativeOperations: Object.fromEntries(
				Object.entries(declarations.nativeOperations).map(([name, operation]) => [
					name,
					{
						...operation,
						execute: (input: unknown, event: unknown, context: PluginRuntimeContext) => {
							const signal = AbortSignal.any([this.context.signal, lifecycle.signal, context.signal]);
							signal.throwIfAborted();
							return this.request(
								"native_operation",
								{
									attachment,
									name,
									input,
									event,
									references: courier.encode(event),
									scope: context.scope,
								},
								signal,
								{ ...context, capabilities: { call: AsyncResource.bind(context.capabilities.call) } },
							).then((response) => {
								signal.throwIfAborted();
								return unwrap(response);
							});
						},
					},
				]),
			),
			...(declarations.projection
				? {
						projection: {
							...(declarations.projection.finalize
								? {
										finalize: (event: unknown, context: PluginRuntimeContext) =>
											project("finalize", event, context),
									}
								: {}),
							finalizeEffect: declarations.projection.effect,
							event: (event: unknown, signal?: AbortSignal) => project("event", event, undefined, signal),
							snapshot: async (messages: unknown[], persisted: unknown[], signal?: AbortSignal) => {
								const response = await project("snapshot", { messages, persisted }, undefined, signal);
								if (!Check(nativeSnapshotResponseSchema, response))
									throw new Error("Invalid native snapshot projection");
								return (response as { messages: unknown[] }).messages;
							},
						},
					}
				: {}),
			extension: (pi) => {
				for (const command of declarations.commands)
					pi.registerCommand(command.name, {
						...(command.description === undefined ? {} : { description: command.description }),
						handler: async (args, ctx) => {
							await invoke("command", command.name, args, ctx, ctx.signal);
						},
					});
				for (const tool of declarations.tools)
					pi.registerTool({
						...tool,
						parameters: tool.parameters as ToolDefinition["parameters"],
						execute: (id, input, signal, update, ctx) =>
							invoke("tool", tool.name, input, ctx, signal, id, undefined, update) as ReturnType<
								ToolDefinition["execute"]
							>,
					} as ToolDefinition);
				const on = pi.on.bind(pi) as (
					name: NativeEventName,
					handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown>,
				) => void;
				// Register each callback independently so the real SDK chains hook results.
				for (const hook of declarations.events) {
					if (hook.name !== "session_shutdown")
						on(hook.name, async (event, ctx) => {
							const value = await invoke("event", hook.name, event, ctx, ctx.signal, undefined, hook.index);
							if (hook.name === "input") {
								if (!Check(nativeInputResponseSchema, value))
									throw new Error("Invalid native input response");
								return value;
							}
							if (hook.name === "turn_end") {
								if (!Check(nativeTurnEndResponseSchema, value))
									throw new Error("Invalid native turn_end response");
								return value;
							}
							if (hook.name === "tool_call") {
								if (!Check(nativeToolCallResponseSchema, value))
									throw new Error("Invalid native tool_call response");
								const response = value as Static<typeof nativeToolCallResponseSchema>;
								const input = (event as { input: Record<PropertyKey, unknown> }).input;
								for (const key of Reflect.ownKeys(input)) delete input[key];
								Object.defineProperties(input, Object.getOwnPropertyDescriptors(response.input));
								return response.result;
							}
							if (hook.name !== "before_agent_start") return value;
							if (!Check(beforeAgentStartResponseSchema, value))
								throw new Error("Invalid native before_agent_start response");
							const response = value as Static<typeof beforeAgentStartResponseSchema>;
							const options = (event as { systemPromptOptions: Record<PropertyKey, unknown> })
								.systemPromptOptions;
							// Preserve the SDK reference; descriptors keep __proto__ as an own data field.
							for (const key of Reflect.ownKeys(options)) delete options[key];
							Object.defineProperties(
								options,
								Object.getOwnPropertyDescriptors(response.systemPromptOptions),
							);
							return response.result;
						});
				}
				pi.on("session_shutdown", async (event, ctx) => {
					if (stopping) return stopping;
					const results: PromiseSettledResult<unknown>[] = [];
					for (const hook of declarations.events) {
						if (hook.name === "session_shutdown")
							results.push(
								...(await Promise.allSettled([
									invoke("event", hook.name, event, ctx, undefined, undefined, hook.index),
								])),
							);
					}
					const [closed] = await Promise.allSettled([dispose()]);
					const failures = [...results, closed].filter((result) => result.status === "rejected");
					if (failures.length)
						throw new AggregateError(
							failures.map((result) => result.reason),
							"Native plugin shutdown failed",
						);
				});
			},
			dispose,
		};
	}

	private request(
		type:
			| "invoke"
			| "dispose"
			| "native_attach"
			| "native_detach"
			| "native_call"
			| "native_projection"
			| "native_operation",
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
