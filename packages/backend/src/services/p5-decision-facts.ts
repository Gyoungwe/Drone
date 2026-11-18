import { createHash } from "node:crypto";
import type { Fact } from "@gyoungwe/plugin-api/p5-inquiry";
import { ReceiptInput, type Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { Check } from "typebox/value";
import { type createP5FactStore, p5FactSummary } from "../plugins/p5-facts";
import type { P5ReceiptStore } from "../plugins/p5-receipt-store";

interface DecisionFactPorts {
	readonly append: ReturnType<typeof createP5FactStore>["append"];
	readonly getByRef: P5ReceiptStore["getByRef"];
	readonly scope: Scope;
	readonly decisionKind: NonNullable<Fact["decisionKind"]>;
}

/** Scope and decision kind come from host composition, never decision-record JSON. */
export function createP5DecisionFacts(ports: DecisionFactPorts) {
	return async (input: unknown): Promise<Fact | undefined> => {
		if (!Check(ReceiptInput, input)) throw new Error("Invalid P5 decision receipt reference");
		const receipt = await ports.getByRef(input as ReceiptInput);
		if (
			receipt?.decision !== "approved" ||
			receipt.status !== "succeeded" ||
			receipt.scope.workspaceId !== ports.scope.workspaceId ||
			receipt.scope.sessionId !== ports.scope.sessionId ||
			receipt.scope.callerSourceHash !== ports.scope.callerSourceHash ||
			receipt.scope.providerSourceHash !== ports.scope.providerSourceHash
		)
			return undefined;
		const metadata: Omit<Fact, "sequence" | "summary"> = {
			id: `decision:${createHash("sha256").update(receipt.receiptRef).digest("hex")}`,
			kind: "decision",
			entityId: receipt.requestId,
			at: receipt.at,
			status: "succeeded",
			artifactRefs: [],
			runReceiptRef: receipt.receiptRef,
			decisionKind: ports.decisionKind,
			basis: [receipt.requestId],
		};
		return ports.append(ports.scope, { ...metadata, summary: p5FactSummary(metadata) });
	};
}
