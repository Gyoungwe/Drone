import { createHash } from "node:crypto";
import type { FactArtifact } from "@gyoungwe/plugin-api/p5-inquiry";
import type { FileReadback } from "@gyoungwe/plugin-api/p5-receipts";
import { type createP5FactStore, P5FactStoreError, p5FactSummary } from "../plugins/p5-facts";
import type { InquiryLocalExecutionEvent } from "./inquiry-events";

type FactStore = ReturnType<typeof createP5FactStore>;
type LocalExecution = Pick<InquiryLocalExecutionEvent, "id" | "artifacts"> & {
	readonly outcome: InquiryLocalExecutionEvent["outcome"] | "interrupted";
};

export interface P5LocalFactPorts {
	readonly append: FactStore["append"];
	readonly scope: Parameters<FactStore["append"]>[0];
	/** Read and hash within the host-bound workspace using its current read permission. */
	readback(path: string): Promise<FileReadback | undefined>;
}

async function verifiedArtifacts(ports: P5LocalFactPorts, execution: LocalExecution, factId: string) {
	const artifacts: FactArtifact[] = [];
	for (const [index, artifact] of (execution.artifacts ?? []).entries()) {
		if (!artifact.sha256) continue;
		const readback = await ports.readback(artifact.path);
		if (!readback) continue;
		if (
			readback.path !== artifact.path ||
			readback.sha256 !== artifact.sha256 ||
			(artifact.bytes !== undefined && readback.bytes !== artifact.bytes)
		)
			throw new P5FactStoreError("READBACK_FAILED");
		artifacts.push({
			id: artifact.id ?? `${factId}:artifact:${index}`,
			path: readback.path,
			bytes: readback.bytes,
			sha256: readback.sha256,
			parentIds: artifact.parentIds ?? [],
			purpose: artifact.purpose ?? "deliverable",
		});
	}
	return artifacts;
}

/** Host-only observation; composition supplies the actual execution, scope and observation time. */
export function createP5LocalFacts(ports: P5LocalFactPorts) {
	return {
		async record(execution: LocalExecution, at: string) {
			if (execution.outcome === "running") throw new P5FactStoreError("INVALID_INPUT");
			const id = `local:${createHash("sha256")
				.update(JSON.stringify([ports.scope.workspaceId, ports.scope.sessionId, execution.id]))
				.digest("hex")}`;
			const metadata = {
				id,
				kind: "local-execution",
				entityId: execution.id,
				at,
				status: execution.outcome === "interrupted" ? "unknown" : execution.outcome,
				artifactRefs: await verifiedArtifacts(ports, execution, id),
				runReceiptRef: null,
				decisionKind: null,
				basis: [],
			} as const;
			return ports.append(ports.scope, { ...metadata, summary: p5FactSummary(metadata) });
		},
	};
}
