import { isDeepStrictEqual } from "node:util";
import type { ComputeRerunInput } from "@gyoungwe/plugin-api/p5-inquiry";
import type { Scope } from "@gyoungwe/plugin-api/p5-receipts";
import type { createP5ComputePlanStore, P5ComputePlan } from "../services/p5-compute-plans";
import type { createP5ComputeSourceStore } from "../services/p5-compute-sources";
import type { P5RerunSource } from "./p5-rerun-submit";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";

export interface P5ReviewSnapshot {
	readonly request: ComputeRerunInput;
	readonly scope: Scope;
	readonly plan: P5ComputePlan;
	readonly source: P5RerunSource;
}
export interface P5ReviewPreparationPorts {
	scope(context: PluginCapabilityContext): Scope;
	readonly resolvePlan: ReturnType<typeof createP5ComputePlanStore>["resolve"];
	readonly resolveSource: ReturnType<typeof createP5ComputeSourceStore>["resolveSource"];
	/** Check the current host-selected target root identity and grant; never issue authority. */
	checkRoot(plan: P5ComputePlan, context: PluginCapabilityContext): Promise<boolean>;
}
function freeze<T>(value: T): T {
	if (value !== null && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
function matchesCaller(scope: Scope, context: PluginCapabilityContext): boolean {
	return (
		context.scope.kind !== "application" &&
		context.scope.workspaceId === scope.workspaceId &&
		(context.scope.kind !== "session" || context.scope.sessionId === scope.sessionId)
	);
}
async function prepare(
	ports: P5ReviewPreparationPorts,
	input: unknown,
	context: PluginCapabilityContext,
): Promise<P5ReviewSnapshot> {
	const request = freeze(structuredClone(input as ComputeRerunInput));
	const scope = freeze(structuredClone(ports.scope(context)));
	if (!matchesCaller(scope, context)) throw new Error("P5 review scope changed");
	const [plan, source] = await Promise.all([
		ports.resolvePlan(request.preflightRef, scope),
		ports.resolveSource(request, scope),
	]);
	if (!plan || !source) throw new Error("P5 review cannot be resolved");
	if (
		plan.preflightRef !== request.preflightRef ||
		plan.profile !== request.profile ||
		!isDeepStrictEqual(plan.scope, scope) ||
		!isDeepStrictEqual(plan.budget, request.budget) ||
		source.workspaceId !== scope.workspaceId ||
		source.profile !== request.profile ||
		source.sourceRunReceiptRef !== request.sourceRunReceiptRef ||
		source.artifactId !== request.artifactId ||
		source.verifiedSha256 !== request.expectedSha256
	)
		throw new Error("P5 review binding mismatch");
	const snapshot = freeze({ request, scope, plan: structuredClone(plan), source: structuredClone(source) });
	if (!(await ports.checkRoot(snapshot.plan, context))) throw new Error("P5 review root unavailable");
	if (!isDeepStrictEqual(ports.scope(context), scope)) throw new Error("P5 review scope changed");
	return snapshot;
}
async function recheck(
	ports: P5ReviewPreparationPorts,
	snapshot: P5ReviewSnapshot,
	context: PluginCapabilityContext,
): Promise<void> {
	const { request, scope } = snapshot;
	const [plan, source] = await Promise.all([
		ports.resolvePlan(request.preflightRef, scope),
		ports.resolveSource(request, scope),
	]);
	if (
		!isDeepStrictEqual(plan, snapshot.plan) ||
		!isDeepStrictEqual(source, snapshot.source) ||
		!(await ports.checkRoot(snapshot.plan, context)) ||
		!matchesCaller(scope, context) ||
		!isDeepStrictEqual(ports.scope(context), scope)
	)
		throw new Error("P5 review is stale");
	context.signal.throwIfAborted();
}
/** Snapshot-aware host callbacks only; composition owns registration, review copy and receipts. */
export function withP5ReviewPreparation(
	handler: PluginCapabilityHandler,
	ports: P5ReviewPreparationPorts,
): PluginCapabilityHandler {
	return {
		...handler,
		prepare: (input, context) => prepare(ports, input, context),
		execute: async (snapshot, context) => {
			await recheck(ports, snapshot as P5ReviewSnapshot, context);
			return handler.execute(snapshot, context);
		},
	};
}
