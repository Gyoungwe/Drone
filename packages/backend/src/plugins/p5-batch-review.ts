import { isDeepStrictEqual } from "node:util";
import { contractContentHash } from "@drone/shared";
import type { BatchInput } from "@gyoungwe/plugin-api/p5-discovery";
import type { Budget } from "@gyoungwe/plugin-api/p5-inquiry";
import type { Receipt, RequestInput, Scope } from "@gyoungwe/plugin-api/p5-receipts";
import type { P5ReceiptStore } from "./p5-receipt-store";

export interface ResolvedP5Plan {
	readonly itemId: string;
	readonly profile: string;
	readonly image: string | null;
	readonly preflightRef: string | null;
	readonly preflightSha256: string | null;
}
export interface FrozenP5Batch {
	readonly request: BatchInput;
	readonly scope: Scope;
	readonly plans: readonly (ResolvedP5Plan & { readonly budget: Budget })[];
	readonly sha256: string;
}
export interface ReviewedP5Batch {
	readonly batch: FrozenP5Batch;
	readonly computeReceiptRef: string;
	readonly modelReceiptRef: string | null;
}
interface BatchDecisions {
	readonly compute: RequestInput | null;
	readonly model: RequestInput | null;
}

function freeze<T>(value: T): T {
	if (value !== null && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

/** Request has passed the A3 BatchInput schema; resolutions and scope are host-owned. */
export function freezeP5Batch(
	request: BatchInput,
	resolutions: readonly ResolvedP5Plan[],
	scope: Scope,
): FrozenP5Batch {
	const entries = request.plan.kind === "multipath" ? request.plan.paths : request.plan.cases;
	const ids = new Set(entries.map((entry) => entry.id));
	if (ids.size !== entries.length) throw new Error("Duplicate path/case IDs");
	const itemIds = new Set(request.items.map((item) => item.id));
	if (itemIds.size !== request.items.length) throw new Error("Duplicate item IDs");
	if (ids.size !== itemIds.size || [...ids].some((id) => !itemIds.has(id)))
		throw new Error("Missing path/case item IDs");
	const byId = new Map(resolutions.map((plan) => [plan.itemId, plan]));
	if (byId.size !== resolutions.length) throw new Error("Duplicate resolved item IDs");
	if (byId.size !== itemIds.size) throw new Error("Missing resolved item IDs");
	const plans = request.items.map((item) => {
		const plan = byId.get(item.id);
		if (!plan) throw new Error("Missing resolved item IDs");
		if (
			item.execution.kind === "compute" &&
			(!plan.image || !plan.preflightSha256 || plan.preflightRef !== item.execution.preflightRef)
		)
			throw new Error("Unresolved compute plan");
		return { ...plan, budget: item.budget };
	});
	const snapshot = structuredClone({ request, plans, scope });
	return freeze({ ...snapshot, sha256: contractContentHash(snapshot) });
}

async function checkedDecision(
	store: P5ReceiptStore,
	request: RequestInput | null,
	category: Receipt["category"],
	batch: FrozenP5Batch,
): Promise<string> {
	const receipt = request === null ? undefined : await store.get(request);
	if (
		!receipt ||
		receipt.category !== category ||
		receipt.decision !== "approved" ||
		receipt.status !== "accepted" ||
		receipt.operation !== "execution.batch.run" ||
		receipt.inputSha256 !== batch.sha256 ||
		!isDeepStrictEqual(receipt.scope, batch.scope)
	)
		throw new Error("P5 batch decision does not match the reviewed batch");
	return receipt.receiptRef;
}

/** decide is a fresh host approval port, never a JSON receipt lookup or a restored grant. */
export function createP5BatchReviewer(
	store: P5ReceiptStore,
	decide: (batch: FrozenP5Batch) => Promise<BatchDecisions>,
) {
	const issued = new WeakSet<ReviewedP5Batch>();
	return {
		async review(candidate: FrozenP5Batch): Promise<ReviewedP5Batch> {
			const batch = freezeP5Batch(candidate.request, candidate.plans, candidate.scope);
			const decisions = await decide(batch);
			const computeReceiptRef = await checkedDecision(store, decisions.compute, "compute-preflight", batch);
			const modelReceiptRef = batch.request.items.some((item) => item.execution.kind === "model")
				? await checkedDecision(store, decisions.model, "background-model-spend", batch)
				: null;
			const reviewed = freeze({ batch, computeReceiptRef, modelReceiptRef });
			issued.add(reviewed);
			return reviewed;
		},
		validates(reviewed: ReviewedP5Batch, candidate: FrozenP5Batch): boolean {
			return (
				issued.has(reviewed) &&
				reviewed.batch.sha256 === freezeP5Batch(candidate.request, candidate.plans, candidate.scope).sha256
			);
		},
	};
}
