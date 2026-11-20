import type { PluginNativeSession } from "@gyoungwe/plugin-api/native";
import type { HostFactDeliveryAcknowledgement, HostFactDeliveryOwner } from "@gyoungwe/plugin-api/p5-inquiry";
import type { PluginRuntimeFactory } from "@gyoungwe/plugin-api/runtime";

export interface P5CommittedProjection extends HostFactDeliveryOwner {
	cursor(): Promise<string | null>;
}

export interface HostNativeSession extends PluginNativeSession {
	readonly factOwner?: P5CommittedProjection;
}

export type HostNativeRuntimeFactory = PluginRuntimeFactory<HostNativeSession>;

async function readWhileAttached<Result>(
	lifetime: AbortSignal,
	read: () => Promise<unknown>,
	validate: (response: unknown) => Result,
): Promise<Result> {
	lifetime.throwIfAborted();
	let response: unknown;
	try {
		response = await read();
	} finally {
		lifetime.throwIfAborted();
	}
	return validate(response);
}

function committedCursor(response: unknown): string | null {
	if (response === null || typeof response === "string") return response;
	throw new Error("Invalid fact owner response");
}

function acknowledgement(response: unknown): HostFactDeliveryAcknowledgement {
	if (typeof response !== "object" || response === null || !Object.hasOwn(response, "cursor")) {
		throw new Error("Invalid fact owner response");
	}
	const { cursor } = response as Record<"cursor", unknown>;
	if (typeof cursor !== "string" || cursor.length === 0) throw new Error("Invalid fact owner response");
	return { cursor };
}

export function createP5OwnerFacade(
	owner: P5CommittedProjection,
	lifetime: AbortSignal,
): P5CommittedProjection {
	const facade: P5CommittedProjection = {
		cursor: () => readWhileAttached(lifetime, () => owner.cursor(), committedCursor),
		deliver: (delivery) => readWhileAttached(lifetime, () => owner.deliver(delivery), acknowledgement),
	};
	return Object.freeze(facade);
}
