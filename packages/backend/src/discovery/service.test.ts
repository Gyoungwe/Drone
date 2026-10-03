import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SubprocessFixtureRunner } from "@drone/discovery";
import { InquiryService, MemoryInquiryStorage } from "@drone/inquiry";
import { describe, expect, it } from "vitest";
import { buildContainerKernelArgv, detectContainerRuntime } from "./container-runner";
import { DiscoveryService } from "./service";

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
		expect(argv.join(" ")).toContain("type=bind,src=/project/runs/task/run,dst=/workspace/runs,rw");
		expect(argv).toContain("python");
	});

	it("executes the explicit subprocess fixture, persists the session, and exports under runs", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-discovery-service-"));
		try {
			const service = new DiscoveryService({
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
			const reopened = new DiscoveryService({
				projectId: "project-1",
				projectRoot: root,
				authorize: allow,
				runner: new SubprocessFixtureRunner(),
			});
			expect((await reopened.getKernelSession("session-1"))?.executionCount).toBe(1);
			service.dispose();
			reopened.dispose();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("fails closed when no container runtime is present and never falls back to host Python", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-discovery-no-runtime-"));
		try {
			const process = async () => ({ exitCode: 127, stdout: "", stderr: "not found" });
			expect(await detectContainerRuntime(undefined, process)).toBeUndefined();
			const service = new DiscoveryService({
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
			service.dispose();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("requires authorization for code execution and records independent critic questions", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-discovery-auth-"));
		try {
			let authorized = false;
			const storage = new MemoryInquiryStorage("project-1");
			const inquiry = new InquiryService(storage);
			const service = new DiscoveryService({
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
			service.dispose();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
