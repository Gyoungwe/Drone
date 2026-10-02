import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
	ArtifactExpectationSchema,
	ComputeHostProfileSchema,
	JobSpecSchema,
	WorkflowSpecSchema,
} from "../compute";
import { ComputeContract } from "./compute";
import { channelOf } from "./define";

const host = {
	id: "slurm-a",
	alias: "slurm-a",
	displayName: "Cluster A",
	kind: "scheduler",
	endpoint: "ssh://cluster-a",
	authState: "ready",
	managed: true,
	health: { status: "healthy", checkedAt: "2026-10-03T00:00:00.000Z" },
	capabilities: [],
	createdAt: "2026-10-03T00:00:00.000Z",
	updatedAt: "2026-10-03T00:00:00.000Z",
} as const;

describe("ComputeContract", () => {
	it("keeps stable desktop channels and access labels", () => {
		expect(channelOf(ComputeContract, "listHosts")).toBe("compute:listHosts");
		expect(channelOf(ComputeContract, "healthChanged")).toBe("compute:healthChanged");
		expect(ComputeContract.methods.getHealthSnapshot.access).toBe("desktop");
		expect(ComputeContract.methods.openTerminal.access).toBe("desktop");
	});

	it("validates host, terminal and event projections", () => {
		expect(Check(ComputeContract.methods.listHosts.args, [])).toBe(true);
		expect(Check(ComputeContract.methods.listHosts.result, [host])).toBe(true);
		expect(Check(ComputeContract.methods.listHosts.result, [{ ...host, health: { status: "bad" } }])).toBe(
			false,
		);
		expect(Check(ComputeContract.methods.openTerminal.args, [{ hostId: "slurm-a", mode: "shell" }])).toBe(
			true,
		);
		expect(Check(ComputeContract.methods.openTerminal.args, [{ hostId: "slurm-a", mode: "exec" }])).toBe(
			false,
		);
		expect(Check(ComputeContract.events.terminalClosed, { terminalId: "term-1" })).toBe(true);
	});

	it("keeps runner profiles and workflow specs credential-free", () => {
		expect(Check(ComputeHostProfileSchema, { alias: "hpc-a", host: "hpc.example", username: "alice" })).toBe(
			true,
		);
		expect(Check(ComputeHostProfileSchema, { alias: "hpc-a", host: "hpc.example", password: "secret" })).toBe(
			false,
		);
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
