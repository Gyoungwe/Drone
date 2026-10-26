import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBackend } from "./create-backend";
import { type KnowledgeReadProvider, KnowledgeUiService } from "./knowledge/ui";
import { createDroneRuntime } from "./runtime";
import type { DailyDiscoveryService } from "./services/daily-discovery";
import type { KnowledgeMaintenanceService } from "./services/knowledge-maintenance";

describe("createBackend", () => {
	it("assembles domain service groups outside the session port", () => {
		const services = createBackend({ projectTrust: false, permissionGates: false });
		expect(services.sessions).toBeDefined();
		expect(services.diagnostics).toBeDefined();
		expect(services.diagnostics.getDiagnostics).toBeTypeOf("function");
		expect(services.sessionEngine).toBeDefined();
		expect(services.knowledge).toBeDefined();
		expect(services.knowledge.overview).toBeTypeOf("function");
		expect(services.knowledgeSession).toBeDefined();
		expect(services.knowledgeSession.reviewWithModel).toBeTypeOf("function");
		expect(services.packages).toBeDefined();
		expect(services.settings).toBeDefined();
		expect(services.settings.listProviders).toBeTypeOf("function");
		expect(services.models).toBeDefined();
		expect(services.models.getPrefs).toBeTypeOf("function");
		expect(services.login).toBeDefined();
		expect(services.login.startLogin).toBeTypeOf("function");
		expect(services.mcp).toBeDefined();
		expect(services.permissions).toBeDefined();
		expect(services.permissions.getConfig).toBeTypeOf("function");
		expect(services.approvals).toBeDefined();
		expect(services.approvals.listPending).toBeTypeOf("function");
		expect(services.zotero).toBeDefined();
		expect(services.zotero.getStatus).toBeTypeOf("function");
		expect(services.institutional).toBeDefined();
		expect(services.institutional.testAccess).toBeTypeOf("function");
		expect(services.projectTrust).toBeDefined();
		expect(services.subagents).toBeDefined();
		expect(services.subagents.listAvailable).toBeTypeOf("function");
		expect(services.compute).toBeDefined();
		expect(services.compute.listHosts).toBeTypeOf("function");
		expect(services.analysis).toBeDefined();
		expect(services.analysisEvidence.freeze).toBeTypeOf("function");
		expect(services.analysisTasks).toBeTypeOf("function");
		services.dispose();
	});

	it("keeps an injected compute adapter on the backend boundary", () => {
		const compute = {
			listHosts: async () => [],
			getHost: async () => null,
			saveHost: async () => {
				throw new Error("unused");
			},
			removeHost: async () => {},
			probeHost: async () => {
				throw new Error("unused");
			},
			getHealthSnapshot: async () => ({ checkedAt: new Date().toISOString(), hosts: [] }),
			listJobs: async () => [],
			getJob: async () => null,
			getLogs: async (id: string) => ({
				jobId: id,
				cursor: "",
				text: "",
				truncated: false,
				at: new Date().toISOString(),
			}),
			cancelJob: async () => {},
			openTerminal: async () => {
				throw new Error("unused");
			},
			getTerminal: async () => null,
			writeTerminal: async () => {},
			closeTerminal: async () => {},
			getOnboardingStatus: async () => [],
			checkOnboardingStep: async (step: any) => ({ step, state: "not_configured", summary: "unused" }),
			authorizeRemoteOperation: async () => {},
			onHealthChanged: () => () => {},
			onJobUpdated: () => () => {},
			onLogChunk: () => () => {},
			onTerminalOutput: () => () => {},
			onTerminalClosed: () => () => {},
		};
		const services = createBackend({ compute: compute as any, projectTrust: false, permissionGates: false });
		expect(services.computeAdapter).toBe(compute);
		expect(services.runtime.compute?.adapter).toBe(compute);
		services.dispose();
	});

	it("forwards host diagnostics through the explicit service port", async () => {
		const services = createBackend({ projectTrust: false, permissionGates: false });
		const snapshot = await services.diagnostics.getDiagnostics({ version: "test" });
		expect(snapshot.version).toBe("test");
		expect(snapshot.stores).toBeInstanceOf(Array);
		services.dispose();
	});

	it("preserves an explicitly injected host runtime", () => {
		const runtime = createDroneRuntime();
		const services = createBackend({ runtime, projectTrust: false, permissionGates: false });
		expect(services.runtime).toBe(runtime);
		services.dispose();
	});

	it("supports provider factories without changing default activation", () => {
		let dailyFactoryCalled = false;
		let maintenanceFactoryCalled = false;
		let dailyStarted = false;
		let maintenanceStarted = false;
		const services = createBackend({
			projectTrust: false,
			permissionGates: false,
			dailyDiscoveryFactory: (options) => {
				dailyFactoryCalled = options.path.endsWith("daily-discovery.json");
				return {
					start: () => {
						dailyStarted = true;
					},
					dispose: () => {},
				} as unknown as DailyDiscoveryService;
			},
			knowledgeMaintenanceFactory: (options) => {
				maintenanceFactoryCalled = options.path.endsWith("knowledge-maintenance.json");
				return {
					start: () => {
						maintenanceStarted = true;
					},
					dispose: () => {},
				} as unknown as KnowledgeMaintenanceService;
			},
		});
		expect(dailyFactoryCalled).toBe(true);
		expect(maintenanceFactoryCalled).toBe(true);
		expect(dailyStarted).toBe(true);
		expect(maintenanceStarted).toBe(true);
		services.dispose();
	});

	it("accepts a knowledge provider without constructing the host adapter", () => {
		const knowledge = new KnowledgeUiService();
		let provided = false;
		const services = createBackend({
			projectTrust: false,
			permissionGates: false,
			knowledgeFactory: () => {
				provided = true;
				return knowledge;
			},
		});
		expect(provided).toBe(true);
		expect(services.knowledge).toBe(knowledge);
		services.dispose();
	});

	it("routes the complete read vertical through the injected provider", async () => {
		const calls: string[] = [];
		const provider = {
			overview: async () => {
				calls.push("overview");
				return { kind: "overview" };
			},
			search: async () => {
				calls.push("search");
				return { kind: "search" };
			},
			read: async () => {
				calls.push("read");
				return { kind: "read" };
			},
			noteLinks: async () => {
				calls.push("links");
				return { kind: "links" };
			},
			graph: async () => {
				calls.push("graph");
				return { kind: "graph" };
			},
		} as unknown as KnowledgeReadProvider;
		const service = new KnowledgeUiService(provider);
		await service.overview({});
		await service.search({ query: "q", bindingRevision: 1 });
		await service.read({ path: "note.md", revision: 1 });
		await service.noteLinks({ path: "note.md", revision: 1 });
		await service.graph({ revision: 1 });
		expect(calls).toEqual(["overview", "search", "read", "links", "graph"]);
		service.dispose();
	});

	it("uses a declared research detail adapter when the plugin provides one", async () => {
		const calls: unknown[] = [];
		const service = new KnowledgeUiService(undefined, {
			researchHostLoader: {
				contractVersion: 1,
				load: () => ({
					contractVersion: 1,
					operations: {
						listRuns: async () => ({ items: [], total: 0 }),
						status: async () => ({ items: [], total: 0 }),
						detail: async (input) => {
							calls.push(input);
							return {
								runId: "run-1",
								resultSlug: "topic",
								project: "demo",
								topicId: null,
								query: "query",
								status: "complete",
								stage: "answerable",
								answerable: true,
								startedAt: null,
								updatedAt: null,
								runDir: "topic/run-1",
								route: [{ key: "created", label: "Created", state: "complete", at: null, detail: null }],
								sources: [],
								claims: [],
								warnings: [],
								coverage: null,
								archive: { count: 0, reused: 0, verified: true },
							};
						},
					},
				}),
			},
		});

		const result = await service.researchRun({ cwd: "/tmp/research", runId: "run-1" });
		expect(result.runId).toBe("run-1");
		expect(result.route[0]?.key).toBe("created");
		expect(result.scientificallyVerified).toBe(false);
		expect(calls).toEqual([{ workspace: "/tmp/research", runDir: undefined, runId: "run-1" }]);
		service.dispose();
	});

	it("does not require the legacy worker resource when a knowledge plugin is installed", () => {
		const previousRoot = process.env.DRONE_RESEARCH_WORKBENCH_ROOT;
		process.env.DRONE_RESEARCH_WORKBENCH_ROOT = "/tmp/drone-no-legacy-knowledge-worker";
		try {
			const services = createBackend({
				projectTrust: false,
				permissionGates: false,
				knowledgeHostLoader: {
					contractVersion: 1,
					load: () => ({
						contractVersion: 1,
						overview: async () => ({}),
						search: async () => ({}),
						read: async () => ({}),
						noteLinks: async () => ({}),
						graph: async () => ({}),
					}),
				},
			});
			services.dispose();
		} finally {
			if (previousRoot === undefined) delete process.env.DRONE_RESEARCH_WORKBENCH_ROOT;
			else process.env.DRONE_RESEARCH_WORKBENCH_ROOT = previousRoot;
		}
	});

	it("routes legacy knowledge events only to the matching backend", async () => {
		const firstEvents: string[] = [];
		const secondEvents: string[] = [];
		const first = createBackend({
			defaultCwd: "/tmp/drone-runtime-first",
			dailyDiscovery: false,
			projectTrust: false,
			permissionGates: false,
			knowledgeMaintenanceFactory: () =>
				({
					notifyContentChanged: (cwd: string) => firstEvents.push(cwd),
					start: () => {},
					dispose: () => {},
				}) as unknown as KnowledgeMaintenanceService,
		});
		const second = createBackend({
			defaultCwd: "/tmp/drone-runtime-second",
			dailyDiscovery: false,
			projectTrust: false,
			permissionGates: false,
			knowledgeMaintenanceFactory: () =>
				({
					notifyContentChanged: (cwd: string) => secondEvents.push(cwd),
					start: () => {},
					dispose: () => {},
				}) as unknown as KnowledgeMaintenanceService,
		});
		const emit = (cwd: string) =>
			(process as unknown as { emit(event: string, payload: unknown): boolean }).emit(
				"drone:knowledge-deposited/v1",
				{ cwd },
			);

		emit("/tmp/drone-runtime-first");
		emit("/tmp/drone-runtime-second");
		expect(firstEvents).toEqual(["/tmp/drone-runtime-first"]);
		expect(secondEvents).toEqual(["/tmp/drone-runtime-second"]);
		await first.dispose();
		await second.dispose();
	});

	it("composes a declared analysis/evidence host into the durable service", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-analysis-host-"));
		const services = createBackend({
			analysisAgentDir: root,
			projectTrust: false,
			permissionGates: false,
			analysisEvidenceHost: {
				manifest: { tools: ["analysis_prepare_evidence", "evidence_validate_manifest"] },
				tools: {
					analysis_prepare_evidence: {
						execute: () => ({ execution: "host-required", planVersion: 1 }),
					},
					evidence_validate_manifest: {
						execute: () => ({ valid: true }),
					},
				},
			},
		});
		try {
			await services.analysis.create({
				id: "analysis-host-test",
				question: "q",
				assay: "a",
				mode: "exploratory",
			});
			await expect(
				services.analysisEvidence.prepareEvidence({
					analysisId: "analysis-host-test",
					manifest: { entries: [] },
				}),
			).resolves.toMatchObject({
				status: "ready",
				plan: { execution: "host-required" },
				validation: { valid: true },
			});
		} finally {
			await services.dispose();
			await rm(root, { recursive: true, force: true });
		}
	});
});
