import type { PluginRuntimeOperation, PluginRuntimeScope } from "@gyoungwe/plugin-api/runtime";
import type { P5ApprovalReview } from "./p5-approval-review";

export interface PluginRuntimeActivation {
	readonly pluginId: string;
	readonly applicationId: string;
}

/**
 * One host-authorized call.
 *
 * Both the string detail and the structured review are produced by a host
 * capability handler, never taken from plugin operation input. The detail
 * names what kind of write is happening; the review carries the facts of
 * this particular write so the user is asked about the real thing.
 */
export interface PluginRuntimeInvocation extends PluginRuntimeActivation {
	readonly scope: PluginRuntimeScope;
	readonly callerIdentity: object;
	readonly operation: string;
	readonly effect: PluginRuntimeOperation["effect"];
	readonly input: unknown;
	/** Produced by a host capability handler, never taken from plugin operation input. */
	readonly approvalDetail?: string;
	/** The host-authored review the user is shown; the desktop renders it with approved copy. */
	readonly approvalReview?: P5ApprovalReview;
	/** Host capability approval policy; absent for plugin operations. */
	readonly approval?: "own" | "always" | "allowance";
}

export interface PluginRuntimePolicy {
	/** Recheck enablement/trust before the factory imports or executes any plugin code. */
	authorizeActivation(request: PluginRuntimeActivation, signal: AbortSignal): Promise<boolean>;
	/** Enforce caller access and declared permissions; write approval may interact with the user. */
	authorizeInvocation(request: PluginRuntimeInvocation, signal: AbortSignal): Promise<boolean>;
}
