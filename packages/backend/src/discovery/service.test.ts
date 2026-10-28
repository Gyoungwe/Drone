import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { SubprocessFixtureRunner } from "@drone/discovery";
import { InquiryService, MemoryInquiryStorage } from "@drone/inquiry";
import type { DiscoveryHostLoader } from "@gyoungwe/plugin-api";
import {
	buildContainerSandboxArgv as buildContainerKernelArgv,
	detectContainerRuntime,
} from "@gyoungwe/plugin-api/node/execution";
import { PluginResourceReservations } from "@gyoungwe/plugin-api/node/reservations";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { StorageRegistry } from "../storage/registry";
import { createDiscoveryService, type DiscoveryServiceOptions } from "./service";

const tarball = process.env.DRONE_DISCOVERY_PLUGIN_TARBALL;
let loader: DiscoveryHostLoader;
let installedRoot: string;
beforeAll(async () => {
	if (!tarball) return;
	const api = process.env.DRONE_PLUGIN_API_TARBALL;
	if (!api) throw new Error("Discovery candidate requires explicit DRONE_PLUGIN_API_TARBALL");
	installedRoot = await mkdtemp(join(tmpdir(), "discovery-service-install-"));
	await promisify(execFile)("npm", [
		"install",
		"--prefix",
		installedRoot,
		"--ignore-scripts",
		"--no-audit",
		"--no-fund",
		tarball,
		api,
	]);
	loader = (
		await import(
			/* @vite-ignore */ pathToFileURL(
				join(installedRoot, "node_modules/@gyoungwe/pi-discovery/dist/host.mjs"),
			).href
		)
	).discoveryHostLoader;
}, 30_000);
afterAll(async () => {
	if (installedRoot) await rm(installedRoot, { recursive: true, force: true });
});
const installedService = (options: DiscoveryServiceOptions) =>
	createDiscoveryService(
		options,
		loader,
		new PluginResourceReservations(join(options.projectRoot, ".test-leases")),
	).service;

const allow = async () => {};

