import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ComputeRerunResult, type FactArtifact, resultEnvelope } from "@gyoungwe/plugin-api/p5-inquiry";
import {
	type Code,
	type Failure,
	type FileReadback,
	type Receipt,
	RequestInput,
	type Result,
	type Scope,
} from "@gyoungwe/plugin-api/p5-receipts";
import type { P5RerunSource, P5RerunSubmitPorts } from "./p5-rerun-submit";
import type { PluginCapabilityContext as Context, PluginCapabilityHandler } from "./runtime-capabilities";

type State = Pick<ComputeRerunResult, "status" | "artifacts">;
export interface P5RerunRun extends State {
	readonly jobId: string;
	readonly inputSha256: string;
	readonly source: P5RerunSource;
}
export interface P5RerunLifecyclePorts extends Pick<P5RerunSubmitPorts, "store" | "scope" | "now"> {
	/** Scoped Q1 job lookup. Terminal snapshots require confirmed owned cleanup. */
	findRun(receipt: Receipt, scope: Scope): Promise<P5RerunRun | undefined>;
	/** Reconcile without terminal downgrades; terminal states require confirmed cleanup. */
	status(run: P5RerunRun, context: Context): Promise<State>;
	/** Confined collection plus actual source/output byte readback; preserve old outputs. */
	collect(
		run: P5RerunRun,
		context: Context,
	): Promise<{
		readonly sourceSha256: string;
		readonly readback: readonly FileReadback[];
	}>;
	/** Atomically preserve terminal outcomes; await cleanup before persisting cancelled.
	 * Failed cleanup stays unresolved in durable state so later calls cannot hide it. */
	cancel(
		run: P5RerunRun,
		context: Context,
	): Promise<"cancelled" | "succeeded" | "failed" | "outcome-unknown" | "cleanup-failed">;
}
interface Accepted {
	readonly request: RequestInput;
	readonly receipt: Receipt;
	readonly run: P5RerunRun | undefined;
}
type Outcome = Result<ComputeRerunResult>;
type Action = "collect" | "cancel";
type Ports = P5RerunLifecyclePorts;
const terminal = (status: State["status"]): status is "succeeded" | "failed" | "cancelled" =>
	["succeeded", "failed", "cancelled"].includes(status);
