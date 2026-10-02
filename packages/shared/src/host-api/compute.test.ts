import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
	ArtifactExpectationSchema,
	ComputeContract,
	ComputeHostSchema,
	JobSpecSchema,
	WorkflowSpecSchema,
} from "./compute";
import { channelOf } from "./define";

describe("ComputeContract", () => {
	it("exposes stable channels and read-only LAN methods", () => {
		expect(channelOf(ComputeContract, "listHosts")).toBe("compute:listHosts");
		expect(channelOf(ComputeContract, "listJobs")).toBe("compute:listJobs");
		expect(ComputeContract.methods.listJobs.access).toBe("lan-read");
		expect(ComputeContract.methods.listWorkflowModules.access).toBe("lan-read");
		expect(ComputeContract.methods.cancelJob.access).toBe("desktop");
	});

	it("rejects credentials and arbitrary command payloads", () => {
		expect(
			Check(ComputeHostSchema, {
				alias: "hpc-a",
				host: "hpc.example",
				username: "alice",
			}),
		).toBe(true);
		expect(Check(ComputeHostSchema, { alias: "hpc-a", host: "hpc.example", password: "secret" })).toBe(false);
		expect(
			Check(WorkflowSpecSchema, {
				version: 1,
				modules: [],
				steps: [],
				command: "rm -rf /",
			}),
		).toBe(false);
		expect(
			Check(JobSpecSchema, {
				hostAlias: "hpc-a",
				workflow: { name: "registered", version: "1.0.0" },
				outputs: [{ path: "report.tsv", maxBytes: 1024 }],
			}),
		).toBe(true);
		expect(Check(ArtifactExpectationSchema, { path: "report.tsv", sha256: "bad" })).toBe(false);
	});
});
