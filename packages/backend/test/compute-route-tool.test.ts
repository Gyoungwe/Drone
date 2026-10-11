import { describe, expect, it } from "vitest";
import { makeComputeRouteTool } from "../src/tools/compute-route";

describe("compute_route tool", () => {
	it("returns a declaration-only pinned route for a bulk RNA-seq request", async () => {
		const result = await makeComputeRouteTool().execute(
			"route-1",
			{
				intent: "Run bulk RNA-seq QC",
				samplesheet: "/data/rnaseq/samplesheet.csv",
				hostAlias: "hpc-a",
				remoteWorkDir: "/data/rnaseq/runs/route-1",
				outdir: "results",
				executionMode: "production",
			},
			undefined,
			undefined,
			undefined,
		);
		const details = result.details as {
			route?: { pipeline?: string };
			plan?: Record<string, unknown>;
			preflight?: { ok?: boolean };
		};
		expect(details.route?.pipeline).toBe("nf-core/rnaseq");
		expect(details.plan).toMatchObject({ hostAlias: "hpc-a", executionMode: "production" });
		expect(details.preflight?.ok).toBe(true);
		expect(result.content[0]).toMatchObject({ type: "text" });
	});

	it("reports adjacent workflows without opening a compute effect", async () => {
		const result = await makeComputeRouteTool().execute(
			"route-2",
			{ intent: "Run differential expression from a counts matrix" },
			undefined,
			undefined,
			undefined,
		);
		const details = result.details as { preflight?: { ok?: boolean; errors?: string[] } };
		expect(details.preflight?.ok).toBe(false);
		expect(details.preflight?.errors?.join(" ")).toMatch(/supported|RNA|bulk/i);
	});
});
