import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { InquiryComputeEvent, InquiryTaskTerminalEvent } from "./inquiry";
import { InquiryService } from "./inquiry";

describe("backend inquiry composition adapter", () => {
	it("stays disabled without a configured root", () => {
		const service = new InquiryService();
		expect(service.enabled).toBe(false);
		expect(service.storage).toBeUndefined();
		service.dispose();
	});

	it("instantiates the SQLite domain service only when configured", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-backend-inquiry-"));
		try {
			const service = new InquiryService({ inquiryDir: root, projectId: "project-1" });
			expect(service.enabled).toBe(true);
			expect(service.storage?.path).toBe(join(root, "ledger.sqlite"));
			expect(service.domain?.storage.projectId).toBe("project-1");
			service.dispose();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("requires an explicit project id for a configured root", () => {
		expect(() => new InquiryService({ inquiryDir: "/tmp/drone-inquiry" })).toThrow("inquiryProjectId");
	});

	it("registers terminal compute and task events through an injected source", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-backend-inquiry-events-"));
		let computeHandler: ((event: InquiryComputeEvent) => void) | undefined;
		let taskHandler: ((event: InquiryTaskTerminalEvent) => void) | undefined;
		const detachCalls: string[] = [];
		const source = {
			onComputeEvent: (handler: (event: InquiryComputeEvent) => void) => {
				computeHandler = handler;
				return () => detachCalls.push("compute");
			},
			onTaskTerminal: (handler: (event: InquiryTaskTerminalEvent) => void) => {
				taskHandler = handler;
				return () => detachCalls.push("task");
			},
		};
		const checksum = "a".repeat(64);
		try {
			const service = new InquiryService({
				inquiryDir: root,
				projectId: "project-events",
				eventSource: source,
			});
			computeHandler?.({
				id: "compute-event-1",
				jobId: "job-1",
				type: "status",
				status: "running",
				at: 1_000,
			});
			computeHandler?.({
				id: "compute-event-2",
				jobId: "job-1",
				type: "collected",
				status: "succeeded",
				at: 2_000,
				runId: "run-1",
				artifacts: [{ path: "results/report.md", bytes: 12, sha256: checksum }],
			});
			taskHandler?.({
				id: "task-event-1",
				taskId: "task-1",
				runId: "task-run-1",
				status: "failed",
				at: 3_000,
				detail: "runner failed",
			});
			await service.drainEvents();
			const snapshot = await service.readOnlySnapshot();
			expect(snapshot?.artifacts).toHaveLength(1);
			expect(snapshot?.artifacts[0]).toMatchObject({
				projectId: "project-events",
				path: "results/report.md",
				purpose: "deliverable",
				source: { kind: "run", id: "run-1" },
			});
			expect(snapshot?.attempts).toHaveLength(2);
			expect(snapshot?.attempts).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						id: "compute:run-1",
						outcome: "succeeded",
						artifactIds: [expect.any(String)],
					}),
					expect.objectContaining({ id: "task:task-run-1", outcome: "failed", artifactIds: [] }),
				]),
			);
			service.dispose();
			expect(detachCalls).toEqual(["compute", "task"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("serializes event writes and reports invalid project events", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-backend-inquiry-queue-"));
		const errors: unknown[] = [];
		try {
			const service = new InquiryService({
				inquiryDir: root,
				projectId: "project-queue",
				onEventError: (error) => errors.push(error),
			});
			const source = {
				onTaskTerminal: (handler: (event: InquiryTaskTerminalEvent) => void) => {
					handler({
						id: "bad-project",
						taskId: "task-1",
						status: "succeeded",
						at: 4_000,
						projectId: "other-project",
					});
					return () => {};
				},
			};
			service.attachEventSource(source);
			await service.drainEvents();
			expect(errors).toHaveLength(1);
			expect(String(errors[0])).toContain("another project");
			expect((await service.readOnlySnapshot())?.attempts).toHaveLength(0);
			service.dispose();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("exposes an empty read-only projection while disabled", async () => {
		const service = new InquiryService();
		expect(await service.readOnlySnapshot()).toBeUndefined();
		await service.recordComputeEvent({
			id: "ignored",
			jobId: "job",
			type: "status",
			status: "succeeded",
			at: 1,
		});
		await service.drainEvents();
		service.dispose();
	});

	it("projects provenance metadata without returning file contents", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-backend-inquiry-provenance-"));
		try {
			const service = new InquiryService({ inquiryDir: root, projectId: "project-provenance" });
			await service.recordComputeEvent({
				id: "compute-provenance",
				jobId: "job-provenance",
				type: "collected",
				status: "succeeded",
				at: 5_000,
				runId: "run-provenance",
				codeFingerprint: "code-fingerprint",
				runProvenance: { workflow: "nf-core/rnaseq", containerDigests: ["sha256:test"] },
				sessionId: "session-1",
				turn: 4,
				parameters: { seed: 7 },
				artifacts: [{ path: "results/output.tsv", bytes: 10, sha256: "a".repeat(64) }],
			});
			const artifact = (await service.listArtifacts())[0];
			expect(artifact).toBeDefined();
			const result = await service.artifactProvenance(artifact?.id ?? "");
			expect(result).toMatchObject({
				reproducibility: "reproducible",
				sourceSessionId: "session-1",
				sourceTurn: 4,
				runProvenance: { workflow: "nf-core/rnaseq" },
			});
			expect(result).not.toHaveProperty("content");
			service.dispose();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("submits reruns immediately and emits terminal status after background collection", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-backend-inquiry-rerun-"));
		try {
			const service = new InquiryService({ inquiryDir: root, projectId: "project-rerun" });
			await service.recordComputeEvent({
				id: "compute-rerun",
				jobId: "job-original",
				type: "collected",
				status: "succeeded",
				at: 5_000,
				runId: "run-original",
				codeFingerprint: "code-fingerprint",
				runProvenance: { workflow: "wf" },
				artifacts: [{ path: "results/output.tsv", bytes: 10, sha256: "a".repeat(64) }],
			});
			const source = (await service.listArtifacts())[0];
			expect(source).toBeDefined();
			const terminal = new Promise<void>((resolve) => {
				service.onRerunUpdated((result) => {
					if (result.status === "reproduced") resolve();
				});
			});
			service.setRerunHandler(async () => ({ jobId: "job-rerun" }));
			service.setRerunCompletionHandler(async (pending) => ({
				...pending.artifact,
				id: "rerun-result",
				parentIds: [pending.artifact.id],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}));
			const submitted = await service.rerunArtifact(source?.id ?? "");
			expect(submitted).toMatchObject({ status: "submitted", jobId: "job-rerun" });
			await terminal;
			expect((await service.artifactProvenance(source?.id ?? ""))?.rerun).toMatchObject({
				status: "reproduced",
			});
			service.dispose();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
