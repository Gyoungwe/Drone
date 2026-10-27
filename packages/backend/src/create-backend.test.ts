import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KnowledgeUiEvent } from "@drone/shared";
import { describe, expect, it } from "vitest";
import { createBackend } from "./create-backend";
import { type KnowledgeReadProvider, KnowledgeUiService } from "./knowledge/ui";
import { createDroneRuntime } from "./runtime";
import type { DailyDiscoveryService } from "./services/daily-discovery";
import type { KnowledgeMaintenanceService } from "./services/knowledge-maintenance";

describe("createBackend", () => {
	it("fails closed for knowledge operations when no knowledge plugin is installed", async () => {
		const services = createBackend({ projectTrust: false, permissionGates: false });
		await expect(services.knowledge.overview({ cwd: "/tmp/no-knowledge-plugin" })).rejects.toThrow(
			"Knowledge overview is unavailable: install the knowledge plugin",
		);
		await services.dispose();
	});

	it("exposes the workbench operation port through the host runtime and fails closed without handlers", async () => {
		const unavailable = createBackend({ projectTrust: false, permissionGates: false });
		await expect(unavailable.workbench.client.invoke("status", {})).rejects.toThrow(
			"Workbench operation unavailable: status",
		);
		await expect(unavailable.sessions.workbench.client.invoke("persist", {})).rejects.toThrow(
			"Workbench operation unavailable: persist",
		);
		await unavailable.dispose();

		const calls: string[] = [];
		const services = createBackend({
			projectTrust: false,
			permissionGates: false,
			workbench: {
				status: () => {
					calls.push("status");
					return { state: "idle" };
				},
				plan: ({ items }) => {
					calls.push(`plan:${items.join(",")}`);
					return { accepted: items.length };
				},
			},
		});
		expect(services.runtime.tasks.workbench).toMatchObject({ version: 1 });
		expect((services.runtime.tasks.workbench as { client: unknown }).client).toBe(services.workbench.client);
		expect(services.sessions.workbench.client).toBe(services.workbench.client);
		await expect(services.workbench.client.invoke("status", {})).resolves.toEqual({ state: "idle" });
		await expect(services.workbench.client.invoke("plan", { items: ["read", "record"] })).resolves.toEqual({
			accepted: 2,
		});
		expect(calls).toEqual(["status", "plan:read,record"]);
		await services.dispose();
	});

	it("rejects malformed workbench operation input before invoking a host handler", async () => {
		let called = false;
		const services = createBackend({
			projectTrust: false,
			permissionGates: false,
			workbench: {
				plan: () => {
					called = true;
					return null;
				},
			},
		});
		await expect(services.workbench.client.invoke("plan", { items: [1] })).rejects.toThrow(
			"Workbench operation unavailable: plan",
		);
		expect(called).toBe(false);
		await services.dispose();
	});

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

	it("reports analysis as unavailable until an analysis plugin is discovered", () => {
		const services = createBackend({ projectTrust: false, permissionGates: false });
		expect(services.domainCapabilities.get("analysis")).toEqual({
			id: "analysis",
			status: "unavailable",
			provider: "none",
			reason: "Install an analysis plugin to enable analysis workflows",
		});
		services.dispose();
	});

	it("fails closed for research when no plugin host is installed", async () => {
		const services = createBackend({ projectTrust: false, permissionGates: false });
		expect(await services.research.listConnectors()).toEqual([]);
		expect(services.researchWrites.listAdapters()).toEqual([]);
		const response = await services.research.search({ query: "no-plugin" });
		expect(response).toMatchObject({ query: "no-plugin", hits: [], connectors: [], complete: false });
		expect(response.failures).toEqual([
			expect.objectContaining({
				connectorId: "research",
				message: "Research connector plugin is unavailable",
				retryable: false,
			}),
		]);
		const radar = await services.research.recommend("no-plugin");
		expect(radar).toMatchObject({
			query: "no-plugin",
			connectors: ["semantic-scholar"],
			complete: false,
		});
		expect(radar.failures[0]).toMatchObject({
			connectorId: "semantic-scholar",
			message: "Research connector plugin is unavailable",
		});
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

	it("routes research write adapters through the host-owned registry factory", () => {
		let factoryCalled = false;
		const registry = {
			descriptors: () => [
				{
					id: "test-write",
					label: "Test write",
					enabled: true,
					writeEnabled: false,
					requiresExplicitApproval: true as const,
				},
			],
			get: () => undefined,
		};
		const services = createBackend({
			projectTrust: false,
			permissionGates: false,
			researchWriteAdapterRegistry: () => {
				factoryCalled = true;
				return registry;
			},
		});
		expect(factoryCalled).toBe(true);
		expect(services.researchWrites.listAdapters()).toEqual(registry.descriptors());
		services.dispose();
	});

	it("routes research connector lookup through the host-owned registry factory", async () => {
		let factoryCalled = false;
		const registry = {
			list: () => [],
			recommend: async () => ({ hits: [], failures: [] }),
			search: async (input: { query: string }) => ({
				query: input.query,
				hits: [],
				failures: [],
				connectors: [],
				complete: true,
			}),
		};
		const services = createBackend({
			projectTrust: false,
			permissionGates: false,
			researchConnectorRegistry: () => {
				factoryCalled = true;
				return registry;
			},
		});
		expect(factoryCalled).toBe(true);
		expect(await services.research.listConnectors()).toEqual([]);
		services.dispose();
	});

	it("injects host-owned research connector transports and keeps an explicit registry first", async () => {
		let factoryCalled = false;
		let fetchInjected: typeof fetch | undefined;
		let projectStorageInjected: unknown;
		const loader = {
			contractVersion: 1 as const,
			load: () => ({
				contractVersion: 1 as const,
				status: "ready" as const,
				list: () => [],
				recommend: async () => ({ hits: [], failures: [] }),
				search: async (input: { query: string }) => ({
					query: input.query,
					hits: [],
					failures: [],
					connectors: [],
					complete: true,
				}),
			}),
		};
		const services = createBackend({
			projectTrust: false,
			permissionGates: false,
			researchConnectorHostLoaderFactory: (options) => {
				factoryCalled = true;
				fetchInjected = options.fetchImpl;
				projectStorageInjected = options.projectStorage;
				return loader;
			},
		});
		expect(factoryCalled).toBe(true);
		expect(fetchInjected).toBe(globalThis.fetch);
		expect(projectStorageInjected).toMatchObject({ search: expect.any(Function) });
		expect(await services.research.listConnectors()).toEqual([]);
		services.dispose();

		factoryCalled = false;
		const explicit = createBackend({
			projectTrust: false,
			permissionGates: false,
			researchConnectorRegistry: () => ({
				list: () => [],
				recommend: async () => ({ hits: [], failures: [] }),
				search: async (input: { query: string }) => ({
					query: input.query,
					hits: [],
					failures: [],
					connectors: [],
					complete: true,
				}),
			}),
			researchConnectorHostLoaderFactory: () => {
				factoryCalled = true;
				return loader;
			},
		});
		expect(factoryCalled).toBe(false);
		expect(await explicit.research.listConnectors()).toEqual([]);
		explicit.dispose();
	});

	it("exposes an isolated task acceptance host bound to the backend runtime", () => {
		const services = createBackend({ projectTrust: false, permissionGates: false });
		services.taskHost.registerAcceptanceVerifier("test_acceptance", {
			fields: ["doi"],
			label: () => "test",
		});
		expect(services.taskHost.contractVersion).toBe(1);
		expect(services.taskHost.readAcceptanceVerifier("test_acceptance")).toMatchObject({
			kind: "test_acceptance",
			fields: ["doi"],
		});
		expect(services.taskHost.readAcceptanceVerifier("missing")).toBeNull();
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

	it("reports semantic UI as unavailable when the knowledge plugin is absent", async () => {
		const service = new KnowledgeUiService();
		await expect(service.semanticStatus(undefined)).rejects.toThrow(
			"Knowledge semantic UI is unavailable: install the knowledge plugin",
		);
		await expect(service.saveSemanticSettings({} as never)).rejects.toThrow(
			"Knowledge semantic UI is unavailable",
		);
		await expect(service.testSemanticProvider({} as never)).rejects.toThrow(
			"Knowledge semantic UI is unavailable",
		);
		await expect(service.indexSemantic({} as never)).rejects.toThrow("Knowledge semantic UI is unavailable");
		await expect(service.cancelSemanticIndex({} as never)).rejects.toThrow(
			"Knowledge semantic UI is unavailable",
		);
		service.dispose();
	});

	it("routes every semantic UI operation through the installed knowledge host", async () => {
		const calls: string[] = [];
		const service = new KnowledgeUiService(undefined, {
			knowledgeHost: {
				semantic: {
					status: async () => {
						calls.push("status");
						return {} as never;
					},
					saveSettings: async () => {
						calls.push("save");
						return {} as never;
					},
					testProvider: async () => {
						calls.push("test");
						return {} as never;
					},
					index: async () => {
						calls.push("index");
						return {} as never;
					},
					cancelIndex: async () => {
						calls.push("cancel");
					},
				},
			},
		});
		await service.semanticStatus(undefined);
		await service.saveSemanticSettings({} as never);
		await service.testSemanticProvider({} as never);
		await service.indexSemantic({} as never);
		await service.cancelSemanticIndex({} as never);
		expect(calls).toEqual(["status", "save", "test", "index", "cancel"]);
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

	it("routes knowledge review operations through the installed host when declared", async () => {
		const calls: string[] = [];
		const service = new KnowledgeUiService(
			{
				overview: async () => ({}),
				search: async () => ({}),
				read: async () => ({}),
				noteLinks: async () => ({}),
				graph: async () => ({}),
			} as unknown as KnowledgeReadProvider,
			{
				knowledgeHost: {
					reviews: async () => {
						calls.push("reviews");
						return { items: [], total: 0 };
					},
					preview: async () => {
						calls.push("preview");
						return { id: "candidate" };
					},
					decide: async () => {
						calls.push("decide");
						return { status: "rejected" };
					},
				},
			},
		);

		await service.reviews({ revision: 1, offset: 0, limit: 10 });
		await service.preview({ cwd: "/tmp/project", id: "candidate", revision: 1 });
		await service.decide({
			cwd: "/tmp/project",
			token: "review-token",
			decision: "reject",
		});
		expect(calls).toEqual(["reviews", "preview", "decide"]);
		service.dispose();
	});

	it("routes migrated jobs and maintenance operations through the installed host", async () => {
		const calls: string[] = [];
		const service = new KnowledgeUiService(undefined, {
			knowledgeHost: {
				jobs: async () => {
					calls.push("jobs");
					return { items: [], total: 0 };
				},
				maintenance: async () => {
					calls.push("maintenance");
					return { status: "complete" };
				},
			},
		});

		await service.jobs({ cwd: "/tmp/project", offset: 0, limit: 10, revision: 1 });
		await service.maintain({ cwd: "/tmp/project", action: "reconcile", revision: 1 });
		expect(calls).toEqual(["jobs", "maintenance"]);
		service.dispose();
	});

	it("routes knowledge setup, specialist settings, and target operations through the installed host", async () => {
		const calls: string[] = [];
		const service = new KnowledgeUiService(undefined, {
			knowledgeHost: {
				setupPreview: async () => {
					calls.push("setupPreview");
					return { status: "preview" };
				},
				specialistSettings: async () => {
					calls.push("specialistSettings");
					return { status: "saved" };
				},
				openTarget: async () => {
					calls.push("openTarget");
					return { path: "note.md", kind: "note" };
				},
			},
		});

		await service.setupPreview({ cwd: "/tmp/project", path: null });
		await service.specialistSettings({ cwd: "/tmp/project", settings: {} } as never);
		await service.openTarget({ cwd: "/tmp/project", path: "note.md", revision: 1 });
		expect(calls).toEqual(["setupPreview", "specialistSettings", "openTarget"]);
		service.dispose();
	});

	it("routes UI events and model review through the installed host", async () => {
		const previousDir = process.env.DRONE_KNOWLEDGE_DIR;
		process.env.DRONE_KNOWLEDGE_DIR = "/tmp/drone-knowledge-ui-host";
		const events: KnowledgeUiEvent[] = [];
		let subscribed: ((event: KnowledgeUiEvent) => void) | undefined;
		const notifications: string[] = [];
		try {
			const service = new KnowledgeUiService(undefined, {
				knowledgeHost: {
					uiState: {
						subscribe: (listener) => {
							subscribed = listener;
							return () => {
								subscribed = undefined;
							};
						},
						notify: (text) => notifications.push(text),
					},
					reviewWikiWithModel: async () => ({ verdict: "accepted" }),
				},
			});
			service.subscribe((event) => events.push(event));
			await service.connect();
			subscribed?.({ kind: "invalidate" });
			await service.notify("host notice", "warning", "session-1");
			const review = await service.reviewWithModel({} as never, {});
			expect(events).toEqual([{ kind: "invalidate" }]);
			expect(notifications).toEqual(["host notice"]);
			expect(review).toEqual({ verdict: "accepted" });
			service.dispose();
		} finally {
			if (previousDir === undefined) delete process.env.DRONE_KNOWLEDGE_DIR;
			else process.env.DRONE_KNOWLEDGE_DIR = previousDir;
		}
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

	it("does not bootstrap a legacy worker without a knowledge plugin", () => {
		const previousRoot = process.env.DRONE_RESEARCH_WORKBENCH_ROOT;
		process.env.DRONE_RESEARCH_WORKBENCH_ROOT = "/tmp/drone-no-legacy-knowledge-worker";
		try {
			const services = createBackend({ projectTrust: false, permissionGates: false });
			services.dispose();
		} finally {
			if (previousRoot === undefined) delete process.env.DRONE_RESEARCH_WORKBENCH_ROOT;
			else process.env.DRONE_RESEARCH_WORKBENCH_ROOT = previousRoot;
		}
	});

	it("passes the verified worker seam to an installed knowledge loader", () => {
		const previousRoot = process.env.DRONE_RESEARCH_WORKBENCH_ROOT;
		process.env.DRONE_RESEARCH_WORKBENCH_ROOT = "/tmp/drone-no-legacy-knowledge-worker";
		let workerSetup: { createWorker: unknown; workerMetadata?: unknown } | undefined;
		try {
			const services = createBackend({
				projectTrust: false,
				permissionGates: false,
				knowledgeHostLoader: {
					contractVersion: 1,
					configureWorker: (setup) => {
						workerSetup = setup;
					},
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
			expect(typeof workerSetup?.createWorker).toBe("function");
			expect(typeof workerSetup?.workerMetadata).toBe("function");
			services.dispose();
		} finally {
			if (previousRoot === undefined) delete process.env.DRONE_RESEARCH_WORKBENCH_ROOT;
			else process.env.DRONE_RESEARCH_WORKBENCH_ROOT = previousRoot;
		}
	});

	it("injects child publication registration through the installed knowledge host", () => {
		const registerAnswerPublication = () => ({ begin: () => undefined });
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
					registerAnswerPublication,
				}),
			},
		});
		expect(services.runtime.knowledge.registerAnswerPublication).toBe(registerAnswerPublication);
		services.dispose();
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
