import { createHash } from "node:crypto";
import type { Fact, FactArtifact } from "@gyoungwe/plugin-api/p5-inquiry";
import type { FileReadback } from "@gyoungwe/plugin-api/p5-receipts";
import { type createP5FactStore, P5FactStoreError, p5FactSummary } from "../plugins/p5-facts";
import type { ComputeEvent } from "./compute";

type Append = ReturnType<typeof createP5FactStore>["append"];
export interface P5ComputeFactsPorts {
	readonly append: Append;
	readonly scope: Parameters<Append>[0];
}
export interface P5ComputeCollection {
	readonly artifacts: readonly FactArtifact[];
	readonly readback: readonly (Omit<FileReadback, "sha256"> & { readonly sha256?: string | null })[];
}
type Event = Pick<ComputeEvent, "id" | "jobId" | "type" | "at"> & { readonly status?: string };
const statuses: ReadonlyMap<string, Fact["status"]> = new Map([
	["draft", "created"],
	["authorized", "created"],
	["prepared", "created"],
	["submitting", "submitted"],
	["queued", "submitted"],
	["running", "running"],
	["collecting", "running"],
	["cancelling", "running"],
	["succeeded", "succeeded"],
	["failed", "failed"],
	["cancelled", "cancelled"],
	["blocked", "blocked"],
	["partial", "partial"],
	["needs-login", "blocked"],
	["needs_login", "blocked"],
]);

function verifiedArtifacts(collection: P5ComputeCollection | undefined): readonly FactArtifact[] {
	if (!collection) throw new P5FactStoreError("READBACK_FAILED");
	const observed = new Map(collection.readback.map((file) => [file.path, file]));
	if (
		collection.readback.length !== collection.artifacts.length ||
		observed.size !== collection.artifacts.length
	)
		throw new P5FactStoreError("READBACK_FAILED");
	return collection.artifacts.map(({ id, path, bytes, sha256, parentIds, purpose }) => {
		const actual = observed.get(path);
		if (!actual || actual.sha256 !== sha256 || actual.bytes !== bytes)
			throw new P5FactStoreError("READBACK_FAILED");
		observed.delete(path);
		return { id, path, bytes: actual.bytes, sha256: actual.sha256, parentIds, purpose };
	});
}

/** Host composition supplies observations, receipt refs and scope; this is not a JSON capability. */
export function createP5ComputeFacts(ports: P5ComputeFactsPorts) {
	return {
		record: async (
			event: Event,
			runReceiptRef: string | null,
			collection?: P5ComputeCollection,
		): Promise<Fact | undefined> => {
			if (event.type === "logs") return undefined;
			const status = statuses.get(event.status ?? "unknown") ?? "unknown";
			const identity = [ports.scope.workspaceId, ports.scope.sessionId, event.jobId, event.id];
			const metadata: Omit<Fact, "sequence" | "summary"> = {
				id: `p5-compute:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`,
				kind: "compute",
				entityId: event.jobId,
				at: new Date(event.at).toISOString(),
				status,
				artifactRefs:
					event.type === "collected" && status === "succeeded" ? verifiedArtifacts(collection) : [],
				runReceiptRef,
				decisionKind: null,
				basis: [event.id, `compute:${event.type}`],
			};
			return ports.append(ports.scope, { ...metadata, summary: p5FactSummary(metadata) });
		},
	};
}
