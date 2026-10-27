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
import { NATIVE_EVENTS, type NativeEventName } from "./native-events";
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
const nativeUpdateSchema = Type.Object({
	content: Type.Array(
		Type.Union([
			Type.Object({ type: Type.Literal("text"), text: Type.String() }),
			Type.Object({ type: Type.Literal("image"), data: Type.String(), mimeType: Type.String() }),
		]),
	),
	details: Type.Optional(Type.Unknown()),
});
const messageSchema = Type.Union([
	Type.Object({ type: Type.Literal("native_update"), id: Type.String(), value: nativeUpdateSchema }),
	Type.Object(
		{ type: Type.Literal("dispose_resources"), id: Type.String({ minLength: 1 }) },
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
		id: Type.String({ minLength: 1 }),
		callId: Type.String({ minLength: 1 }),
		name: Type.String({ minLength: 1 }),
		input: Type.Unknown(),
	}),
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
	effects: Type.Record(Type.String(), Type.Union([Type.Literal("read"), Type.Literal("write")])),
	eventEffects: Type.Record(Type.String(), Type.Union([Type.Literal("read"), Type.Literal("write")])),
	events: Type.Array(
		Type.Object({
			name: Type.Union(NATIVE_EVENTS.map((name) => Type.Literal(name))),
			index: Type.Integer({ minimum: 0 }),
		}),
	),
});

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

class RuntimeProcess {
	private sequence = 0;
	private failure: Error | undefined;
	private stderr = "";
	private disposed = false;
	private readonly nativeDisposers = new Set<() => Promise<void>>();
	private shutdownTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly closed: Promise<void>;
	private readonly pending = new Map<
		string,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
			cleanup: () => void;
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
			child.once("close", (code) => {
				clearTimeout(this.shutdownTimer);
				context.signal.removeEventListener("abort", this.stop);
				lines.close();
				if (!this.disposed || code !== 0) {
					this.failure ??= new Error(`Plugin runtime ${pluginId} exited (${code}): ${this.stderr.trim()}`);
				}
				const error = this.failure ?? new Error(`Plugin runtime ${pluginId} is closed`);
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
		if (this.shutdownTimer) return;
		this.shutdownTimer = setTimeout(
			() => this.fail(new Error(`Plugin runtime ${this.pluginId} did not settle shutdown within 500ms`)),
			500,
		);
	}

	private fail(error: Error): void {
		this.failure ??= error;
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
			void this.disposeResources(message.id);
			return;
		}
		if (message.type === "capability") {
			void this.capability(message);
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

	private async capability(message: Extract<Message, { type: "capability" }>): Promise<void> {
		const context =
			message.callId === "bootstrap" ? this.bootstrapContext : this.pending.get(message.callId)?.context;
		if (!context) {
			this.fail(new Error("Plugin capability requested without a live host invocation"));
			return;
		}
		try {
			context.signal.throwIfAborted();
			const value = await context.capabilities.call(message.name, message.input);
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
		const timer = setTimeout(
			() => this.fail(new Error(`Plugin runtime ${this.pluginId} startup timed out after 15000ms`)),
			15000,
		);
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
			clearTimeout(timer);
		}
	}

	private async attachNative(): Promise<PluginNativeSession> {
		const attachment = randomUUID();
		const declared = await this.request("native_attach", { attachment });
		if (!Check(nativeDeclarationsSchema, declared)) throw new Error("Invalid native plugin declarations");
		const declarations = declared as Static<typeof nativeDeclarationsSchema>;
		const lifecycle = new AbortController();
		let stopping: Promise<void> | undefined;
		const invoke = (
			kind: "tool" | "event",
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
			);
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
			eventEffects: declarations.eventEffects,
			extension: (pi) => {
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
		type: "invoke" | "dispose" | "native_attach" | "native_detach" | "native_call",
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
			const timer = setTimeout(
				() => this.fail(new Error(`Plugin runtime ${this.pluginId} invocation timed out after 15000ms`)),
				15000,
			);
			const cancel = () => this.send({ type: "cancel", id });
			this.pending.set(id, {
				context,
				onUpdate,
				signal,
				resolve,
				reject,
				cleanup: () => {
					clearTimeout(timer);
					signal?.removeEventListener("abort", cancel);
				},
			});
			this.child.stdin.write(encoded);
			signal?.addEventListener("abort", cancel, { once: true });
			if (signal?.aborted) cancel();
		});
	}
}
