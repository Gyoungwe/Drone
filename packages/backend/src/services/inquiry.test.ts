import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDefaultStorageRegistry } from "../storage/registry";
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
		let decisionHandler:
			| ((event: { id: string; kind: "workflow-repair"; summary: string }) => void)
			| undefined;
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
			onDecision: (handler: typeof decisionHandler) => {
				decisionHandler = handler;
				return () => detachCalls.push("decision");
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
			decisionHandler?.({ id: "repair-1", kind: "workflow-repair", summary: "Adjusted workflow" });
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
			expect(snapshot?.decisions).toMatchObject([
				expect.objectContaining({ id: "repair-1", kind: "workflow-repair" }),
			]);
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
			expect(detachCalls).toEqual(["compute", "task", "decision"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("records local execution provenance without source or output contents", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-backend-inquiry-local-"));
		try {
			const service = new InquiryService({ inquiryDir: root, projectId: root });
			await service.recordLocalExecution({
				id: "tool-1",
				projectId: root,
				sessionId: "s1",
				toolName: "bash",
				codeFingerprint: "f".repeat(64),
				parameters: { source: "local", seed: 1 },
				runProvenance: {
					workflow: "local",
					modules: ["bash"],
					environment: { interpreterVersion: "Python 3" },
				},
				outcome: "succeeded",
				artifacts: [{ path: "results/plot.png", bytes: 3, sha256: "a".repeat(64), location: "local" }],
			});
			const snapshot = await service.readOnlySnapshot(root);
			expect(snapshot?.attempts).toEqual([
				expect.objectContaining({
					id: "local:tool-1",
					codeFingerprint: "f".repeat(64),
					artifactIds: [expect.any(String)],
				}),
			]);
			expect(snapshot?.artifacts[0]).toMatchObject({ location: "local", path: "results/plot.png" });
			service.dispose();
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

	it("keeps the default host ledger isolated by project id", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-backend-inquiry-projects-"));
		try {
			const service = new InquiryService({ projectsDir: root, projectId: "project-a" });
			await service.recordDecision({
				id: "task-authorization:task-1:1",
				kind: "task-authorization",
				summary: "Authorized task",
				basis: ["task:task-1"],
				projectId: "project-a",
			});
			await service.recordDecision({
				id: "rebind:task-1:action-1",
				kind: "rebind",
				summary: "Rebound paper",
				basis: ["action:action-1"],
				projectId: "project-b",
			});
			expect(await service.listDecisions("project-a")).toHaveLength(1);
			expect(await service.listDecisions("project-b")).toHaveLength(1);
			const projectADecision = (await service.listDecisions("project-a"))[0];
			const projectBDecision = (await service.listDecisions("project-b"))[0];
			expect(projectADecision).toBeDefined();
			expect(projectBDecision).toBeDefined();
			if (!projectADecision || !projectBDecision) throw new Error("decision isolation fixture failed");
			await service.revokeDecision(projectADecision.id, "Review");
			expect(projectBDecision.status).toBe("active");
			service.dispose();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("canonicalizes /tmp and /private/tmp workspace identities in project mode", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-backend-inquiry-canonical-"));
		const workspace = await mkdtemp(join(tmpdir(), "drone-backend-workspace-"));
		try {
			const service = new InquiryService({ projectsDir: root, projectId: workspace });
			await service.recordDecision({
				id: "subagent-dispatch-1",
				kind: "subagent-dispatch",
				summary: "Dispatched a subagent",
				projectId: workspace,
			});
			const alias =
				process.platform === "darwin"
					? workspace.replace(/^\/tmp/, "/private/tmp")
					: join(root, "workspace-alias");
			if (process.platform !== "darwin")
				await symlink(workspace, alias, process.platform === "win32" ? "junction" : "dir");
			expect(await service.listDecisions(alias)).toHaveLength(1);
			service.dispose();
		} finally {
			await rm(workspace, { recursive: true, force: true });
			await rm(root, { recursive: true, force: true });
		}
	});

	it("mounts a legacy desktop ledger without opening or rewriting it", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-backend-inquiry-legacy-"));
		const legacy = join(root, "inquiry");
		const registry = createDefaultStorageRegistry({
			agentDir: join(root, "agent"),
			legacyInquiryDir: legacy,
		});
		const ledger = join(legacy, "ledger.sqlite");
		try {
			const old = new InquiryService({ inquiryDir: legacy, projectId: "desktop" });
			await old.recordDecision({
				id: "legacy-1",
				kind: "workflow-repair",
				summary: "Legacy decision",
				projectId: "desktop",
			});
			old.dispose();
			const before = await import("node:fs/promises").then(({ readFile }) => readFile(ledger));
			expect(registry.get("inquiry-legacy-ledger")).toMatchObject({ schema: "preserve", path: ledger });
			const after = await import("node:fs/promises").then(({ readFile }) => readFile(ledger));
			expect(after.equals(before)).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("links successful task receipts to decisions before revocation", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-backend-inquiry-receipt-link-"));
		try {
			const service = new InquiryService({ inquiryDir: root, projectId: "project-receipts" });
			await service.recordDecision({
				id: "task-auth-1",
				kind: "task-authorization",
				summary: "Authorized task",
				basis: ["task:task-1"],
				projectId: "project-receipts",
			});
			await service.recordTaskTerminal({
				id: "terminal-1",
				taskId: "task-1",
				runId: "run-1",
				status: "succeeded",
				at: "2026-01-01T00:00:00.000Z",
				artifacts: [{ path: "runs/task-1/run-1/report.md", bytes: 1, sha256: "a".repeat(64) }],
			});
			const decision = (await service.listDecisions())[0];
			expect(decision).toBeDefined();
			if (!decision) throw new Error("receipt decision fixture failed");
			expect(decision.affectedArtifactIds).toHaveLength(1);
			await service.revokeDecision(decision.id, "Review");
			expect((await service.readOnlySnapshot())?.artifacts[0]?.status).toBe("pending-review");
			service.dispose();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("confirms a revoked task receipt without invoking external adapters", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-backend-inquiry-confirm-"));
		const zotero = { write: vi.fn() };
		const compute = { submit: vi.fn() };
		try {
			const service = new InquiryService({ inquiryDir: root, projectId: "project-confirm" });
			await service.recordDecision({
				id: "task-auth-confirm",
				kind: "task-authorization",
				summary: "Authorized task",
				basis: ["task:task-confirm"],
				projectId: "project-confirm",
			});
			await service.recordTaskTerminal({
				id: "terminal-confirm",
				taskId: "task-confirm",
				runId: "run-confirm",
				status: "succeeded",
				at: "2026-01-01T00:00:00.000Z",
				artifacts: [{ path: "runs/task-confirm/report.md", bytes: 1, sha256: "a".repeat(64) }],
			});
			const decision = (await service.listDecisions())[0];
			if (!decision) throw new Error("confirmation decision fixture failed");
			await service.revokeDecision(decision.id, "Review");
			await expect(service.confirmDecision(decision.id, "")).rejects.toThrow("human review reason");
			await service.confirmDecision(decision.id, "Checked by user");
			expect((await service.readOnlySnapshot())?.artifacts[0]).toMatchObject({
				status: "valid",
				reviews: [
					expect.objectContaining({
						decisionId: decision.id,
						confirmedBy: "user",
						confirmedAt: expect.any(String),
					}),
				],
			});
			expect(zotero.write).not.toHaveBeenCalled();
			expect(compute.submit).not.toHaveBeenCalled();
			service.dispose();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("records every decision kind from successful receipts without touching external adapters", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-backend-inquiry-decisions-"));
		const zotero = { write: vi.fn() };
		const compute = { submit: vi.fn() };
		try {
			const service = new InquiryService({ inquiryDir: root, projectId: "project-decisions" });
			const kinds = [
				"task-authorization",
				"workflow-repair",
				"subagent-dispatch",
				"compute-submit",
				"zotero-write",
				"rebind",
			] as const;
			for (const kind of kinds)
				await service.recordDecision({
					id: `receipt:${kind}`,
					kind,
					summary: `Successful ${kind}`,
					basis: [`tool:${kind}`],
					at: "2026-01-01T00:00:00.000Z",
				});
			const revoked = await service.revokeDecision("receipt:zotero-write", "review requested");
			expect(revoked.status).toBe("revoked");
			expect((await service.listDecisions()).map((item) => item.kind)).toEqual(
				expect.arrayContaining([...kinds]),
			);
			expect(zotero.write).not.toHaveBeenCalled();
			expect(compute.submit).not.toHaveBeenCalled();
			service.dispose();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
