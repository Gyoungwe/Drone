import type { PluginRuntimeContext } from "@gyoungwe/plugin-api/runtime";
import type { HostNativeFactOwner } from "./p5-owner-facade";
import type { ProcessNativeHost } from "./process-native-attachment";

export function createProcessFactCourier({
	attachment,
	lifecycle,
	host,
}: {
	attachment: string;
	lifecycle: AbortController;
	host: ProcessNativeHost;
}): { owner: HostNativeFactOwner; drain(): Promise<void> } {
	const signal = AbortSignal.any([host.context.signal, lifecycle.signal]);
	const inFlight = new Set<Promise<unknown>>();

	async function request<Response>(
		type: "native_fact_cursor" | "native_fact_deliver",
		payload: Record<string, unknown>,
		context: PluginRuntimeContext | undefined,
	): Promise<Response> {
		signal.throwIfAborted();
		if (context?.scope.kind !== "session")
			throw new Error("Native fact owner session is no longer available");
		const requestSignal = AbortSignal.any([signal, context.signal]);
		requestSignal.throwIfAborted();
		const pending = host.request(type, payload, requestSignal, context);
		inFlight.add(pending);
		return pending.finally(() => {
			inFlight.delete(pending);
		}) as Promise<Response>;
	}

	return {
		owner: {
			cursor: (context?: PluginRuntimeContext) => request("native_fact_cursor", { attachment }, context),
			deliver: ({ cursor, facts }, context?: PluginRuntimeContext) =>
				request("native_fact_deliver", { attachment, facts: { cursor, facts } }, context),
		},
		async drain() {
			// Requests already report errors to their callers; drain only orders detach.
			await Promise.allSettled(inFlight);
		},
	};
}
