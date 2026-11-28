import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: any[]) => unknown>(),
	removeHandler: vi.fn(),
	window: { isDestroyed: () => false },
	fromWebContents: vi.fn(),
}));

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: any[]) => unknown) => mocks.handlers.set(channel, handler),
		removeHandler: mocks.removeHandler,
	},
	BrowserWindow: { fromWebContents: mocks.fromWebContents },
}));

import { canonicalProjectId } from "@drone/backend";
import { ComputeContract, type ComputeJob, channelOf } from "@drone/shared";
import { registerComputeIpc } from "./compute";

const host = {
	id: "host-1",
	alias: "local",
	displayName: "Local",
	kind: "local",
	authState: "ready",
	managed: true,
	health: { status: "healthy" },
	capabilities: [],
	createdAt: "2026-10-03T00:00:00.000Z",
	updatedAt: "2026-10-03T00:00:00.000Z",
} as const;

function adapter() {
	return {
		listHosts: vi.fn(async () => [host]),
		getHost: vi.fn(async () => host),
		saveHost: vi.fn(async () => host),
		removeHost: vi.fn(async () => {}),
		probeHost: vi.fn(async () => host),
		getHealthSnapshot: vi.fn(async () => ({
			checkedAt: host.updatedAt,
			hosts: [{ id: host.id, alias: host.alias, status: "healthy" }],
		})),
		listJobs: vi.fn(async () => []),
		getJob: vi.fn(async () => null),
		submitJob: vi.fn(
			async (): Promise<ComputeJob> => ({
				id: "job-1",
				hostId: host.id,
				state: "queued",
				budget: { coreHours: 0, wallMinutes: 0, diskBytes: 0 },
				artifacts: [],
				updatedAt: host.updatedAt,
			}),
		),
		getLogs: vi.fn(async (id: string, cursor = "") => ({
			jobId: id,
			cursor,
			text: "",
			truncated: false,
			at: host.updatedAt,
		})),
		cancelJob: vi.fn(async () => {}),
		openTerminal: vi.fn(async () => ({
			id: "term-1",
			hostId: host.id,
			cwd: "/",
			mode: "shell",
			state: "open",
			output: "",
			truncated: false,
			startedAt: host.updatedAt,
		})),
		getTerminal: vi.fn(async () => null),
		writeTerminal: vi.fn(async () => {}),
		closeTerminal: vi.fn(async () => {}),
		getOnboardingStatus: vi.fn(async () => []),
		checkOnboardingStep: vi.fn(async (step: string) => ({ step, state: "ready", summary: "ok" })),
		authorizeRemoteOperation: vi.fn(async () => {}),
		onHealthChanged: vi.fn(() => () => {}),
		onJobUpdated: vi.fn(() => () => {}),
		onLogChunk: vi.fn(() => () => {}),
		onTerminalOutput: vi.fn(() => () => {}),
		onTerminalClosed: vi.fn(() => () => {}),
	};
}

describe("registerComputeIpc", () => {
	beforeEach(() => {
		mocks.handlers.clear();
		mocks.removeHandler.mockClear();
		mocks.fromWebContents.mockReturnValue(mocks.window);
	});

	it("routes validated main-frame requests to the adapter", async () => {
		const service = adapter();
		const unbind = registerComputeIpc(service as any);
		const frame = {};
		const event = { sender: { mainFrame: frame }, senderFrame: frame };
		expect(await mocks.handlers.get(channelOf(ComputeContract, "listHosts"))!(event)).toEqual([host]);
		expect(service.listHosts).toHaveBeenCalledOnce();
		await mocks.handlers.get(channelOf(ComputeContract, "probeHost"))!(event, host.id);
		expect(service.authorizeRemoteOperation).toHaveBeenCalledWith({ kind: "probe_host", hostId: host.id });
		const invalid = await mocks.handlers.get(channelOf(ComputeContract, "getHost"))!(event, "bad host");
		expect(invalid).toMatchObject({ code: "invalid_arguments" });
		expect(service.getHost).not.toHaveBeenCalled();
		unbind();
		expect(mocks.removeHandler).toHaveBeenCalledWith(channelOf(ComputeContract, "listHosts"));
	});

	it("rejects child frames before invoking the adapter", async () => {
		const service = adapter();
		registerComputeIpc(service as any);
		const frame = {};
		await expect(
			mocks.handlers.get(channelOf(ComputeContract, "listHosts"))!({
				sender: { mainFrame: frame },
				senderFrame: {},
			}),
		).rejects.toThrow("main frame");
		expect(service.listHosts).not.toHaveBeenCalled();
	});
});

function invokeSubmit(input: unknown) {
	const frame = {};
	const submit = mocks.handlers.get(channelOf(ComputeContract, "submitJob"));
	if (!submit) throw new Error("Missing submitJob handler");
	return submit({ sender: { mainFrame: frame }, senderFrame: frame }, input);
}

