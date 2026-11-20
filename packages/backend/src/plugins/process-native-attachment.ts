import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PluginNativeSession } from "@gyoungwe/plugin-api/native";
import type {
	PluginNativeSessionFacts,
	PluginRuntimeContext,
	PluginRuntimeFactoryContext,
} from "@gyoungwe/plugin-api/runtime";
import type { Static } from "typebox";
import { Check } from "typebox/value";
import { canonicalProjectId } from "../project-id";
import type { NativeEventName } from "./native-events";
import { NativeMessageCourier, type NativeMessageReferences } from "./native-message-courier";
import {
	beforeAgentStartResponseSchema,
	nativeCallResponseSchema,
	nativeDeclarationsSchema,
	nativeInputResponseSchema,
	nativeSnapshotResponseSchema,
	nativeToolCallResponseSchema,
	nativeTurnEndResponseSchema,
} from "./process-native-schemas";
import type { NativeToolUpdate } from "./process-runtime-messages";

export interface ProcessNativeHost {
	request(
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
	): Promise<unknown>;
	readonly context: Pick<PluginRuntimeFactoryContext, "signal" | "capabilities">;
	readonly nativeDisposers: Set<() => Promise<void>>;
}

type NativeDeclarations = Static<typeof nativeDeclarationsSchema>;

interface NativeAttachment {
	readonly attachment: string;
	readonly lifecycle: AbortController;
	readonly courier: NativeMessageCourier;
	readonly host: ProcessNativeHost;
	readonly unwrap: (response: unknown, original?: object) => unknown;
}

export async function attachProcessNative(
	host: ProcessNativeHost,
	facts?: PluginNativeSessionFacts,
): Promise<PluginNativeSession> {
	const attachment = randomUUID();
	const declared = await host.request("native_attach", { attachment, ...(facts ? { facts } : {}) });
	if (!Check(nativeDeclarationsSchema, declared)) throw new Error("Invalid native plugin declarations");
	const declarations = declared as NativeDeclarations;
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
	const state: NativeAttachment = { attachment, lifecycle, courier, host, unwrap };
	const dispose = () => {
		if (!stopping) {
			lifecycle.abort(new Error("Native attachment closed"));
			stopping = host.request("native_detach", { attachment }).then(() => {
				host.nativeDisposers.delete(dispose);
			});
		}
		return stopping;
	};
	host.nativeDisposers.add(dispose);
	return {
		toolEffects: declarations.effects,
		commandEffects: declarations.commandEffects,
		eventEffects: declarations.eventEffects,
		nativeOperations: buildNativeOperations(state, declarations.nativeOperations),
		...buildNativeProjection(state, declarations.projection),
		extension: buildNativeExtension(state, declarations, dispose, () => stopping),
		dispose,
	};
}

function invokeNative(
	{ attachment, lifecycle, courier, host, unwrap }: NativeAttachment,
	kind: "tool" | "event" | "command",
	name: string,
	input: unknown,
	ctx: ExtensionContext,
	signal?: AbortSignal,
	toolCallId?: string,
	hookIndex?: number,
	onUpdate?: NativeToolUpdate,
): Promise<unknown> {
	const combined = AbortSignal.any([host.context.signal, lifecycle.signal, ...(signal ? [signal] : [])]);
	combined.throwIfAborted();
	return host
		.request(
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
				capabilities: { call: AsyncResource.bind(host.context.capabilities.call) },
			},
			onUpdate,
		)
		.then((response) => {
			combined.throwIfAborted();
			return unwrap(
				response,
				kind === "event" && name === "message_end" ? (input as { message: object }).message : undefined,
			);
		});
}

function projectNative(
	{ attachment, lifecycle, courier, host, unwrap }: NativeAttachment,
	kind: "finalize" | "event" | "snapshot",
	input: unknown,
	context?: PluginRuntimeContext,
	callerSignal?: AbortSignal,
): Promise<unknown> {
	const signal = AbortSignal.any([
		host.context.signal,
		lifecycle.signal,
		...(context ? [context.signal] : []),
		...(callerSignal ? [callerSignal] : []),
	]);
	signal.throwIfAborted();
	return host
		.request(
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
		)
		.then((response) => {
			signal.throwIfAborted();
			return unwrap(response, kind === "finalize" ? (input as { message: object }).message : undefined);
		});
}

function buildNativeOperations(
	{ attachment, lifecycle, courier, host, unwrap }: NativeAttachment,
	operations: NativeDeclarations["nativeOperations"],
): NonNullable<PluginNativeSession["nativeOperations"]> {
	return Object.fromEntries(
		Object.entries(operations).map(([name, operation]) => [
			name,
			{
				...operation,
				execute: (input: unknown, event: unknown, context: PluginRuntimeContext) => {
					const signal = AbortSignal.any([host.context.signal, lifecycle.signal, context.signal]);
					signal.throwIfAborted();
					return host
						.request(
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
						)
						.then((response) => {
							signal.throwIfAborted();
							return unwrap(response);
						});
				},
			},
		]),
	);
}

