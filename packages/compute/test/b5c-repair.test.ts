import { describe, expect, it } from "vitest";
import {
	assertWorkflowRegistered,
	checkRegisteredJobAuthorization,
	compileWorkflow,
	computeJobContractHash,
	createComputeAuthorization,
	createRnaseqWorkflowSpec,
	InMemoryWorkflowRegistrationPort,
	RNASEQ_PIPELINE,
	registerWorkflowSpec,
	rnaseqModuleCatalog,
	runAutonomousRepair,
	workflowSpecHash,
} from "../src/index";
import type { ComputeWorkflowJobSpec, WorkflowFailureLookupPort } from "../src/types";

describe("B5c workflow registration", () => {
	it("requires a prior and binds registration to the immutable spec hash", async () => {
		const spec = {
			...createRnaseqWorkflowSpec({ samplesheet: "reads.csv" }),
			prior: {
				id: "prior-rnaseq",
				statement: "The test profile should produce a QC report",
				direction: "increase" as const,
				confidence: 0.7,
			},
		};
		const catalog = rnaseqModuleCatalog();
		const registrations = new InMemoryWorkflowRegistrationPort();
		await expect(assertWorkflowRegistered(spec, catalog, registrations)).rejects.toThrow("registered");
		const registration = await registerWorkflowSpec(spec, catalog, registrations);
		expect(registration.priorId).toBe("prior-rnaseq");
		expect(registration.workflowSpecSha256).toBe(workflowSpecHash(spec));
		expect((await assertWorkflowRegistered(spec, catalog, registrations)).moduleIds).toEqual([
			RNASEQ_PIPELINE,
		]);
		await expect(
			assertWorkflowRegistered(
				{ ...spec, metadata: { changed: "after-registration" } },
				catalog,
				registrations,
			),
		).rejects.toThrow("registered");
	});
});

describe("B5c autonomous repair", () => {
	it("looks up failures and records each bounded decision", async () => {
		const spec = createRnaseqWorkflowSpec({ samplesheet: "reads.csv" });
		const catalog = rnaseqModuleCatalog();
		const calls: string[] = [];
		const lookup: WorkflowFailureLookupPort = {
			lookupFailures: ({ signature }) => {
				calls.push(`failure:${signature}`);
				return [{ id: "f-1", signature, summary: "known failure", outcome: "failed" }];
			},
			lookupNegativeResults: ({ signature }) => {
				calls.push(`negative:${signature}`);
				return [{ id: "n-1", signature: signature ?? "", summary: "negative result", outcome: "negative" }];
			},
		};
		let executions = 0;
		const journaled: string[] = [];
		const result = await runAutonomousRepair({
			spec,
			catalog,
			lookup,
			execute: async () => {
				executions += 1;
				return executions === 1
					? { ok: false, failure: { signature: "missing-index", message: "index missing", at: "now" } }
					: { ok: true, summary: "preview passed" };
			},
			repair: ({ spec: current }) => ({
				spec: { ...current, metadata: { ...(current.metadata ?? {}), repaired: "true" } },
				decision: {
					action: "enable the indexed fixture",
					rationale: "The failure record points to a missing index",
				},
			}),
			onDecisionMade: (decision) => {
				journaled.push(decision.action);
			},
		});
		expect(result.status).toBe("succeeded");
		expect(result.attempts).toHaveLength(2);
		expect(result.decisionsMadeForYou[0]).toMatchObject({ label: "我替你决定的", attempt: 1 });
		expect(journaled).toEqual(["enable the indexed fixture"]);
		expect(calls).toEqual(["failure:missing-index", "negative:missing-index"]);
	});

	it("stops when the same failure repeats instead of replaying it", async () => {
		const spec = createRnaseqWorkflowSpec({ samplesheet: "reads.csv" });
		let executions = 0;
		const result = await runAutonomousRepair({
			spec,
			catalog: rnaseqModuleCatalog(),
			maxAttempts: 3,
			execute: async () => {
				executions += 1;
				return {
					ok: false,
					failure: { signature: "same-error", message: "still broken", at: String(executions) },
				};
			},
			repair: ({ spec: current }) => ({
				spec: { ...current, metadata: { ...(current.metadata ?? {}), retry: String(executions) } },
				decision: { action: "retry once", rationale: "one bounded retry is useful" },
			}),
		});
		expect(result.status).toBe("blocked");
		expect(result.reason).toContain("repeated");
		expect(result.attempts).toHaveLength(2);
		expect(executions).toBe(2);
	});
});

describe("B5c registered authorization seam", () => {
	it("rejects an unregistered spec immediately before submission", async () => {
		const spec = {
			...createRnaseqWorkflowSpec({ samplesheet: "reads.csv" }),
			prior: { id: "prior", statement: "A report is expected" },
		};
		const artifact = compileWorkflow(spec, rnaseqModuleCatalog());
		const authorization = createComputeAuthorization({
			approved: true,
			hosts: ["fake-host"],
			remoteRead: ["/data"],
			remoteWrite: ["/data"],
			workflows: [RNASEQ_PIPELINE],
			budget: { maxCoreHours: 4, maxWalltimeMinutes: 60, maxConcurrentJobs: 1, maxDiskGb: 10 },
		});
		const base = {
			jobId: "job-registered",
			host: "fake-host",
			workflow: { ...artifact, executionMode: "ready" as const },
			executor: { kind: "direct" as const, cpus: 2, memoryMb: 2048, walltimeMinutes: 30 },
			remoteRead: ["/data/reads"],
			remoteWrite: ["/data/results"],
			authorization,
		};
		const job: ComputeWorkflowJobSpec = { ...base, contractHash: computeJobContractHash(base) };
		const result = await checkRegisteredJobAuthorization(
			job,
			spec,
			rnaseqModuleCatalog(),
			new InMemoryWorkflowRegistrationPort(),
		);
		expect(result.ok).toBe(false);
		expect(result.reason).toContain("registered");
	});
});
