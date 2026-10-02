import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StorageRegistry } from "../storage/registry";
import type { ComputeExecutor } from "./compute";
import { ComputeService } from "./compute";
import { createComputeServiceAdapter, createUnavailableComputeService } from "./compute-adapter";

describe("default compute adapter", () => {
	it("keeps host management local while refusing remote side effects", async () => {
		const service = createUnavailableComputeService();
		const host = await service.saveHost({ alias: "cluster-a", displayName: "Cluster A", kind: "ssh" });
		expect((await service.listHosts()).map((item) => item.id)).toEqual([host.id]);
		expect(await service.getHost(host.id)).toMatchObject({ alias: "cluster-a", authState: "not_configured" });
		await expect(service.openTerminal({ hostId: host.id })).rejects.toThrow("unavailable");
		await service.removeHost(host.id);
		expect(await service.getHost(host.id)).toBeNull();
	});

	it("reports onboarding and health without claiming an unprobed host is online", async () => {
		const service = createUnavailableComputeService();
		const host = await service.saveHost({ alias: "cluster-b", displayName: "Cluster B", kind: "ssh" });
		const health = await service.getHealthSnapshot();
		expect(health.hosts[0]).toMatchObject({ id: host.id, status: "unknown" });
		expect((await service.getOnboardingStatus()).find((item) => item.step === "remote-host")).toMatchObject({
			state: "needs_action",
		});
	});

	it("rebuilds the backend projection from the persisted B1 host", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-compute-adapter-"));
		const first = new ComputeService({ storage: new StorageRegistry(), agentDir: root });
		const firstAdapter = createComputeServiceAdapter({ service: first, agentDir: root });
		const saved = await firstAdapter.saveHost({
			alias: "cluster-a",
			displayName: "Cluster A",
			kind: "ssh",
			endpoint: "cluster.example",
			user: "runner",
			workspaceRoot: "/work",
		});
		await firstAdapter.dispose?.();
		await first.dispose();

		const reopened = new ComputeService({ storage: new StorageRegistry(), agentDir: root });
		const reopenedAdapter = createComputeServiceAdapter({ service: reopened, agentDir: root });
		expect(await reopenedAdapter.getHost(saved.id)).toMatchObject({
			id: saved.id,
			alias: "cluster-a",
			displayName: "Cluster A",
			endpoint: "cluster.example",
			user: "runner",
			workspaceRoot: "/work",
		});
		await reopenedAdapter.dispose?.();
		await reopened.dispose();
	});

	it("projects B1 job state, budget and logs into the desktop contract", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-compute-adapter-"));
		const executor: ComputeExecutor = {
			submit: async () => ({ status: "running", startedAt: Date.now() }),
			status: async () => ({ status: "running" }),
			logs: async () => ({ events: [{ type: "stdout", text: "hello\\n" }], cursor: "1" }),
			cancel: async () => ({ status: "cancelled" }),
		};
		const service = new ComputeService({
			storage: new StorageRegistry(),
			agentDir: root,
			executor,
			pollIntervalMs: 60_000,
		});
		const adapter = createComputeServiceAdapter({
			service,
			agentDir: root,
			authorizeRemoteOperation: async () => {},
		});
		await adapter.saveHost({ alias: "local", displayName: "Local", kind: "local" });
		await service.submit({
			jobId: "job-1",
			hostAlias: "local",
			workflow: { version: 1, modules: [], steps: [] },
			resources: { cpus: 2, wallTimeSeconds: 120 },
		});

		expect(await adapter.listJobs()).toEqual([
			expect.objectContaining({
				id: "job-1",
				hostId: "local",
				state: "running",
				budget: { coreHours: 2 / 30, wallMinutes: 2, diskBytes: 0 },
			}),
		]);
		expect(await adapter.getLogs("job-1")).toMatchObject({
			jobId: "job-1",
			text: "hello\\n",
			cursor: "1",
		});
		await adapter.cancelJob("job-1");
		expect((await adapter.getJob("job-1"))?.state).toBe("cancelled");
		await adapter.dispose?.();
		await service.dispose();
	});

	it("does not execute a runner operation when approval is denied", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-compute-adapter-"));
		let cancellations = 0;
		const executor: ComputeExecutor = {
			submit: async () => ({ status: "queued" }),
			status: async () => ({ status: "queued" }),
			cancel: async () => {
				cancellations += 1;
				return { status: "cancelled" };
			},
		};
		const service = new ComputeService({
			storage: new StorageRegistry(),
			agentDir: root,
			executor,
			pollIntervalMs: 60_000,
		});
		const adapter = createComputeServiceAdapter({
			service,
			agentDir: root,
			authorizeRemoteOperation: async () => {
				throw new Error("denied");
			},
		});
		await adapter.saveHost({ alias: "local", displayName: "Local", kind: "local" });
		await service.submit({
			jobId: "job-2",
			hostAlias: "local",
			workflow: { version: 1, modules: [], steps: [] },
		});
		await expect(adapter.cancelJob("job-2")).rejects.toThrow("denied");
		expect(cancellations).toBe(0);
		await adapter.dispose?.();
		await service.dispose();
	});
});
