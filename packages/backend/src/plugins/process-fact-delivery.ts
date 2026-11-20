import type { P5CommittedProjection } from "./p5-owner-facade";
import type { ProcessNativeHost } from "./process-native-attachment";

export function createProcessFactCourier({
	attachment,
	lifecycle,
	host,
}: {
	attachment: string;
	lifecycle: AbortController;
	host: ProcessNativeHost;
}): { owner: P5CommittedProjection; drain(): Promise<void> } {
	const signal = AbortSignal.any([host.context.signal, lifecycle.signal]);
	const inFlight = new Set<Promise<unknown>>();

	async function request<Response>(
		type: "native_fact_cursor" | "native_fact_deliver",
		payload: Record<string, unknown>,
	): Promise<Response> {
		signal.throwIfAborted();
		const pending = host.request(type, payload, signal);
		inFlight.add(pending);
		return pending.finally(() => {
			inFlight.delete(pending);
		}) as Promise<Response>;
	}

	return {
		owner: {
			cursor: () => request("native_fact_cursor", { attachment }),
			deliver: ({ cursor, facts }) =>
				request("native_fact_deliver", { attachment, facts: { cursor, facts } }),
		},
		async drain() {
			// Requests already report errors to their callers; drain only orders detach.
			await Promise.allSettled(inFlight);
		},
	};
}
