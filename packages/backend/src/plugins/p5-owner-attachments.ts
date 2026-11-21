import type { Scope } from "@gyoungwe/plugin-api/p5-receipts";
import type { ManagedNativeSession } from "./native-session-facade";
import type { createP5FactStore, P5FactCommitPort } from "./p5-facts";
import { createP5HostDelivery, type P5ActiveFactOwner } from "./p5-host-delivery";
import type { P5CommittedProjection } from "./p5-owner-facade";
import type { PluginRuntimeSource } from "./plugin-source";
import type { PluginSessionCallerContext } from "./session-caller";

/** Composition-supplied (T166). The bridge never builds scope hashes or authority itself. */
export interface P5OwnerAttachmentPort {
	scopeOf(source: PluginRuntimeSource, session: PluginSessionCallerContext): Scope;
	readonly facts: Pick<ReturnType<typeof createP5FactStore>, "read"> & P5FactCommitPort;
	authorize(attachment: P5ActiveFactOwner): Promise<boolean>;
}

export function attachFactOwner(
	port: P5OwnerAttachmentPort,
	owner: P5CommittedProjection,
	source: PluginRuntimeSource,
	session: PluginSessionCallerContext,
	signal: AbortSignal,
): { release(): Promise<void> } {
	let current: P5ActiveFactOwner | undefined = { ...port.scopeOf(source, session), owner, signal };
	const delivery = createP5HostDelivery({
		facts: port.facts,
		currentOwner: () => current,
		cursorOf: () => owner.cursor(),
		subscribe: (scope, changed) => port.facts.subscribe(scope, changed),
		authorize: (attachment) => port.authorize(attachment),
	}).bind(owner);
	let releasing: Promise<void> | undefined;
	return {
		release() {
			if (!releasing) {
				current = undefined;
				releasing = Promise.resolve().then(() => delivery.drain());
				delivery.unsubscribe();
			}
			return releasing;
		},
	};
}

export function bindNativeFactOwner(
	port: P5OwnerAttachmentPort | undefined,
	native: ManagedNativeSession,
	source: PluginRuntimeSource,
	bindingSignal: AbortSignal,
) {
	const { hostFactOwner, retainFactOwner } = native;
	if (!port || !hostFactOwner || !retainFactOwner) return undefined;
	let attached = false;
	return (session: PluginSessionCallerContext) => {
		if (attached) return;
		const signal = AbortSignal.any([bindingSignal, session.signal]);
		if (signal.aborted) return;
		retainFactOwner(attachFactOwner(port, hostFactOwner, source, session, signal).release);
		attached = true;
	};
}