function buildNativeProjection(
	state: NativeAttachment,
	projection: NativeDeclarations["projection"],
): Pick<PluginNativeSession, "projection"> {
	return projection
		? {
				projection: {
					...(projection.finalize
						? {
								finalize: (event: unknown, context: PluginRuntimeContext) =>
									projectNative(state, "finalize", event, context),
							}
						: {}),
					finalizeEffect: projection.effect,
					event: (event: unknown, signal?: AbortSignal) =>
						projectNative(state, "event", event, undefined, signal),
					snapshot: async (messages: unknown[], persisted: unknown[], signal?: AbortSignal) => {
						const response = await projectNative(
							state,
							"snapshot",
							{ messages, persisted },
							undefined,
							signal,
						);
						if (!Check(nativeSnapshotResponseSchema, response))
							throw new Error("Invalid native snapshot projection");
						return (response as { messages: unknown[] }).messages;
					},
				},
			}
		: {};
}

function buildNativeExtension(
	state: NativeAttachment,
	declarations: NativeDeclarations,
	dispose: () => Promise<void>,
	getStopping: () => Promise<void> | undefined,
): PluginNativeSession["extension"] {
	return (pi) => {
		for (const command of declarations.commands)
			pi.registerCommand(command.name, {
				...(command.description === undefined ? {} : { description: command.description }),
				handler: async (args, ctx) => {
					await invokeNative(state, "command", command.name, args, ctx, ctx.signal);
				},
			});
		for (const tool of declarations.tools)
			pi.registerTool({
				...tool,
				parameters: tool.parameters as ToolDefinition["parameters"],
				execute: (id, input, signal, update, ctx) =>
					invokeNative(state, "tool", tool.name, input, ctx, signal, id, undefined, update) as ReturnType<
						ToolDefinition["execute"]
					>,
			} as ToolDefinition);
		registerNativeEvents(pi, state, declarations.events, dispose, getStopping);
	};
}

function registerNativeEvents(
	pi: ExtensionAPI,
	state: NativeAttachment,
	events: NativeDeclarations["events"],
	dispose: () => Promise<void>,
	getStopping: () => Promise<void> | undefined,
): void {
	const on = pi.on.bind(pi) as (
		name: NativeEventName,
		handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown>,
	) => void;
	// Register each callback independently so the real SDK chains hook results.
	for (const hook of events) {
		if (hook.name !== "session_shutdown")
			on(hook.name, async (event, ctx) => {
				const value = await invokeNative(
					state,
					"event",
					hook.name,
					event,
					ctx,
					ctx.signal,
					undefined,
					hook.index,
				);
				return applyNativeEventResponse(hook.name, event, value);
			});
	}
	pi.on("session_shutdown", async (event, ctx) => {
		const stopping = getStopping();
		if (stopping) return stopping;
		const results: PromiseSettledResult<unknown>[] = [];
		for (const hook of events) {
			if (hook.name === "session_shutdown")
				results.push(
					...(await Promise.allSettled([
						invokeNative(state, "event", hook.name, event, ctx, undefined, undefined, hook.index),
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
}

function applyNativeEventResponse(name: NativeEventName, event: unknown, value: unknown): unknown {
	if (name === "input") {
		if (!Check(nativeInputResponseSchema, value)) throw new Error("Invalid native input response");
		return value;
	}
	if (name === "turn_end") {
		if (!Check(nativeTurnEndResponseSchema, value)) throw new Error("Invalid native turn_end response");
		return value;
	}
	if (name === "tool_call") {
		if (!Check(nativeToolCallResponseSchema, value)) throw new Error("Invalid native tool_call response");
		const response = value as Static<typeof nativeToolCallResponseSchema>;
		const input = (event as { input: Record<PropertyKey, unknown> }).input;
		for (const key of Reflect.ownKeys(input)) delete input[key];
		Object.defineProperties(input, Object.getOwnPropertyDescriptors(response.input));
		return response.result;
	}
	if (name !== "before_agent_start") return value;
	if (!Check(beforeAgentStartResponseSchema, value))
		throw new Error("Invalid native before_agent_start response");
	const response = value as Static<typeof beforeAgentStartResponseSchema>;
	const options = (event as { systemPromptOptions: Record<PropertyKey, unknown> }).systemPromptOptions;
	// Preserve the SDK reference; descriptors keep __proto__ as an own data field.
	for (const key of Reflect.ownKeys(options)) delete options[key];
	Object.defineProperties(options, Object.getOwnPropertyDescriptors(response.systemPromptOptions));
	return response.result;
}
