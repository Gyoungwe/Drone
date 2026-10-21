import type { KnowledgeSourceReceipt } from "@gyoungwe/plugin-api/knowledge";
import { describe, expect, it } from "vitest";
import {
	checkKnowledgeReceiptFreshness,
	checkKnowledgeSnapshotReuse,
	ingestKnowledgeSnapshot,
	KnowledgeReuseIndex,
	resolveKnowledgeContext,
} from "../src/reuse";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-10-12T00:00:00.000Z";
const context = resolveKnowledgeContext({ workspaceRoot: "/work/drone", projectId: "pasilla" });

function source(overrides: Partial<KnowledgeSourceReceipt> = {}): KnowledgeSourceReceipt {
	return {
		sourceRef: "Library/Papers/example.md",
		version: "v1",
		contentHash: HASH_A,
		receiptRef: "receipt:example:v1",
		readAt: "2026-10-11T00:00:00.000Z",
		evidenceGrade: "primary",
		...overrides,
	};
}

describe("knowledge snapshot ingest and reuse", () => {
	it("records project/workspace context and analysis/checkpoint receipt links", () => {
		const snapshot = ingestKnowledgeSnapshot({
			context,
			sources: [
				source({
					analysisRefs: [{ kind: "analysis", id: "analysis-1" }],
					checkpointRefs: [{ kind: "evidence-checkpoint", id: "checkpoint-1" }],
				}),
			],
			assay: "bulk-rnaseq",
			methodVersion: "deseq2@1",
			referenceVersion: "GRCh38",
			inputManifestHash: HASH_B,
			createdAt: NOW,
			ingestedAt: NOW,
		});
		expect(snapshot.projectId).toBe("pasilla");
		expect(snapshot.workspaceId).toBe(context.workspaceId);
		expect(snapshot.evidenceGrade).toBe("primary");
		expect(snapshot.reuseLevel).toBe("evidence-eligible");
		expect(snapshot.analysisRefs).toEqual([{ kind: "analysis", id: "analysis-1" }]);
		expect(snapshot.evidenceCheckpointRefs).toEqual([{ kind: "evidence-checkpoint", id: "checkpoint-1" }]);
		expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);
	});

	it("rejects reuse when receipt hash or method context is stale", () => {
		const snapshot = ingestKnowledgeSnapshot({
			context,
			sources: [source()],
			assay: "bulk-rnaseq",
			methodVersion: "deseq2@1",
			createdAt: NOW,
			ingestedAt: NOW,
		});
		const decision = checkKnowledgeSnapshotReuse(snapshot, {
			context,
			assay: "bulk-rnaseq",
			methodVersion: "deseq2@2",
			now: NOW,
			sourceStates: { [source().sourceRef]: { contentHash: HASH_B, version: "v1" } },
			requireCurrent: true,
		});
		expect(decision.reusable).toBe(false);
		expect(decision.status).toBe("stale");
		expect(decision.reasons).toContain("method version does not match");
	});

	it("uses a durable store port and records successful reuse", async () => {
		let persisted: readonly ReturnType<typeof ingestKnowledgeSnapshot>[] = [];
		const store = {
			read: async () => persisted,
			write: async (next: readonly ReturnType<typeof ingestKnowledgeSnapshot>[]) => {
				persisted = next;
			},
		};
		const index = new KnowledgeReuseIndex(store);
		const snapshot = ingestKnowledgeSnapshot({
			context,
			sources: [source()],
			createdAt: NOW,
			ingestedAt: NOW,
		});
		await index.ingest(snapshot);
		const result = await index.reuse(snapshot.id, { context, now: NOW });
		expect(result.reusable).toBe(true);
		expect(result.reusedAt).toBe(NOW);
		expect(index.get(snapshot.id)?.reuseCount).toBe(1);
		expect(persisted).toHaveLength(1);
	});
});

describe("knowledge freshness", () => {
	it("uses expiry and host observed checks", () => {
		const expired = source({ freshness: { checkedAt: NOW, expiresAt: "2026-10-11T23:59:59.000Z" } });
		expect(checkKnowledgeReceiptFreshness(expired, { now: NOW }).status).toBe("stale");
		expect(
			checkKnowledgeReceiptFreshness(source(), {
				now: NOW,
				requireCurrent: true,
				current: { contentHash: HASH_A, version: "v1" },
			}).status,
		).toBe("fresh");
		expect(checkKnowledgeReceiptFreshness(source(), { now: NOW, requireCurrent: true }).status).toBe(
			"unknown",
		);
	});
});
