import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { DiscoveryHostLoader } from "@gyoungwe/plugin-api";
import { afterAll, beforeAll, expect, it } from "vitest";
import { DiscoveryService } from "../../test/legacy-discovery-service";
import { createDiscoveryService } from "./service";

const tarball = process.env.DRONE_DISCOVERY_PLUGIN_TARBALL;
const exec = promisify(execFile);
let installedRoot: string;
let loader: DiscoveryHostLoader;

beforeAll(async () => {
	if (!tarball) return;
	installedRoot = await mkdtemp(join(tmpdir(), "discovery-plugin-parity-install-"));
	await exec("npm", [
		"install",
		"--prefix",
		installedRoot,
		"--ignore-scripts",
		"--no-audit",
		"--no-fund",
		tarball,
	]);
	const entry = join(installedRoot, "node_modules/@gyoungwe/pi-discovery/dist/host.mjs");
	loader = (await import(/* @vite-ignore */ pathToFileURL(entry).href)).discoveryHostLoader;
}, 30_000);

afterAll(async () => {
	if (installedRoot) await rm(installedRoot, { recursive: true, force: true });
});

// A candidate artifact is required. An absent artifact is explicitly skipped,
// never evidence that the installed plugin matches the host's real writer.
it.skipIf(!tarball).each(["project-default", "host-agent-dir"] as const)(
	"reads actual DiscoveryService journals from a clean-installed plugin (%s)",
	async (mode) => {
		const root = await mkdtemp(join(tmpdir(), "discovery-plugin-parity-data-"));
		const projectRoot = join(root, "project-a");
		const agentDir = mode === "host-agent-dir" ? join(root, "journal-a") : undefined;
		const journalRoot = agentDir ?? join(projectRoot, "runs", ".drone-discovery");
		const input = { projectId: "project-a", projectRoot, ...(agentDir ? { agentDir } : {}) };
		const service = new DiscoveryService({
			...input,
			authorize: async () => undefined,
			criticProvider: { providerId: "independent-fixture", review: async () => [] },
		});
		try {
			await service.runCritic({
				findingId: "finding-a",
				findingStatement: "Fixture finding",
				artifactIds: [],
				primaryProviderId: "primary-fixture",
			});
			await service.runMultipath(
				{
					id: "plan-a",
					findingId: "finding-a",
					intent: "confirmatory",
					priorRegistered: true,
					paths: Array.from({ length: 5 }, (_, index) => ({
						id: `path-${index + 1}`,
						description: "Fixture alternative",
						parameters: { threshold: index },
					})),
				},
				async () => ({
					outcome: "succeeded",
					signature: "same",
					summary: "Fixture observation",
					consistentWithReference: true,
				}),
			);
			await service.createExplorationPlan({
				id: "exploration-a",
				hypothesisId: "hypothesis-a",
				prior: { direction: "positive", confidence: 0.5, recordedAt: "2026-01-01T00:00:00.000Z" },
				budget: { maxExecutions: 2, maxWallTimeMs: 100, maxOutputBytes: 1024, maxCostUnits: 2 },
				candidates: [
					{
						id: "candidate-a",
						statement: "Fixture candidate",
						surprise: 0.5,
						estimatedCost: 1,
						expectedExplanationsExcluded: 1,
						credibility: 0.5,
					},
				],
			});
			await service.runEvaluation(
				[
					{
						id: "case-a",
						metric: "clue-hit-rate",
						datasetId: "fixture",
						datasetRevision: "1",
						datasetStatus: "fixture",
						description: "Fixture evaluation",
					},
				],
				async () => ({ value: 1 }),
				{ runId: "evaluation-a" },
			);

			const originalBytes = await readFile(join(journalRoot, "critics.json"));
			const unassigned = createDiscoveryService(
				{ ...input, agentDir: join(root, "new-project-journals"), legacyJournalRoot: journalRoot },
				loader,
			);
			expect(await unassigned.host?.status?.({})).toMatchObject({
				legacyJournal: { status: "unassigned", path: journalRoot },
			});
			expect(await unassigned.service.listCriticReviews()).toEqual([]);
			await unassigned.service.dispose();
			expect(await readFile(join(journalRoot, "critics.json"))).toEqual(originalBytes);
			const host = createDiscoveryService(input, loader).service;
			expect(await host.listCriticReviews()).toEqual(await service.listCriticReviews());
			expect(await host.listMultipathAssessments()).toEqual(await service.listMultipathAssessments());
			expect(await host.listExplorationPlans()).toEqual(await service.listExplorationPlans());
			expect(await host.listEvaluations()).toEqual(await service.listEvaluations());
			for (const file of ["critics.json", "multipath.json"])
				expect(JSON.parse(await readFile(join(journalRoot, file), "utf8"))[0]).toHaveProperty("recordedAt");
			const other = createDiscoveryService(
				{
					projectId: "project-b",
					projectRoot: join(root, "project-b"),
					...(agentDir ? { agentDir: join(root, "journal-b") } : {}),
				},
				loader,
			).service;
			expect(await other.listCriticReviews()).toEqual([]);
			expect(await other.listMultipathAssessments()).toEqual([]);
			expect(await other.listExplorationPlans()).toEqual([]);
			expect(await other.listEvaluations()).toEqual([]);
		} finally {
			service.dispose();
			await rm(root, { recursive: true, force: true });
		}
	},
);
