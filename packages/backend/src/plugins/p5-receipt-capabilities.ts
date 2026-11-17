import {
	Receipt,
	ReceiptInput,
	type Result,
	resultEnvelope,
	type Scope,
} from "@gyoungwe/plugin-api/p5-receipts";
import type { P5ReceiptStore } from "./p5-receipt-store";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";

/** Composition resolves actual plugin identity/source generation and workspace/session, never request JSON. */
export function p5ReceiptCapabilityHandlers(
	store: Pick<P5ReceiptStore, "getByRef">,
	scopeOf: (context: PluginCapabilityContext) => Scope | undefined,
): Record<"receipts.read", PluginCapabilityHandler> {
	return {
		"receipts.read": {
			effect: "read",
			inputSchema: ReceiptInput,
			resultSchema: resultEnvelope(Receipt),
			execute: async (input, context): Promise<Result<Receipt>> => {
				const scope = scopeOf(context);
				const receipt = scope ? await store.getByRef(input as ReceiptInput) : undefined;
				if (
					!scope ||
					!receipt ||
					receipt.scope.workspaceId !== scope.workspaceId ||
					receipt.scope.sessionId !== scope.sessionId ||
					receipt.scope.callerSourceHash !== scope.callerSourceHash ||
					receipt.scope.providerSourceHash !== scope.providerSourceHash
				)
					return { status: "failed", code: "DENIED", receiptRef: null };
				return { status: "ok", value: receipt };
			},
		},
	};
}