describe("DiscoveryService composition root", () => {
	it("builds a bounded, network-disabled container argv with runs as the only writable mount", () => {
		const argv = buildContainerKernelArgv(
			{
				requestId: "request-1",
				language: "python",
				code: "print(1)",
				runDirectory: "runs/task/run",
				timeoutMs: 1000,
				maxOutputBytes: 1024,
				dataClassification: "public",
			},
			"/project/runs/task/run",
			{ projectRoot: "/project", maxPids: 32, memoryBytes: 1024, cpus: 1, tmpfsBytes: 2048 },
		);
		expect(argv).toContain("--network");
		expect(argv).toContain("none");
		expect(argv).toContain("--read-only");
		expect(argv.join(" ")).toContain("type=bind,src=/project/runs/task/run,dst=/workspace/runs");
		expect(argv).toContain("python");
	});

	it.skipIf(!tarball)(
		"executes the explicit subprocess fixture, persists the session, and exports under runs",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "drone-discovery-service-"));
			try {
				const service = installedService({
					projectId: "project-1",
					projectRoot: root,
					authorize: allow,
					runner: new SubprocessFixtureRunner(),
				});
				const created = await service.createKernelSession({
					sessionId: "session-1",
					runDirectory: "runs/task-1/run-1",
					language: "python",
					dataClassification: "public",
					maxExecutions: 2,
				});
				expect(created.status).toBe("ready");
				const execution = await service.executeKernel("session-1", 'print("service-ok")');
				expect(execution.status).toBe("succeeded");
				expect(execution.output).toContain("service-ok");
				const exported = await service.exportKernel("session-1");
				expect(exported.scriptPath).toBe("runs/task-1/run-1/exports/session-1.py");
				const reopened = installedService({
					projectId: "project-1",
					projectRoot: root,
					authorize: allow,
					runner: new SubprocessFixtureRunner(),
				});
				expect((await reopened.getKernelSession("session-1"))?.executionCount).toBe(1);
				await service.dispose();
				await reopened.dispose();
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		},
	);

	it.skipIf(!tarball)(
		"fails closed when no container runtime is present and never falls back to host Python",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "drone-discovery-no-runtime-"));
			try {
				const process = async () => ({ exitCode: 127, stdout: "", stderr: "not found" });
				expect(await detectContainerRuntime(undefined, process)).toBeUndefined();
				const service = installedService({
					projectId: "project-1",
					projectRoot: root,
					authorize: allow,
					container: { process },
				});
				const session = await service.createKernelSession({
					sessionId: "session-1",
					runDirectory: "runs/task/run",
					language: "python",
					dataClassification: "public",
				});
				expect(session.status).toBe("needs-container");
				await expect(service.executeKernel("session-1", "print(1)")).rejects.toThrow("needs-container");
				await service.dispose();
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		},
	);

	it.skipIf(!tarball)(
		"requires authorization for code execution and records independent critic questions",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "drone-discovery-auth-"));
			try {
				let authorized = false;
				const storage = new MemoryInquiryStorage("project-1");
				const inquiry = new InquiryService(storage);
				const service = installedService({
					projectId: "project-1",
					projectRoot: root,
					authorize: async () => {
						if (!authorized) throw new Error("authorization required");
					},
					runner: new SubprocessFixtureRunner(),
					inquiry,
					criticProvider: {
						providerId: "independent",
						review: async () => [
							{
								checklistItem: "batch-effect",
								question: "Could batch explain this?",
								severity: "high",
								evidenceArtifactIds: [],
							},
						],
					},
				});
				await expect(
					service.createKernelSession({
						sessionId: "session-1",
						runDirectory: "runs/task/run",
						language: "python",
						dataClassification: "public",
					}),
				).rejects.toThrow("authorization");
				authorized = true;
				await service.createKernelSession({
					sessionId: "session-1",
					runDirectory: "runs/task/run",
					language: "python",
					dataClassification: "public",
				});
				const review = await service.runCritic({
					findingId: "finding-1",
					findingStatement: "A stated effect needs review.",
					artifactIds: [],
					primaryProviderId: "primary",
				});
				expect(review.status).toBe("complete");
				expect((await service.listCriticReviews())[0]?.findingId).toBe("finding-1");
				const snapshot = await inquiry.readOnlyState();
				expect(snapshot.questions.some((question) => question.id === "critic:finding-1:1")).toBe(true);
				await service.dispose();
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		},
	);
	it("does not create stores or probe a runner without a discovery package", async () => {
		const runnerFactory = vi.fn();
		const storage = { register: vi.fn(), get: vi.fn() };
		const { service } = createDiscoveryService({
			projectId: "no-plugin",
			projectRoot: "/tmp/no-discovery",
			runnerFactory,
			storage: storage as unknown as DiscoveryServiceOptions["storage"],
		});
		await service.init();
		await expect(service.listCriticReviews()).rejects.toThrow("Discovery operation is unavailable");
		await expect(service.getCapabilities("python")).rejects.toThrow("Discovery operation is unavailable");
		expect(runnerFactory).not.toHaveBeenCalled();
		expect(storage.register).not.toHaveBeenCalled();
		await service.dispose();
	});

	it.skipIf(!tarball)("retains the legacy writer lease when actual kernel cleanup fails", async () => {
		const root = await mkdtemp(join(tmpdir(), "discovery-legacy-failed-close-"));
		const options = {
			projectId: "cleanup-project",
			projectRoot: root,
			authorize: allow,
			runner: {
				capabilities: {
					kind: "fixture" as const,
					languages: ["python" as const],
					networkDisabled: true,
					writesOnlyToRunDirectory: true,
				},
				run: async () => {
					throw Object.assign(new Error("synthetic cleanup could not be verified"), {
						code: "DISCOVERY_CLEANUP_FAILED",
					});
				},
			},
		};
		const service = installedService(options),
			other = installedService(options);
		try {
			await service.createKernelSession({
				sessionId: "cleanup-session",
				runDirectory: "runs/cleanup",
				language: "python",
				dataClassification: "public",
			});
			await expect(service.executeKernel("cleanup-session", "print(1)")).rejects.toThrow(
				"cleanup could not be verified",
			);
			await expect(service.dispose()).rejects.toThrow("cleanup failed");
			await expect(
				other.createExplorationPlan({
					id: "other",
					hypothesisId: "other",
					prior: { direction: "unknown", recordedAt: "2026-10-28T00:00:00.000Z" },
					budget: { maxExecutions: 1, maxWallTimeMs: 100, maxOutputBytes: 100, maxCostUnits: 1 },
					candidates: [],
				}),
			).rejects.toThrow("already reserved");
		} finally {
			await Promise.allSettled([service.dispose(), other.dispose()]);
			await rm(root, { recursive: true, force: true });
		}
	});

	it.skipIf(!tarball)(
		"keeps unauthorized and escaped paths untouched, then closes and persists kernel lifecycle",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "discovery-service-boundary-"));
			let allowed = false;
			const runner = new SubprocessFixtureRunner();
			const receipts: unknown[] = [];
			const options = {
				projectId: "project-1",
				projectRoot: root,
				runner,
				authorize: async () => {
					if (!allowed) throw new Error("denied");
				},
				onExecution: (receipt: unknown) => {
					receipts.push(receipt);
				},
			};
			const service = installedService(options);
			try {
				const input = {
					sessionId: "boundary-session",
					language: "python" as const,
					dataClassification: "public" as const,
					runDirectory: "runs/task/run",
				};
				await expect(service.createKernelSession(input)).rejects.toThrow("denied");
				await expect(readFile(join(root, "runs/.drone-discovery/sessions.json"))).rejects.toMatchObject({
					code: "ENOENT",
				});
				allowed = true;
				await expect(service.createKernelSession({ ...input, runDirectory: "../escaped" })).rejects.toThrow(
					"runs",
				);
				await mkdir(join(root, "runs"));
				await symlink(tmpdir(), join(root, "runs/escape"));
				await expect(
					service.createKernelSession({ ...input, runDirectory: "runs/escape/private" }),
				).rejects.toThrow("symlink");
				await service.createKernelSession(input);
				await service.executeKernel(input.sessionId, 'print("receipt")');
				expect(receipts).toHaveLength(1);
				await service.dispose();
				await expect(service.executeKernel(input.sessionId, "print(1)")).rejects.toThrow("disposed");
				const reopened = installedService(options);
				expect(await reopened.getKernelSession(input.sessionId)).toMatchObject({
					status: "closed",
					executionCount: 1,
					remainingExecutions: 0,
				});
				await reopened.dispose();
			} finally {
				await service.dispose();
				await rm(root, { recursive: true, force: true });
			}
		},
	);
	it.skipIf(!tarball)(
		"registers the actual plugin journal roots and keeps the container runner lazy",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "discovery-journal-registry-"));
			const storage = new StorageRegistry();
			const runnerFactory = vi.fn(async () => new SubprocessFixtureRunner());
			const service = installedService({
				projectId: "project-1",
				projectRoot: root,
				agentDir: join(root, "authorized-journal"),
				storage,
				runnerFactory,
			});
			try {
				const entries = storage.list();
				expect(entries).toHaveLength(7);
				for (const name of ["sessions", "critics", "multipath", "plans", "evaluations", "baselines"])
					expect(entries.find((entry) => entry.owner === `discovery/${name}`)?.path).toBe(
						join(root, "authorized-journal", `${name}.json`),
					);
				expect(await service.listCriticReviews()).toEqual([]);
				expect(runnerFactory).not.toHaveBeenCalled();
				await service.getCapabilities("python");
				expect(runnerFactory).toHaveBeenCalledWith("python");
			} finally {
				await service.dispose();
				await rm(root, { recursive: true, force: true });
			}
		},
	);
	it.skipIf(!tarball)(
		"uses path-derived storage IDs for multiple projects sharing one registry",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "discovery-multiple-projects-"));
			const storage = new StorageRegistry();
			const aOptions = {
				projectId: "project-a",
				projectRoot: join(root, "a"),
				agentDir: join(root, "journals-a"),
				storage,
			};
			const bOptions = {
				projectId: "project-b",
				projectRoot: join(root, "b"),
				agentDir: join(root, "journals-b"),
				storage,
			};
			const a = installedService(aOptions);
			const b = installedService(bOptions);
			const reopenedA = installedService(aOptions);
			try {
				const entries = storage.list();
				expect(entries).toHaveLength(14);
				expect(new Set(entries.map((entry) => entry.id)).size).toBe(14);
				const input = {
					id: "plan-a",
					hypothesisId: "hypothesis-a",
					prior: { direction: "positive" as const, recordedAt: "2026-01-01T00:00:00.000Z" },
					budget: { maxExecutions: 2, maxWallTimeMs: 100, maxOutputBytes: 1024, maxCostUnits: 2 },
					candidates: [],
				};
				await a.createExplorationPlan(input);
				expect((await reopenedA.listExplorationPlans())[0]?.id).toBe("plan-a");
				expect(await b.listExplorationPlans()).toEqual([]);
			} finally {
				await a.dispose();
				await b.dispose();
				await reopenedA.dispose();
				await rm(root, { recursive: true, force: true });
			}
		},
	);
});
