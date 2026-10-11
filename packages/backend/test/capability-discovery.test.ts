import {
	createCapabilityCandidate,
	createCapabilityEnvironmentProbe,
	createCapabilityResearchPlan,
	createCapabilitySourceReceipt,
	createCapabilityValidationGate,
} from "@drone/shared";
import { describe, expect, it } from "vitest";
import {
	AnalysisAdapterRegistry,
	AssemblyAdapter,
	CapabilityDiscoveryService,
	createAnalysisAdapterRegistry,
} from "../src";

const now = "2026-10-12T00:00:00.000Z";
const caseRef = { kind: "research-case", id: "case-1" };

function candidate(id: string, capabilityId: string, version?: string) {
	return createCapabilityCandidate({
		id,
		capabilityId,
		...(version ? { version } : {}),
		assay: capabilityId,
		title: "Candidate",
		description: "Read-only candidate description",
		status: "described",
		sourceRefs: [],
		validationRefs: [],
		createdAt: now,
	});
}

describe("capability discovery service", () => {
	it("creates a gap for an unknown assay", async () => {
		const service = new CapabilityDiscoveryService({
			registry: createAnalysisAdapterRegistry(),
			now: () => now,
		});
		const request = await service.open({
			id: "unknown",
			caseRef,
			assay: "single-cell-atac",
			question: "Can I analyze this?",
		});
		expect(request.status).toBe("open");
		expect(request.gapReason).toBe("unknown-assay");
	});

	it("marks multiple registered versions ambiguous", async () => {
		const first = new AssemblyAdapter();
		const second = new AssemblyAdapter();
		(second as { identity: { id: string; version: string } }).identity = { id: "assembly", version: "2.0.0" };
		const registry = new AnalysisAdapterRegistry([first, second]);
		const service = new CapabilityDiscoveryService({ registry, now: () => now });
		const request = await service.open({
			id: "ambiguous",
			caseRef,
			assay: "assembly",
			question: "Which version?",
		});
		expect(request.gapReason).toBe("ambiguous-version");
		expect(request.status).toBe("open");
	});

	it("keeps research read-only and prevents a recommendation from enabling", async () => {
		const proposed = candidate("candidate-atac", "single-cell-atac", "0.1.0");
		const service = new CapabilityDiscoveryService({
			registry: createAnalysisAdapterRegistry(),
			now: () => now,
			research: {
				async research({ request }) {
					const source = createCapabilitySourceReceipt({
						id: "source-1",
						sourceRef: "wisp",
						sourceHash: "a".repeat(64),
						observedAt: now,
					});
					const plan = createCapabilityResearchPlan({
						id: "plan-1",
						requestRef: { kind: request.kind, id: request.id },
						objective: "discover",
						questions: ["inputs"],
						sourceRefs: [{ kind: source.kind, id: source.id }],
						createdAt: now,
					});
					return { plan, sources: [source], candidates: [proposed] };
				},
			},
		});
		await service.open({ id: "atac", caseRef, assay: "single-cell-atac", question: "Can I analyze this?" });
		const snapshot = await service.researchRequest("atac", { objective: "discover" });
		expect(snapshot.plan?.readOnly).toBe(true);
		expect(snapshot.sources[0]?.readOnly).toBe(true);
		await service.recommend("atac", proposed.id);
		await expect(service.enable("atac", "single-cell-atac@0.1.0")).rejects.toThrow(
			/not registered|directly executable/,
		);
	});

	it("rejects research results bound to another request or assay", async () => {
		const proposed = candidate("candidate-atac", "single-cell-atac", "0.1.0");
		const service = new CapabilityDiscoveryService({
			registry: createAnalysisAdapterRegistry(),
			now: () => now,
			research: {
				async research() {
					const source = createCapabilitySourceReceipt({
						id: "source-wrong",
						sourceRef: "wisp",
						sourceHash: "a".repeat(64),
						observedAt: now,
					});
					const plan = createCapabilityResearchPlan({
						id: "plan-wrong",
						requestRef: { kind: "capability-request", id: "other" },
						objective: "discover",
						questions: [],
						sourceRefs: [{ kind: source.kind, id: source.id }],
						createdAt: now,
					});
					return { plan, sources: [source], candidates: [proposed] };
				},
			},
		});
		await service.open({
			id: "atac-binding",
			caseRef,
			assay: "single-cell-atac",
			question: "Can I analyze this?",
		});
		await expect(service.researchRequest("atac-binding", { objective: "discover" })).rejects.toThrow(
			/different request/,
		);
	});

	it("blocks enabling a registered candidate when environment readiness is absent", async () => {
		const proposed = candidate("assembly-v1", "assembly", "1.0.0");
		const service = new CapabilityDiscoveryService({
			registry: createAnalysisAdapterRegistry(),
			now: () => now,
			research: {
				async research({ request }) {
					const plan = createCapabilityResearchPlan({
						id: "plan-assembly",
						requestRef: { kind: request.kind, id: request.id },
						objective: "verify",
						questions: [],
						sourceRefs: [],
						createdAt: now,
					});
					return { plan, sources: [], candidates: [proposed] };
				},
			},
			environment: {
				async probe({ capabilityRef }) {
					return createCapabilityEnvironmentProbe({
						id: "probe-1",
						capabilityRef,
						readiness: "not-ready",
						observed: {},
						missing: ["container"],
						probedAt: now,
					});
				},
			},
			validation: {
				async validate({ capabilityRef }) {
					return (["static", "fixture", "scientific"] as const).map((validation) =>
						createCapabilityValidationGate({
							id: `gate-${validation}`,
							capabilityRef,
							validation,
							status: "passed",
							detail: "ok",
							evidenceRefs: [],
							checkedAt: now,
						}),
					);
				},
			},
		});
		await service.open({ id: "assembly", caseRef, assay: "assembly", question: "Run assembly" });
		await service.researchRequest("assembly", { objective: "verify" });
		await service.probeEnvironment("assembly", proposed.id);
		const capsule = await service.validate("assembly", proposed.id);
		expect(capsule.status).toBe("validated");
		await expect(service.enable("assembly", "assembly@1.0.0")).rejects.toThrow(/environment/);
	});

	it("requires the exact recommended candidate before enabling", async () => {
		const proposed = candidate("assembly-v1-recommend", "assembly", "1.0.0");
		const service = new CapabilityDiscoveryService({
			registry: createAnalysisAdapterRegistry(),
			now: () => now,
			research: {
				async research({ request }) {
					const plan = createCapabilityResearchPlan({
						id: "plan-recommend",
						requestRef: { kind: request.kind, id: request.id },
						objective: "verify",
						questions: [],
						sourceRefs: [],
						createdAt: now,
					});
					return { plan, sources: [], candidates: [proposed] };
				},
			},
			environment: {
				async probe({ capabilityRef }) {
					return createCapabilityEnvironmentProbe({
						id: "probe-recommend",
						capabilityRef,
						readiness: "ready",
						observed: {},
						missing: [],
						probedAt: now,
					});
				},
			},
			validation: {
				async validate({ capabilityRef }) {
					return (["static", "fixture", "scientific"] as const).map((validation) =>
						createCapabilityValidationGate({
							id: `gate-recommend-${validation}`,
							capabilityRef,
							validation,
							status: "passed",
							detail: "ok",
							evidenceRefs: [],
							checkedAt: now,
						}),
					);
				},
			},
		});
		await service.open({ id: "assembly-recommend", caseRef, assay: "assembly", question: "Run assembly" });
		await service.researchRequest("assembly-recommend", { objective: "verify" });
		await service.probeEnvironment("assembly-recommend", proposed.id);
		await service.validate("assembly-recommend", proposed.id);
		await expect(service.enable("assembly-recommend", "assembly@1.0.0")).rejects.toThrow(/recommended/);
	});
});
