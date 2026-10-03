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

import { IpcChannels } from "@drone/shared";
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
		expect(await mocks.handlers.get(IpcChannels.ComputeListHosts)!(event)).toEqual([host]);
		expect(service.listHosts).toHaveBeenCalledOnce();
		await mocks.handlers.get(IpcChannels.ComputeProbeHost)!(event, host.id);
		expect(service.authorizeRemoteOperation).toHaveBeenCalledWith({ kind: "probe_host", hostId: host.id });
		const invalid = await mocks.handlers.get(IpcChannels.ComputeGetHost)!(event, "bad host");
		expect(invalid).toMatchObject({ code: "invalid_arguments" });
		expect(service.getHost).not.toHaveBeenCalled();
		unbind();
		expect(mocks.removeHandler).toHaveBeenCalledWith(IpcChannels.ComputeListHosts);
	});

	it("rejects child frames before invoking the adapter", async () => {
		const service = adapter();
		registerComputeIpc(service as any);
		const frame = {};
		await expect(
			mocks.handlers.get(IpcChannels.ComputeListHosts)!({ sender: { mainFrame: frame }, senderFrame: {} }),
		).rejects.toThrow("main frame");
		expect(service.listHosts).not.toHaveBeenCalled();
	});
});
