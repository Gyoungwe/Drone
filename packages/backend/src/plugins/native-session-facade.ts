import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PluginNativeSession } from "@gyoungwe/plugin-api/native";
import type { PluginRuntimeContext } from "@gyoungwe/plugin-api/runtime";
import { onPluginEvent } from "./native-events";
import { createP5OwnerFacade, type HostNativeSession, type P5CommittedProjection } from "./p5-owner-facade";
import type { PluginRuntimeCaller, PluginRuntimeCallerResolver, RegistryOperation } from "./runtime";
import type { PluginNativeInvocation } from "./runtime-capabilities";

/** Host-only facade; only the registry can borrow a real caller for the source projector. */
export interface ManagedNativeSession extends PluginNativeSession {
	readonly hostFactOwner?: P5CommittedProjection;
	readonly hostProjection?: {
		finalize?(event: unknown, signal: AbortSignal): Promise<unknown>;
		event(event: unknown, signal?: AbortSignal): Promise<unknown>;
		snapshot(messages: unknown[], persisted: unknown[], signal?: AbortSignal): Promise<unknown[]>;
	};
}

interface NativeSessionFacadeOptions {
	native: HostNativeSession;
	lifetime: AbortController;
	call: (
		resolveCaller: PluginRuntimeCallerResolver,
		name: string,
		input: unknown,
		callerSignal?: AbortSignal,
		operationOverride?: RegistryOperation,
		withoutCapabilities?: boolean,
		effectCeiling?: "read" | "write",
		nativeInvocation?: PluginNativeInvocation,
	) => Promise<unknown>;
	resolveCaller: (context: ExtensionContext) => PluginRuntimeCaller | undefined;
	resolveProjectionCaller?: PluginRuntimeCallerResolver;
}

type NativeSignal = (signal?: AbortSignal) => AbortSignal;

export function createNativeSessionFacade(options: NativeSessionFacadeOptions): ManagedNativeSession {
	const { native, lifetime } = options;
	const nativeSignal = (signal?: AbortSignal) =>
		AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]);
	const { finalize, projected } = adaptNativeProjection(options);
	const managed: ManagedNativeSession & { factOwner: undefined } = {
		...native,
		nativeOperations: undefined,
		factOwner: undefined,
		...(native.factOwner ? { hostFactOwner: createP5OwnerFacade(native.factOwner, lifetime.signal) } : {}),
		projection: projected,
		// Do not pass through a similarly named property from untyped source exports.
		hostProjection: projected
			? { ...(finalize ? { finalize } : {}), event: projected.event, snapshot: projected.snapshot }
			: undefined,
		extension: (pi) => adaptNativeExtension(pi, options, nativeSignal),
	};
	return managed;
}

function adaptNativeProjection({ native, call, resolveProjectionCaller }: NativeSessionFacadeOptions) {
	const projection = native.projection;
	const finalizer = projection?.finalize?.bind(projection);
	const projectionCaller = () => resolveProjectionCaller?.();
	const finalize = finalizer
		? (event: unknown, signal: AbortSignal) =>
				call(projectionCaller, "native:projection:finalize", event, signal, {
					inputSchema: {},
					resultSchema: {},
					effect: projection?.finalizeEffect ?? "write",
					execute: async (_input, call) => finalizer(event, call),
				})
		: undefined;
	const projected = projection
		? {
				...projection,
				...(finalize
					? {
							finalize: (event: unknown, context: PluginRuntimeContext) => finalize(event, context.signal),
						}
					: {}),
				event: (event: unknown, signal?: AbortSignal) =>
					call(
						projectionCaller,
						"native:projection:event",
						event,
						signal,
						{
							inputSchema: {},
							resultSchema: {},
							effect: "read",
							execute: async (_input, call) => projection.event(event, call.signal),
						},
						true,
					),
				snapshot: (messages: unknown[], persisted: unknown[], signal?: AbortSignal) =>
					call(
						projectionCaller,
						"native:projection:snapshot",
						{ messages, persisted },
						signal,
						{
							inputSchema: {},
							resultSchema: { type: "array" },
							effect: "read",
							execute: async (_input, call) => projection.snapshot(messages, persisted, call.signal),
						},
						true,
					) as Promise<unknown[]>,
			}
		: undefined;
	return { finalize, projected };
}

function adaptNativeRegistrations(
	adapted: ExtensionAPI,
	pi: ExtensionAPI,
	{ native, call, resolveCaller }: NativeSessionFacadeOptions,
	nativeSignal: NativeSignal,
) {
	adapted.registerTool = ((tool: ToolDefinition) =>
		pi.registerTool({
			...tool,
			// The official SDK exposes this per-session declaration to task planning.
			// Capability authorization still uses the operation/port effects below.
			annotations: { ...tool.annotations, readOnlyHint: native.toolEffects?.[tool.name] === "read" },
			execute: (id, input, signal, update, context) =>
				call(() => resolveCaller(context), `native:tool:${tool.name}`, input, nativeSignal(signal), {
					inputSchema: tool.parameters,
					resultSchema: {},
					effect: native.toolEffects?.[tool.name] ?? "write",
					execute: (_input, call) => tool.execute(id, input, call.signal, update, context),
				}) as ReturnType<ToolDefinition["execute"]>,
		})) as ExtensionAPI["registerTool"];
	adapted.registerCommand = (name, command) =>
		pi.registerCommand(name, {
			...command,
			handler: async (args, context) => {
				await call(
					() => resolveCaller(context),
					`native:command:${name}`,
					args,
					nativeSignal(context.signal),
					{
						inputSchema: { type: "string" },
						resultSchema: { type: "null" },
						effect: native.commandEffects?.[name] ?? "write",
						execute: async (_input, call) => {
							const scopedContext = new Proxy(context, {
								get(target, property, receiver) {
									call.signal.throwIfAborted();
									return property === "signal" ? call.signal : Reflect.get(target, property, receiver);
								},
							});
							await command.handler(args, scopedContext);
							return null;
						},
					},
				);
			},
		});
}

function adaptNativeExtension(
	pi: ExtensionAPI,
	options: NativeSessionFacadeOptions,
	nativeSignal: NativeSignal,
) {
	const { native, call, resolveCaller } = options;
	const adapted = {} as ExtensionAPI;
	adaptNativeRegistrations(adapted, pi, options, nativeSignal);
	adapted.on = ((name: string, handler: (event: unknown, context: ExtensionContext) => unknown) =>
		onPluginEvent(pi, name, async (event, context) => {
			// Shutdown releases the attachment with no new caller authority or capability grant.
			if (name === "session_shutdown") return handler(event, context);
			return call(
				() => resolveCaller(context),
				`native:event:${name}`,
				event,
				nativeSignal(context.signal),
				{
					inputSchema: {},
					resultSchema: {},
					effect: native.eventEffects?.[name] ?? (name === "session_start" ? "read" : "write"),
					execute: async (_input, call) =>
						handler(
							event,
							new Proxy(context, {
								get(target, property, receiver) {
									call.signal.throwIfAborted();
									return property === "signal" ? call.signal : Reflect.get(target, property, receiver);
								},
							}),
						),
				},
				false,
				undefined,
				name === "message_start" || name === "tool_execution_end"
					? { kind: name, event, attachment: native }
					: undefined,
			);
		})) as ExtensionAPI["on"];
	return native.extension(
		new Proxy(adapted, {
			get: (target, name) => {
				if (name === "registerTool" || name === "registerCommand" || name === "on") return target[name];
				throw new Error(`Unsupported native Pi API: ${String(name)}`);
			},
		}),
	);
}
