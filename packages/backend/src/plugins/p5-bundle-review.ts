import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { canonicalContractJson } from "@drone/shared";
import { BundleInput, EvidenceExportInput } from "@gyoungwe/plugin-api/p5-evidence";
import type { Code, RequestInput, Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { Check } from "typebox/value";
import type { P5ReceiptStore } from "./p5-receipt-store";

// Matches file-capabilities.ts MAX_TEXT_BYTES; D7 reuses the existing host text bound.
export const P5_REVIEW_MAX_TEXT_BYTES = 1024 * 1024;
export class P5BundleReviewError extends Error {
	constructor(readonly code: Extract<Code, "INVALID_INPUT" | "LIMIT_EXCEEDED" | "DENIED">) {
		super(`P5 bundle review rejected: ${code}`);
		this.name = "P5BundleReviewError";
	}
}
export type P5BundleTarget = Pick<EvidenceExportInput, "destination" | "audience">;
export interface FrozenP5Bundle {
	readonly request: BundleInput;
	readonly target: P5BundleTarget;
	readonly scope: Scope;
	readonly sha256: string;
}
export interface ReviewedP5Bundle {
	readonly bundle: FrozenP5Bundle;
	readonly computeReceiptRef: string;
}

/** Target/scope are host-derived; staged identities require prior host byte-adapter verification. */
export function freezeP5Bundle(request: BundleInput, target: P5BundleTarget, scope: Scope): FrozenP5Bundle {
	if (
		!Check(BundleInput, request) ||
		!Check(EvidenceExportInput.properties.destination, target.destination) ||
		!Check(EvidenceExportInput.properties.audience, target.audience) ||
		new Set(request.files.map((file) => file.path)).size !== request.files.length
	)
		throw new P5BundleReviewError("INVALID_INPUT");
	const snapshot = structuredClone({ request, target, scope });
	for (const file of snapshot.request.files) {
		if (file.source.kind === "text") {
			const bytes = Buffer.byteLength(file.source.text, "utf8");
			if (bytes > P5_REVIEW_MAX_TEXT_BYTES) throw new P5BundleReviewError("LIMIT_EXCEEDED");
			const sha256 = createHash("sha256").update(file.source.text, "utf8").digest("hex");
			if (bytes !== file.bytes || sha256 !== file.sha256) throw new P5BundleReviewError("INVALID_INPUT");
		}
		Object.freeze(file.source);
		Object.freeze(file);
	}
	Object.freeze(snapshot.request.files);
	Object.freeze(snapshot.request);
	Object.freeze(snapshot.target);
	Object.freeze(snapshot.scope);
	const sha256 = createHash("sha256").update(canonicalContractJson(snapshot)).digest("hex");
	return Object.freeze({ ...snapshot, sha256 });
}

/** decide requests fresh export-only C consent; historical receipts never substitute for this call. */
export function createP5BundleReviewer(
	store: P5ReceiptStore,
	decide: (bundle: FrozenP5Bundle) => Promise<RequestInput | null>,
) {
	const issued = new WeakSet<ReviewedP5Bundle>();
	return {
		async review(candidate: FrozenP5Bundle): Promise<ReviewedP5Bundle> {
			const bundle = freezeP5Bundle(candidate.request, candidate.target, candidate.scope);
			const decision = await decide(bundle);
			const receipt = decision === null ? undefined : await store.get(decision);
			if (
				receipt?.category !== "compute-preflight" ||
				receipt.decision !== "approved" ||
				receipt.status !== "accepted" ||
				receipt.operation !== "files.writeBundle" ||
				receipt.inputSha256 !== bundle.sha256 ||
				!isDeepStrictEqual(receipt.scope, bundle.scope)
			)
				throw new P5BundleReviewError("DENIED");
			const reviewed = Object.freeze({ bundle, computeReceiptRef: receipt.receiptRef });
			issued.add(reviewed);
			return reviewed;
		},
		validates(reviewed: ReviewedP5Bundle, candidate: FrozenP5Bundle): boolean {
			return (
				issued.has(reviewed) &&
				reviewed.bundle.sha256 === freezeP5Bundle(candidate.request, candidate.target, candidate.scope).sha256
			);
		},
	};
}
