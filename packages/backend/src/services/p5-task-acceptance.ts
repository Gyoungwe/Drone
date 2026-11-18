import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Fact } from "@gyoungwe/plugin-api/p5-inquiry";
import type { Hash, Receipt, Scope, Time } from "@gyoungwe/plugin-api/p5-receipts";
import { type createP5FactStore, p5FactSummary } from "../plugins/p5-facts";
import type { P5ReceiptStore } from "../plugins/p5-receipt-store";

export interface P5TaskSession {
	readonly workspaceId: string;
	readonly sessionId: string;
}
export interface P5TaskOwnerAttachment {
	readonly session: P5TaskSession;
	readonly generation: number;
	readonly callerSourceHash: Hash;
	readonly ownerSourceHash: Hash;
}
export interface P5CommittedTaskTransition {
	readonly attachment: P5TaskOwnerAttachment;
	readonly taskId: string;
	readonly transitionId: string;
	readonly state: string;
	readonly durable: boolean;
	readonly at: Time;
	/** Host-verified hashes bind this exact task and transition to the observed effect. */
	readonly receipt: Pick<Receipt, "requestId" | "operation" | "inputSha256" | "resultSha256">;
}
export interface P5TaskAcceptanceOptions {
	readonly facts: Pick<ReturnType<typeof createP5FactStore>, "append">;
	readonly receipts: Pick<P5ReceiptStore, "getByRef">;
	/** Observe a newly committed owner transition, never restored JSON or a status view. */
	observeCommittedTransition(
		attachment: P5TaskOwnerAttachment,
	): Promise<P5CommittedTaskTransition | undefined>;
	isLive(attachment: P5TaskOwnerAttachment): boolean;
}

interface VerifiedAcceptance {
	readonly attachment: P5TaskOwnerAttachment;
	readonly session: P5TaskSession;
	readonly generation: number;
	readonly scope: Scope;
	readonly transition: P5CommittedTaskTransition;
}

function stillBound({ attachment, session, generation, scope }: VerifiedAcceptance): boolean {
	return (
		attachment.session === session &&
		attachment.generation === generation &&
		session.workspaceId === scope.workspaceId &&
		session.sessionId === scope.sessionId &&
		attachment.callerSourceHash === scope.callerSourceHash &&
		attachment.ownerSourceHash === scope.providerSourceHash
	);
}

async function issueTaskAcceptance(
	options: P5TaskAcceptanceOptions,
	proofs: WeakMap<object, VerifiedAcceptance>,
	proof: object,
	receiptRef: string,
): Promise<Fact | undefined> {
	const verified = proofs.get(proof);
	if (!verified) return undefined;
	const { transition, scope } = verified;
	const receipt = await options.receipts.getByRef({ receiptRef });
	const expected = transition.receipt;
	if (
		receipt?.status !== "succeeded" ||
		receipt.operation !== expected.operation ||
		receipt.requestId !== expected.requestId ||
		receipt.inputSha256 !== expected.inputSha256 ||
		receipt.resultSha256 !== expected.resultSha256 ||
		!isDeepStrictEqual(receipt.scope, scope)
	)
		return undefined;
	const metadata = {
		id: `task-accepted:${createHash("sha256").update(transition.transitionId).digest("hex")}`,
		kind: "task-accepted",
		entityId: transition.taskId,
		at: transition.at,
		status: "accepted",
		artifactRefs: [],
		runReceiptRef: receipt.receiptRef,
		decisionKind: null,
		basis: [transition.transitionId],
	} as const;
	const input = { ...metadata, summary: p5FactSummary(metadata) };
	if (!stillBound(verified) || !options.isLive(verified.attachment)) return undefined;
	return options.facts.append(scope, input);
}

/** Host composition only; no proof can be minted from caller-supplied transition data. */
export function createP5TaskAcceptanceIssuer(options: P5TaskAcceptanceOptions) {
	const proofs = new WeakMap<object, VerifiedAcceptance>();
	const issue = (proof: object, receiptRef: string) =>
		issueTaskAcceptance(options, proofs, proof, receiptRef);
	return {
		observeTaskAcceptance: async (attachment: P5TaskOwnerAttachment, receiptRef: string) => {
			const { session, generation, callerSourceHash, ownerSourceHash } = attachment;
			const scope = { ...session, callerSourceHash, providerSourceHash: ownerSourceHash };
			if (!options.isLive(attachment)) return undefined;
			const transition = await options.observeCommittedTransition(attachment);
			if (
				!transition ||
				transition.attachment !== attachment ||
				transition.state !== "completed" ||
				!transition.durable
			)
				return undefined;
			const proof = Object.freeze({});
			proofs.set(proof, {
				attachment,
				session,
				generation,
				scope,
				transition: { ...transition, receipt: { ...transition.receipt } },
			});
			return issue(proof, receiptRef);
		},
		issueTaskAcceptance: issue,
	};
}