const fail = (code: Code, receiptRef: string | null = null): Failure => ({
	status: "failed",
	code,
	receiptRef,
});
async function lookup(ports: Ports, request: RequestInput, context: Context): Promise<Accepted | Failure> {
	const scope = ports.scope(context);
	const receipt = await ports.store.get(request);
	if (
		receipt?.operation !== "compute.rerun.submit" ||
		receipt.decision !== "approved" ||
		!isDeepStrictEqual(receipt.scope, scope)
	)
		return fail("DENIED");
	// A lost compute lookup is uncertainty, never evidence that the accepted job failed.
	const run = await ports.findRun(receipt, scope).catch(() => undefined);
	if (
		run &&
		(run.inputSha256 !== receipt.inputSha256 ||
			run.source.workspaceId !== scope.workspaceId ||
			run.source.sourceRunReceiptRef !== receipt.parentReceiptRef ||
			run.source.verifiedSha256 === null)
	)
		return fail("STATE_CONFLICT");
	return { request, receipt, run };
}
function result(
	accepted: Accepted,
	status: State["status"],
	receiptRef = accepted.receipt.receiptRef,
	artifacts: readonly FactArtifact[] = [],
): Outcome {
	return {
		status: "ok",
		value: {
			requestId: accepted.request.requestId,
			jobId: accepted.run?.jobId ?? null,
			status,
			artifacts,
			receiptRef,
		},
	};
}
async function perform(
	ports: Ports,
	run: P5RerunRun,
	action: Action,
	context: Context,
	accepted: Accepted,
	receiptRef: string,
): Promise<Outcome> {
	if (action === "cancel") {
		const cancelled = await ports.cancel(run, context);
		return cancelled === "cleanup-failed"
			? fail("CLEANUP_FAILED", receiptRef)
			: result(accepted, cancelled, receiptRef);
	}
	const collected = await ports.collect(run, context);
	const expected = run.artifacts.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
	if (
		collected.sourceSha256 !== run.source.verifiedSha256 ||
		!isDeepStrictEqual(collected.readback, expected)
	)
		return fail("READBACK_FAILED", receiptRef);
	return result(accepted, "succeeded", receiptRef, run.artifacts);
}
async function recordEffect(
	ports: Ports,
	accepted: Accepted,
	run: P5RerunRun,
	action: Action,
	context: Context,
): Promise<Outcome> {
	// Each authorized observation is a child of Q1; its terminal receipt is never overwritten.
	const receiptRef = randomUUID();
	const request = { requestId: receiptRef };
	try {
		await ports.store.accept(request, {
			...accepted.receipt,
			receiptRef,
			operation: `compute.rerun.${action}`,
			status: "accepted",
			at: ports.now(),
			parentReceiptRef: accepted.receipt.receiptRef,
			resultSha256: null,
			readback: [],
		});
	} catch {
		return fail("PERSISTENCE_PENDING");
	}
	// Persist only content-free outcomes; rejected IO cannot imply terminal execution failure.
	const outcome = await perform(ports, run, action, context, accepted, receiptRef).catch(() =>
		fail("OUTCOME_UNKNOWN", receiptRef),
	);
	const status =
		outcome.status === "failed"
			? outcome.code === "CLEANUP_FAILED"
				? "cleanup-failed"
				: outcome.code === "OUTCOME_UNKNOWN"
					? "outcome-unknown"
					: "failed"
			: terminal(outcome.value.status) || outcome.value.status === "outcome-unknown"
				? outcome.value.status
				: "succeeded";
	try {
		await ports.store.finish(request, {
			status,
			at: ports.now(),
			resultSha256:
				status === "succeeded" ? createHash("sha256").update(JSON.stringify(outcome)).digest("hex") : null,
			readback:
				outcome.status === "ok"
					? outcome.value.artifacts.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))
					: [],
		});
	} catch {
		return fail("PERSISTENCE_PENDING", receiptRef);
	}
	return outcome;
}
function handler(ports: Ports, action: "status" | Action): PluginCapabilityHandler {
	return {
		inputSchema: RequestInput,
		resultSchema: resultEnvelope(ComputeRerunResult),
		effect: action === "status" ? "read" : "write",
		approval: "always",
		approvalDetail: (input) => Object.freeze(input as RequestInput).requestId,
		observe: async (_input, _context, invocation) =>
			invocation.approved ? invocation.execute() : fail("DENIED"),
		execute: async (input, context) => {
			const accepted = await lookup(ports, input as RequestInput, context);
			if ("status" in accepted) return accepted;
			if (!accepted.run) return result(accepted, "outcome-unknown");
			// Transport failures remain recoverable; their private diagnostics stay in the port.
			const state = terminal(accepted.run.status)
				? accepted.run
				: await ports
						.status(accepted.run, context)
						.catch(() => ({ status: "outcome-unknown" as const, artifacts: [] }));
			if (
				action === "status" ||
				(action === "cancel" && terminal(state.status)) ||
				(action === "collect" && state.status !== "succeeded")
			)
				return result(accepted, state.status);
			return recordEffect(ports, accepted, { ...accepted.run, ...state }, action, context);
		},
	};
}
/** Composition owns registration, current caller identity and C approval; no polling or submission. */
export function p5RerunLifecycleHandlers(
	ports: P5RerunLifecyclePorts,
): Record<`compute.rerun.${"status" | Action}`, PluginCapabilityHandler> {
	return {
		"compute.rerun.status": handler(ports, "status"),
		"compute.rerun.collect": handler(ports, "collect"),
		"compute.rerun.cancel": handler(ports, "cancel"),
	};
}
