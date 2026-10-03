import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
	type ComputeAuthorization,
	ComputeAuthorizationSchema,
	type ComputeJobRequest,
	checkComputeAuthorization,
} from "./compute";

const authorization: ComputeAuthorization = {
	hosts: ["slurm-a"],
	remoteRead: ["/data/in"],
	remoteWrite: ["/data/out"],
	workflows: ["rnaseq"],
	budget: { maxCoreHours: 10, maxWalltimeMinutes: 60, maxConcurrentJobs: 2, maxDiskGb: 20 },
};

const request = (overrides: Partial<ComputeJobRequest> = {}): ComputeJobRequest => ({
	host: "slurm-a",
	workflow: "rnaseq",
	readPaths: ["/data/in/sample.fastq"],
	writePaths: ["/data/out/result.bam"],
	wallMinutes: 30,
	coreHours: 2,
	diskBytes: 1024,
	...overrides,
});

describe("compute authorization", () => {
	it("accepts the canonical task block and rejects malformed values", () => {
		expect(Check(ComputeAuthorizationSchema, authorization)).toBe(true);
		expect(Check(ComputeAuthorizationSchema, { ...authorization, hosts: ["bad host"] })).toBe(false);
		expect(
			Check(ComputeAuthorizationSchema, {
				...authorization,
				budget: { ...authorization.budget, maxConcurrentJobs: 0 },
			}),
		).toBe(false);
	});

	it("fails closed for host, workflow and path scope", () => {
		expect(checkComputeAuthorization(null, request()).code).toBe("missing_authorization");
		expect(checkComputeAuthorization(authorization, request({ host: "other" })).code).toBe(
			"host_not_allowed",
		);
		expect(checkComputeAuthorization(authorization, request({ workflow: "other" })).code).toBe(
			"workflow_not_allowed",
		);
		expect(
			checkComputeAuthorization(authorization, request({ readPaths: ["/data/in/../secret"] })).code,
		).toBe("remote_read_out_of_scope");
		expect(
			checkComputeAuthorization(authorization, request({ writePaths: ["/data/outside/result"] })).code,
		).toBe("remote_write_out_of_scope");
	});

	it("enforces budget boundaries and agent-code permission", () => {
		expect(checkComputeAuthorization(authorization, request({ wallMinutes: 61 })).code).toBe(
			"wall_time_exceeded",
		);
		expect(
			checkComputeAuthorization(authorization, request({ coreHours: 9 }), {
				coreHours: 2,
				activeJobs: 0,
				diskBytes: 0,
			}).code,
		).toBe("core_budget_exceeded");
		expect(
			checkComputeAuthorization(authorization, request(), { coreHours: 0, activeJobs: 2, diskBytes: 0 }).code,
		).toBe("concurrency_exceeded");
		expect(checkComputeAuthorization(authorization, request({ agentCode: true })).code).toBe(
			"agent_code_not_allowed",
		);
		expect(checkComputeAuthorization(authorization, request({ wallMinutes: Number.NaN })).allowed).toBe(
			false,
		);
		expect(
			checkComputeAuthorization({ ...authorization, workflows: ["*"] }, request({ workflow: "new-workflow" }))
				.allowed,
		).toBe(true);
	});
});
