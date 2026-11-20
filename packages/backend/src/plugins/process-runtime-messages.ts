import { AsyncResource } from "node:async_hooks";
import { createInterface, type Interface } from "node:readline";
import type { Readable } from "node:stream";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PluginRuntimeContext, PluginRuntimeFactoryContext } from "@gyoungwe/plugin-api/runtime";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { toolProgressSchema } from "../tool-progress";
import { callWithMeasuredEnvelope, type HostCapabilityPort } from "./runtime-capabilities";

const declarationSchema = Type.Record(
	Type.String(),
	Type.Object({
		inputSchema: Type.Record(Type.String(), Type.Unknown()),
		resultSchema: Type.Record(Type.String(), Type.Unknown()),
		effect: Type.Union([Type.Literal("read"), Type.Literal("write")]),
	}),
);
export type NativeToolUpdate = NonNullable<Parameters<ToolDefinition["execute"]>[3]>;

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
type WorkerMessage = Static<typeof messageSchema>;
type CapabilityMessage = Extract<WorkerMessage, { type: "capability" }> & { readonly envelopeBytes: number };
export type Message = Exclude<WorkerMessage, { type: "capability" }> | CapabilityMessage;
export type Declarations = { operations: Static<typeof declarationSchema>; native: boolean };

export interface PendingInvocation {
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly cleanup: () => void;
	readonly onUpdate?: NativeToolUpdate;
	readonly signal?: AbortSignal;
}

interface ProcessRuntimeMessageHandlers {
	readonly failed: () => boolean;
	readonly context: Pick<PluginRuntimeFactoryContext, "signal" | "events">;
	readonly pending: Map<string, PendingInvocation>;
	readonly fail: (error: Error) => void;
	readonly ready: (declarations: Declarations) => void;
	readonly disposeResources: (message: Extract<Message, { type: "dispose_resources" }>) => void;
	readonly cancelCapability: (message: Extract<Message, { type: "cancel_capability" }>) => void;
	readonly capability: (message: CapabilityMessage) => void;
}

export function readProcessRuntimeMessages(
	input: Readable,
	handlers: ProcessRuntimeMessageHandlers,
): Interface {
	const lines = createInterface({ input, crlfDelay: Infinity });
	lines.on("line", (line) => {
		let message: unknown;
		try {
			message = JSON.parse(line);
		} catch (error) {
			handlers.fail(new Error("Plugin runtime emitted invalid JSON", { cause: error }));
			return;
		}
		if (!Check(messageSchema, message)) {
			handlers.fail(new Error("Plugin runtime emitted an invalid protocol message"));
			return;
		}
		if (handlers.failed()) return;
		const parsed = message as WorkerMessage;
		if (parsed.type === "capability") {
			handlers.capability({ ...parsed, envelopeBytes: Buffer.byteLength(line, "utf8") });
		} else {
			receive(parsed, handlers);
		}
	});
	return lines;
}

function receive(
	message: Exclude<Message, { type: "capability" }>,
	handlers: ProcessRuntimeMessageHandlers,
): void {
	if (message.type === "canceled") {
		handlers.fail(
			handlers.context.signal.aborted
				? handlers.context.signal.reason
				: new Error("Plugin runtime canceled without host cancellation"),
		);
		return;
	}
	if (message.type === "dispose_resources") {
		handlers.disposeResources(message);
		return;
	}
	if (message.type === "cancel_capability") {
		handlers.cancelCapability(message);
		return;
	}
	if (message.type === "changed") {
		if (!handlers.context.signal.aborted) handlers.context.events.changed();
		return;
	}
	if (message.type === "ready") {
		handlers.ready({ operations: message.operations, native: message.native });
		return;
	}
	if (message.type === "error") {
		handlers.fail(new Error(message.error));
		return;
	}
	receiveResult(message, handlers);
}

function receiveResult(
	message: Extract<Message, { type: "result" | "native_update" }>,
	handlers: ProcessRuntimeMessageHandlers,
): void {
	const pending = handlers.pending.get(message.id);
	if (!pending) {
		handlers.fail(new Error("Plugin runtime replied to an unknown invocation"));
		return;
	}
	if (message.type === "native_update") {
		if (!pending.onUpdate) {
			handlers.fail(new Error("Plugin runtime sent an unrequested tool update"));
			return;
		}
		if (!pending.signal?.aborted) {
			try {
				pending.onUpdate(message.value as Parameters<NativeToolUpdate>[0]);
			} catch (error) {
				// A failed SDK observer must reject this runtime, never escape the protocol listener.
				handlers.fail(error as Error);
			}
		}
		return;
	}
	handlers.pending.delete(message.id);
	pending.cleanup();
	if (message.ok) pending.resolve(message.value);
	else pending.reject(new Error(message.error));
}

export function bindProcessRuntimeCapabilities(capabilities: HostCapabilityPort): HostCapabilityPort {
	const measuredCall = capabilities[callWithMeasuredEnvelope];
	return {
		call: AsyncResource.bind(capabilities.call),
		...(measuredCall && { [callWithMeasuredEnvelope]: AsyncResource.bind(measuredCall) }),
	};
}

export async function executeProcessRuntimeCapability(
	message: CapabilityMessage,
	context: PluginRuntimeFactoryContext | PluginRuntimeContext,
	abort: AbortController,
	send: (message: unknown) => void,
): Promise<void> {
	try {
		context.signal.throwIfAborted();
		const capabilities: HostCapabilityPort = context.capabilities;
		const call = capabilities[callWithMeasuredEnvelope];
		if (!call) throw new Error("Plugin capability port does not support measured envelopes");
		const value = await call(message.name, message.input, abort.signal, message.envelopeBytes);
		context.signal.throwIfAborted();
		send({ type: "capability_result", id: message.id, ok: true, value });
	} catch (error) {
		send({
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
