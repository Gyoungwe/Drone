import { contractContentHash } from "@drone/shared";
import type { Code, Result, Scope } from "@gyoungwe/plugin-api/p5-receipts";

export interface PrimaryRunRecord {
	readonly primaryRunReceiptRef: string;
	readonly workspaceId: string;
	readonly sessionId: string;
	readonly sourceHash: string;
	readonly origin: "host" | "imported" | "plugin";
	readonly findingIds: readonly string[];
	readonly provider: { readonly providerId: string; readonly modelId: string };
}

export interface PrimaryRunBinding {
	readonly primaryRunReceiptRef: string;
	readonly findingId: string;
	readonly provider: { readonly providerId: string; readonly modelId: string };
	readonly bindingSha256: string;
}

type PrimaryRunInput = Pick<PrimaryRunBinding, "primaryRunReceiptRef" | "findingId">;

function isPrimaryRunInput(input: unknown): input is PrimaryRunInput {
	if (typeof input !== "object" || input === null) return false;
	const candidate = input as Record<string, unknown>;
	return (
		Reflect.ownKeys(input).length === 2 &&
		Object.hasOwn(input, "primaryRunReceiptRef") &&
		Object.hasOwn(input, "findingId") &&
		typeof candidate.primaryRunReceiptRef === "string" &&
		candidate.primaryRunReceiptRef.length > 0 &&
		typeof candidate.findingId === "string" &&
		candidate.findingId.length > 0
	);
}

function failure(code: Code): Result<never> {
	return { status: "failed", code, receiptRef: null };
}

/** Host records are the only authority; this resolver neither persists nor restores approval. */
export function createP5PrimaryRunResolver(port: {
	runOf(ref: string, scope: Scope): Promise<PrimaryRunRecord | undefined>;
}) {
	return {
		async resolve(input: unknown, scope: Scope): Promise<Result<PrimaryRunBinding>> {
			if (!isPrimaryRunInput(input)) return failure("INVALID_INPUT");
			const { primaryRunReceiptRef, findingId } = input;
			const record = await port.runOf(primaryRunReceiptRef, scope);
			if (
				!record ||
				record.workspaceId !== scope.workspaceId ||
				record.sessionId !== scope.sessionId ||
				record.sourceHash !== scope.callerSourceHash ||
				record.origin !== "host"
			)
				return failure("DENIED");
			if (!record.findingIds.includes(findingId)) return failure("INVALID_INPUT");
			const provider = Object.freeze({
				providerId: record.provider.providerId,
				modelId: record.provider.modelId,
			});
			return {
				status: "ok",
				value: Object.freeze({
					primaryRunReceiptRef,
					findingId,
					provider,
					bindingSha256: contractContentHash({
						primaryRunReceiptRef,
						findingId,
						provider,
						workspaceId: record.workspaceId,
						sessionId: record.sessionId,
					}),
				}),
			};
		},
	};
}

export async function verifyP5PrimaryRunBinding(
	resolver: ReturnType<typeof createP5PrimaryRunResolver>,
	binding: PrimaryRunBinding,
	scope: Scope,
): Promise<boolean> {
	const result = await resolver.resolve(
		{ primaryRunReceiptRef: binding.primaryRunReceiptRef, findingId: binding.findingId },
		scope,
	);
	return result.status === "ok" && result.value.bindingSha256 === binding.bindingSha256;
}
