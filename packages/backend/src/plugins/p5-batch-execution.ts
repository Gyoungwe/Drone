import { isDeepStrictEqual } from "node:util";
import { contractContentHash } from "@drone/shared";
import type { Item } from "@gyoungwe/plugin-api/p5-discovery";
import type { Failure, FileReadback, Receipt, Result, Usage } from "@gyoungwe/plugin-api/p5-receipts";
import type { createP5BatchReviewer, FrozenP5Batch, ReviewedP5Batch } from "./p5-batch-review";
import { createP5ReceiptObserver } from "./p5-receipt-observer";
import type { P5ReceiptStore } from "./p5-receipt-store";

interface HostContext {
	/** Host-derived background/unattended policy; never taken from request JSON. */
	readonly metered: boolean;
	/** Host-owned cancellation; execution settles only after its cleanup is drained. */
	readonly signal?: AbortSignal;
}
interface ItemOutcome {
	/** True only when the host port verified execution completed successfully. */
	readonly verified: boolean;
	readonly usage?: Usage;
}
export interface P5BatchExecutionPort {
	expectedReadback(item: Item, batch: FrozenP5Batch): readonly FileReadback[];
	execute(item: Item, batch: FrozenP5Batch, context: HostContext): Promise<ItemOutcome>;
	readback(item: Item, batch: FrozenP5Batch): Promise<readonly FileReadback[]>;
}
interface Ports {
	readonly store: P5ReceiptStore;
	readonly reviewer: Pick<ReturnType<typeof createP5BatchReviewer>, "validates">;
	readonly port: P5BatchExecutionPort;
	readonly context: HostContext;
	now(): string;
}
interface BatchOutcome {
	readonly status: "complete" | "blocked" | "cancelled";
	readonly items: readonly Receipt[];
}
const operation = "execution.batch.run";
function failure(code: Failure["code"]): Failure {
	return { status: "failed", code, receiptRef: null };
}
function itemRequest(batch: FrozenP5Batch, item: Item) {
	// Stable across fresh reviews, while changed plans conflict instead of dispatching again.
	return { requestId: `p5-item:${contractContentHash([batch.scope, batch.request.requestId, item.id])}` };
}
async function batchReceipts(
	store: P5ReceiptStore,
	batch: FrozenP5Batch,
): Promise<Result<readonly (Receipt | null)[]>> {
	const items: (Receipt | null)[] = [];
	for (const item of batch.request.items) {
		const existing = await store.get(itemRequest(batch, item));
		if (
			existing &&
			(existing.inputSha256 !== batch.sha256 ||
				existing.operation !== operation ||
				!isDeepStrictEqual(existing.scope, batch.scope))
		)
			return failure("DUPLICATE_CONFLICT");
		items.push(existing ?? null);
	}
	return { status: "ok", value: items };
}
function itemUsage(
	item: Item,
	context: HostContext,
	outcome: ItemOutcome | undefined,
	verified: boolean,
): Usage {
	const metered = context.metered && item.execution.kind === "model";
	if (outcome?.usage === undefined)
		return { state: "unknown", metered, inputTokens: null, outputTokens: null, cost: null };
	return verified ? { ...outcome.usage, metered } : { ...outcome.usage, metered, state: "unknown" };
}

async function runItem(
	ports: Ports,
	reviewed: ReviewedP5Batch,
	item: Item,
	context: HostContext,
): Promise<Receipt> {
	const { batch } = reviewed;
	const request = itemRequest(batch, item);
	const expectedReadback = structuredClone(ports.port.expectedReadback(item, batch));
	let outcome: ItemOutcome | undefined;
	let verified = false;
	try {
		await createP5ReceiptObserver(
			ports.store,
			ports.now,
		)({
			request,
			approved: true,
			metadata: {
				operation,
				inputSha256: batch.sha256,
				scope: batch.scope,
				category: "compute-preflight",
				parentReceiptRef: reviewed.computeReceiptRef,
			},
			expectedReadback,
			execute: async () => {
				outcome = await ports.port.execute(item, batch, context);
				if (!outcome.verified) throw new Error("P5 item outcome is unverified");
				return outcome;
			},
			readback: async () => {
				const actual = await ports.port.readback(item, batch);
				verified = isDeepStrictEqual(actual, expectedReadback);
				return actual;
			},
			usage: () => itemUsage(item, context, outcome, verified),
		});
	} catch (error) {
		// R3 already persisted these content-free outcomes; persistence/internal errors still propagate.
		if (
			!(error instanceof Error) ||
			!("code" in error) ||
			!["OUTCOME_UNKNOWN", "READBACK_FAILED", "STATE_CONFLICT"].includes(String(error.code))
		)
			throw error;
	}
	const receipt = await ports.store.get(request);
	if (!receipt) throw new Error("P5 item receipt is missing after observation");
	return receipt;
}

/** Host-private runner only. T1 supplies live review authority; receipts only suppress repeat effects. */
export function createP5BatchExecutor(ports: Ports) {
	return {
		/** Read-only reconciliation; identity mismatches return DUPLICATE_CONFLICT. */
		receipts(reviewed: ReviewedP5Batch): Promise<Result<readonly (Receipt | null)[]>> {
			return batchReceipts(ports.store, reviewed.batch);
		},
		async run(
			reviewed: ReviewedP5Batch,
			candidate: FrozenP5Batch,
			options?: { signal?: AbortSignal },
		): Promise<Result<BatchOutcome>> {
			if (!ports.reviewer.validates(reviewed, candidate)) return failure("DENIED");
			const batch = reviewed.batch;
			if (candidate.sha256 !== batch.sha256) return failure("STATE_CONFLICT");
			if (batch.request.items.some((item) => item.execution.kind === "model"))
				return failure("MODEL_UNAVAILABLE");
			const existing = await batchReceipts(ports.store, batch);
			if (existing.status === "failed") return existing;
			const signal = options?.signal;
			const context = signal ? { ...ports.context, signal } : ports.context;
			const items: Receipt[] = [];
			for (const item of reviewed.batch.request.items) {
				if (signal?.aborted) break;
				items.push(await runItem(ports, reviewed, item, context));
			}
			const completionStatus = signal?.aborted ? "cancelled" : "complete";
			const status = items.every((item) => item.status === "succeeded") ? completionStatus : "blocked";
			return { status: "ok", value: { status, items } };
		},
	};
}
