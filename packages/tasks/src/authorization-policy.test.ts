import { describe, expect, it } from "vitest";
import { buildAuthorizationDetails } from "./authorization-policy";

const base = { goal: "run workflow", writeRoots: [], milestones: [] };

describe("compute authorization card", () => {
	it("includes the approved host and budget", () => {
		const details = buildAuthorizationDetails(
			{
				...base,
				compute: {
					hosts: ["slurm-a"],
					remoteRead: ["/data/in"],
					remoteWrite: ["/data/out"],
					workflows: ["rnaseq"],
					budget: { maxCoreHours: 10, maxWalltimeMinutes: 60, maxConcurrentJobs: 2, maxDiskGb: 20 },
				},
			},
			null,
			null,
		);
		expect(details).toContain("slurm-a");
		expect(details).toContain("60");
	});

	it("does not throw for a malformed legacy compute block", () => {
		expect(() =>
			buildAuthorizationDetails({ ...base, compute: { hosts: null } as unknown as never }, null, null),
		).not.toThrow();
	});
});