function resetIpcMocks() {
	mocks.handlers.clear();
	mocks.removeHandler.mockClear();
	mocks.fromWebContents.mockReturnValue(mocks.window);
}

describe("registerComputeIpc submitJob hostEvents", () => {
	beforeEach(resetIpcMocks);

	it("publishes inquiry.decision using persisted job.spec.workDir and ignores remoteWorkDir", async () => {
		const service = adapter();
		const publish = vi.fn();
		const getJob = vi.fn(async () => ({ spec: { workDir: "/tmp/local-compute-proj" } }));
		registerComputeIpc({
			compute: { getJob },
			computeAdapter: service,
			sessions: { hostEvents: { publish } },
		} as unknown as Parameters<typeof registerComputeIpc>[0]);
		const result = await invokeSubmit({
			hostId: host.id,
			remoteWorkDir: "/scratch/hpc/run-42",
			workflow: { name: "nf-core/rnaseq", version: "3.18.0", specHash: "spec-1" },
		});
		expect(result).toMatchObject({ id: "job-1", hostId: host.id });
		expect(getJob).toHaveBeenCalledWith("job-1");
		expect(publish).toHaveBeenCalledWith(
			"inquiry.decision",
			expect.objectContaining({
				id: "compute-submit:job-1",
				kind: "compute-submit",
				summary: "Submitted compute workflow nf-core/rnaseq",
				basis: ["job-1", "spec-1"],
				projectId: canonicalProjectId("/tmp/local-compute-proj"),
				at: expect.any(String),
			}),
		);
	});

	it("falls back to the live session workspaceDirectory when job.sessionId is present", async () => {
		const service = adapter();
		service.submitJob.mockResolvedValueOnce({
			id: "job-2",
			hostId: host.id,
			sessionId: "sess-1",
			state: "queued",
			budget: { coreHours: 0, wallMinutes: 0, diskBytes: 0 },
			artifacts: [],
			updatedAt: host.updatedAt,
		});
		const publish = vi.fn();
		const getPluginCallerContext = vi.fn(() => ({
			scope: { workspaceDirectory: "/tmp/session-local-proj" },
		}));
		registerComputeIpc({
			computeAdapter: service,
			sessions: { hostEvents: { publish }, getPluginCallerContext },
		} as unknown as Parameters<typeof registerComputeIpc>[0]);
		await invokeSubmit({
			hostId: host.id,
			remoteWorkDir: "/scratch/hpc/run-99",
			workflow: { name: "nf-core/rnaseq", version: "3.18.0" },
		});
		expect(getPluginCallerContext).toHaveBeenCalledWith("sess-1");
		expect(publish).toHaveBeenCalledWith(
			"inquiry.decision",
			expect.objectContaining({
				id: "compute-submit:job-2",
				projectId: canonicalProjectId("/tmp/session-local-proj"),
			}),
		);
	});
});

describe("registerComputeIpc submitJob hostEvents safeguards", () => {
	beforeEach(resetIpcMocks);

	it("skips publishing when only remoteWorkDir is supplied with no local project directory", async () => {
		const service = adapter();
		const publish = vi.fn();
		registerComputeIpc({
			computeAdapter: service,
			sessions: { hostEvents: { publish } },
		} as unknown as Parameters<typeof registerComputeIpc>[0]);
		const result = await invokeSubmit({
			hostId: host.id,
			remoteWorkDir: "/scratch/hpc/remote-only",
			workflow: { name: "nf-core/rnaseq", version: "3.18.0" },
		});
		expect(result).toMatchObject({ id: "job-1", hostId: host.id });
		expect(publish).not.toHaveBeenCalled();
	});

	it("succeeds on submitJob when hostEvents is absent or publish throws", async () => {
		const service = adapter();
		const publish = vi.fn(() => {
			throw new Error("host event bridge unavailable");
		});
		registerComputeIpc({
			compute: { getJob: vi.fn(async () => ({ spec: { workDir: "/tmp/local-proj" } })) },
			computeAdapter: service,
			sessions: { hostEvents: { publish } },
		} as unknown as Parameters<typeof registerComputeIpc>[0]);
		const workflow = { name: "nf-core/rnaseq", version: "3.18.0" };
		expect(await invokeSubmit({ hostId: host.id, workflow })).toMatchObject({ id: "job-1", hostId: host.id });
		expect(publish).toHaveBeenCalledOnce();

		mocks.handlers.clear();
		registerComputeIpc({ computeAdapter: service } as unknown as Parameters<typeof registerComputeIpc>[0]);
		expect(await invokeSubmit({ hostId: host.id, workflow })).toMatchObject({ id: "job-1", hostId: host.id });
		expect(service.submitJob).toHaveBeenCalledTimes(2);
	});
});
