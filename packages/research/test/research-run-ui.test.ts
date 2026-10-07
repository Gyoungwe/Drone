import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getResearchRun, listResearchRuns } from "../src/research-run-ui";

describe("research run UI projection", () => {
	it("lists a run and exposes its route, sources and structured claims", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-research-ui-"));
		const run = join(root, "demo", "run-20261004-abc123");
		await mkdir(join(run, "sources"), { recursive: true });
		await writeFile(
			join(run, "metadata.json"),
			JSON.stringify({
				run_id: "run-20261004-abc123",
				project: "demo",
				result_slug: "demo",
				topic_id: "demo",
				query: "find evidence",
				status: "running",
				started_at: "2026-10-04T00:00:00.000Z",
				updated_at: "2026-10-04T00:01:00.000Z",
				evidence_gate: {
					stage: "claims_bound",
					status: "ok",
					answerable: false,
					source_refs: ["Library/Papers/a.md"],
					claim_bindings: [
						{ claim: "A claim", sources: [{ path: "Library/Papers/a.md" }] },
					],
					events: [
						{ type: "created", at: "2026-10-04T00:00:00.000Z" },
						{ type: "claims_bound", at: "2026-10-04T00:01:00.000Z" },
					],
				},
			}),
		);
		const listed = await listResearchRuns({ resultsRoot: root, project: "demo" });
		expect(listed.total).toBe(1);
		expect(listed.items[0].stage).toBe("claims_bound");
		const detail = await getResearchRun({ resultsRoot: root, runId: "run-20261004-abc123" });
		expect(detail.route.find((node: { key: string }) => node.key === "claims_bound")?.state).toBe("active");
		expect(detail.sources[0].path).toBe("Library/Papers/a.md");
		expect(detail.claims[0].claim).toBe("A claim");
	});
});
