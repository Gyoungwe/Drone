import { isDeepStrictEqual } from "node:util";
import { BatchResult, type Item, type ItemResult } from "@gyoungwe/plugin-api/p5-discovery";
import {
	type Failure,
	type Receipt,
	RequestInput,
	type Result,
	resultEnvelope,
	type Scope,
} from "@gyoungwe/plugin-api/p5-receipts";
import type { createP5BatchExecutor } from "./p5-batch-execution";
import type { FrozenP5Batch, ReviewedP5Batch } from "./p5-batch-review";
import type { PluginCapabilityContext as Context, PluginCapabilityHandler } from "./runtime-capabilities";

type Executor = ReturnType<typeof createP5BatchExecutor>;
type RunResult = Awaited<ReturnType<Executor["run"]>>;
export interface P5BatchLifecyclePorts {
	readonly executor: Executor;
	/** Current source generations and workspace/session come only from host composition. */
	scope(context: Context): Scope | undefined;
	/** Authorized host lookup, including historical snapshots for read-only reconciliation. */
	findBatch(request: RequestInput, context: Context): Promise<ReviewedP5Batch | undefined>;
}
interface OwnedRun {
	readonly controller: AbortController;
	readonly done: Promise<RunResult>;
	outcome?: RunResult;
}
const fail = (code: Failure["code"]): Failure => ({ status: "failed", code, receiptRef: null });
function itemState(receipt: Receipt | null, active: boolean): ItemResult["status"] {
	if (receipt === null) return "pending";
	if (receipt.status === "accepted") return active ? "running" : "blocked";
	if (receipt.status === "outcome-unknown" || receipt.status === "cleanup-failed") return "blocked";
	return receipt.status;
}
function batchState(
	items: readonly ItemResult[],
	receipts: readonly (Receipt | null)[],
	owned?: OwnedRun,
): BatchResult["status"] {
	if (receipts.some((receipt) => receipt?.status === "cleanup-failed")) return "cleanup-failed";
	if (owned && !owned.outcome) return "running";
	if (owned?.outcome?.status === "ok" && owned.outcome.value.status === "cancelled") return "cancelled";
	if (items.every((item) => item.status === "succeeded")) return "complete";
	return items.some((item) => item.status !== "pending" && item.status !== "succeeded")
		? "blocked"
		: "accepted";
}
function snapshot(
	reviewed: ReviewedP5Batch,
	receipts: readonly (Receipt | null)[],
	owned?: OwnedRun,
): BatchResult {
	const active = owned !== undefined && owned.outcome === undefined;
	const items: ItemResult[] = receipts.map((receipt, index) => ({
		// T149 returns exactly one receipt slot per frozen item, in the same order.
		itemId: (reviewed.batch.request.items[index] as Item).id,
		status: itemState(receipt, active),
		value: null,
		hostReceiptRef: receipt === null ? null : receipt.receiptRef,
	}));
	return {
		requestId: reviewed.batch.request.requestId,
		status: batchState(items, receipts, owned),
		batchReceiptRef: reviewed.computeReceiptRef,
		items,
		grade: null,
		metrics: [],
		journalVersion: null,
		inquiryReceiptRefs: [],
	};
}
function handler(
	ports: P5BatchLifecyclePorts,
	runs: Map<string, OwnedRun>,
	action: "status" | "cancel",
): PluginCapabilityHandler {
	return {
		inputSchema: RequestInput,
		resultSchema: resultEnvelope(BatchResult),
		effect: action === "status" ? "read" : "write",
		execute: async (input, context): Promise<Result<BatchResult>> => {
			try {
				const scope = ports.scope(context);
				if (!scope) return fail("DENIED");
				const request = input as RequestInput;
				const reviewed = await ports.findBatch(request, context);
				if (
					!reviewed ||
					reviewed.batch.request.requestId !== request.requestId ||
					!isDeepStrictEqual(reviewed.batch.scope, scope)
				)
					return fail("DENIED");
				const owned = runs.get(reviewed.batch.sha256);
				if (action === "cancel" && owned && !owned.outcome) {
					owned.controller.abort();
					await owned.done;
				}
				const receipts = await ports.executor.receipts(reviewed);
				if (receipts.status === "failed") return receipts;
				if (owned?.outcome?.status === "failed") return owned.outcome;
				return { status: "ok", value: snapshot(reviewed, receipts.value, owned) };
			} catch {
				// Failed reconciliation is public uncertainty; private IO diagnostics stay in the host.
				return fail("OUTCOME_UNKNOWN");
			}
		},
	};
}
/** Host-only run ownership; status/cancel never dispatch or restore execution authority. */
export function createP5BatchLifecycle(ports: P5BatchLifecyclePorts) {
	const runs = new Map<string, OwnedRun>();
	const used = new WeakSet<ReviewedP5Batch>();
	return {
		run(reviewed: ReviewedP5Batch, candidate: FrozenP5Batch): Promise<RunResult> {
			const previous = runs.get(reviewed.batch.sha256);
			if (used.has(reviewed) || (previous && !previous.outcome))
				return Promise.resolve(fail("STATE_CONFLICT"));
			used.add(reviewed);
			const controller = new AbortController();
			const owned: OwnedRun = {
				controller,
				done: ports.executor
					.run(reviewed, candidate, { signal: controller.signal })
					.catch(() => fail("OUTCOME_UNKNOWN"))
					.then((outcome) => {
						owned.outcome = outcome;
						return outcome;
					}),
			};
			runs.set(reviewed.batch.sha256, owned);
			return owned.done;
		},
		handlers: {
			"execution.batch.status": handler(ports, runs, "status"),
			"execution.batch.cancel": handler(ports, runs, "cancel"),
		},
	};
}
