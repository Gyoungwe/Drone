import type { PluginRuntimeCapabilities } from "./runtime.js";

/** One native subagent slot, bound to the acquiring operation invocation. */
export interface PluginAgentSlotAcquireResult {
	readonly lease: string;
}
export interface PluginAgentSlotReleaseInput {
	readonly lease: string;
}
export interface PluginAgentSlotReleaseResult {
	readonly released: boolean;
}

/** Holds a slot for the whole run; the host also releases forgotten leases when the invocation settles. */
export async function withPluginAgentSlot<T>(
	capabilities: PluginRuntimeCapabilities,
	signal: AbortSignal | undefined,
	work: () => Promise<T>,
): Promise<T> {
	const { lease } = (await capabilities.call(
		"agent.slot.acquire",
		{},
		signal,
	)) as PluginAgentSlotAcquireResult;
	let workFailed = false;
	try {
		signal?.throwIfAborted();
		return await work();
	} catch (error) {
		workFailed = true;
		throw error;
	} finally {
		// Release must still reach the host after the local work signal aborts.
		await capabilities.call("agent.slot.release", { lease }).catch((error: unknown) => {
			// Preserve the work failure; the host finalizer still owns any unreleased lease.
			if (!workFailed) throw error;
		});
	}
}
