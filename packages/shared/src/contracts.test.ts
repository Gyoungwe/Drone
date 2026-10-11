import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AnalysisOrchestrator } from "./analysis-orchestration";
import { sha256 } from "./contract-hash";
import {
	assertResearchContract,
	canonicalContractJson,
	contractContentHash,
	createCapabilityRequest,
	createCapabilityVersion,
	createDecision,
	createDecisionFromProposal,
	createDecisionProposal,
	createResearchCase,
	createRunAttempt,
	forkResearchCase,
	migrateAnalysisContext,
	migrateEvidenceCheckpoint,
	migrateLegacyContract,
	migratePlanProposal,
	type VersionedRecord,
} from "./contracts";

const now = "2026-10-12T00:00:00.000Z";
const caseRef = { kind: "research-case", id: "case-1" };

function valid(record: VersionedRecord): void {
	expect(() => assertResearchContract(record)).not.toThrow();
	expect(JSON.parse(JSON.stringify(record))).toEqual(record);
}

describe("portable versioned research contracts", () => {
	it.each(["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(1000), "分析🧬", "\ud800"])(
		"matches SHA-256 for UTF-8 and block-boundary inputs",
		(text) => expect(sha256(text)).toBe(createHash("sha256").update(text).digest("hex")),
	);

	it("hashes nested objects independently of property order", () => {
		const a = { z: [{ b: 2, a: "中文" }], a: null };
		const b = { a: null, z: [{ a: "中文", b: 2 }] };
		expect(contractContentHash(a)).toBe(contractContentHash(b));
		expect(contractContentHash(a)).toBe(createHash("sha256").update(canonicalContractJson(a)).digest("hex"));
	});

	it("detects tampering and rejects unsupported versions and revisions", () => {
		const record = createResearchCase({
			id: "case-1",
			projectId: "p",
			question: "Why?",
			createdAt: now,
			updatedAt: now,
		});
		valid(record);
		expect(() => assertResearchContract({ ...record, question: "Changed" } as typeof record)).toThrow(
			"contentHash mismatch",
		);
		expect(() => assertResearchContract({ ...record, schemaVersion: 2 })).toThrow("schemaVersion");
		expect(() => createResearchCase({ id: "c", projectId: "p", question: "q", revision: -1 })).toThrow(
			"revision",
		);
	});

	it("constructs all non-legacy contract kinds with detached input arrays", () => {
		const requirements = ["paired reads"];
		const request = createCapabilityRequest({
			id: "r",
			caseRef,
			assay: "RNA-seq",
			question: "q",
			requirements,
			status: "open",
			createdAt: now,
			updatedAt: now,
		});
		requirements.push("changed");
		expect(request.requirements).toEqual(["paired reads"]);
		valid(request);
		valid(
			createCapabilityVersion({
				id: "v",
				capabilityId: "rna",
				version: "1",
				status: "candidate",
				contractHash: "a".repeat(64),
				validationRefs: [],
				createdAt: now,
			}),
		);
		valid(
			createDecision({
				id: "d",
				proposalRef: { kind: "decision-proposal", id: "p" },
				proposalHash: "b".repeat(64),
				status: "rejected",
				decidedAt: now,
			}),
		);
		valid(
			createRunAttempt({ id: "a", caseRef, status: "queued", attempt: 1, inputRefs: [], outputRefs: [] }),
		);
	});

	it("migrates blocked analysis state deterministically without losing its snapshot", () => {
		const machine = new AnalysisOrchestrator({ now: () => now });
		const context = {
			...machine.create({ id: "a", question: "q", assay: "assembly", mode: "exploratory" }),
			status: "blocked" as const,
		};
		const migrated = migrateAnalysisContext(context);
		valid(migrated);
		expect(migrated).toMatchObject({
			status: "blocked",
			legacyAnalysis: context,
			createdAt: now,
			updatedAt: now,
		});
		expect(migrateAnalysisContext(context)).toEqual(migrated);
		expect(migrated.legacyAnalysis).not.toBe(context);
	});

	it("preserves proposal data while requiring a new decision on the new contract", () => {
		const proposal = {
			version: 1,
			project: "p",
			goal: "goal",
			summary: "summary",
			contractHash: "a".repeat(64),
			approval: "approved" as const,
			findings: [
				{
					text: "result",
					citations: [{ path: "Library/source.md", hash: "b".repeat(64), receiptRef: "receipt" }],
				},
			],
			candidates: [{ id: "one", title: "One", method: "method", resources: "1 hour", risks: ["risk"] }],
			questions: [{ id: "q", question: "Which?", defaultValue: "one", options: ["one"] }],
			recommendation: { candidateId: "one", reason: "reason" },
		};
		const migrated = migratePlanProposal(proposal, now);
		valid(migrated);
		expect(migrated).toMatchObject({
			status: "accepted",
			legacyProposal: proposal,
			findings: [{ text: "result" }],
			recommendation: { candidateId: "one" },
		});
		expect(migrated.questions[0]).not.toHaveProperty("recommendation");
		expect(migratePlanProposal(proposal, now)).toEqual(migrated);
	});

	it("retains checkpoint provenance without claiming reproduced capability", () => {
		const checkpoint = {
			schemaVersion: 1,
			id: "c".repeat(64),
			analysis: { id: "a", question: "q", assay: "assembly" },
			files: [{ kind: "output", artifact: { path: "results.tsv", sha256: "d".repeat(64), versionId: "v1" } }],
			environmentFingerprint: "environment",
			createdAt: now,
		};
		const migrated = migrateEvidenceCheckpoint(checkpoint);
		valid(migrated);
		expect(migrated).toMatchObject({
			legacyCheckpoint: checkpoint,
			reuseLevel: "evidence-eligible",
			sources: [{ contentHash: "d".repeat(64), version: "v1" }],
		});
		expect(migrated).not.toHaveProperty("methodVersion");
		expect(migrateEvidenceCheckpoint(checkpoint)).toEqual(migrated);
	});

	it("forks without inheriting decisions, runs or legacy approvals", () => {
		const parent = createResearchCase({
			id: "p",
			projectId: "project",
			question: "q",
			decisionRefs: ["approved"],
			runAttemptRefs: ["run"],
			createdAt: now,
			updatedAt: now,
		});
		const branch = forkResearchCase(parent, { id: "branch", now });
		valid(branch);
		expect(branch).toMatchObject({
			decisionRefs: [],
			runAttemptRefs: [],
			parentRefs: [{ id: "p", contentHash: parent.contentHash }],
		});
	});

	it("generic migration yields a verifiable hash and leaves input untouched", () => {
		const old = { id: "old", schemaVersion: 0, nested: { value: "x" } };
		const migrated = migrateLegacyContract(old);
		valid(migrated);
		expect(old.schemaVersion).toBe(0);
		expect(migrated.migration?.fromSchemaVersion).toBe(0);
	});

	it("records an explicit choice and scope, rejects stale proposals, and gates high-risk actions", () => {
		const proposal = createDecisionProposal({
			id: "proposal-1",
			caseRef,
			contextSnapshot: { kind: "context", id: "ctx", contentHash: "c".repeat(64) },
			capabilityVersionRef: { kind: "capability-version", id: "cap", contentHash: "a".repeat(64) },
			workflowRef: { kind: "workflow", id: "wf", contentHash: "b".repeat(64) },
			findings: [],
			candidates: [],
			questions: [{ id: "q", question: "Choose", allowCustomText: true }],
			authorizationScope: {
				actions: [{ id: "write", label: "Write output", risk: "high" }],
				capabilityVersionRef: { kind: "capability-version", id: "cap", contentHash: "a".repeat(64) },
				workflowRef: { kind: "workflow", id: "wf", contentHash: "b".repeat(64) },
			},
			highRiskActions: [{ id: "write", label: "Write output", risk: "high" }],
			status: "pending",
			createdAt: now,
		});
		const decision = createDecisionFromProposal(proposal, {
			id: "decision-1",
			proposalHash: proposal.contentHash,
			contextHash: "c".repeat(64),
			capabilityHash: "a".repeat(64),
			workflowHash: "b".repeat(64),
			customText: "my answer",
			authorizedActionIds: ["write"],
			decidedAt: now,
		});
		valid(decision);
		expect(decision.choice).toBe("my answer");
		expect(decision.authorizationScopeHash).toMatch(/^[a-f0-9]{64}$/);
		expect(decision.decisionHash).toBe(decision.contentHash);
		expect(() =>
			createDecisionFromProposal(proposal, {
				id: "stale",
				proposalHash: proposal.contentHash,
				contextHash: "d".repeat(64),
			}),
		).toThrow(/context changed/);
		expect(() =>
			createDecisionFromProposal(proposal, { id: "risk", proposalHash: proposal.contentHash }),
		).toThrow(/High-risk/);
	});
});
