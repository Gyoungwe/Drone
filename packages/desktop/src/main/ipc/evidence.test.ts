import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	fromWebContents: vi.fn(),
}));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(channel, handler),
		removeHandler: vi.fn(),
	},
	BrowserWindow: { fromWebContents: mocks.fromWebContents },
}));

import { IpcChannels } from "@drone/shared";
import { registerEvidenceIpc } from "./evidence";

describe("evidence IPC", () => {
	beforeEach(() => {
		mocks.handlers.clear();
		mocks.fromWebContents.mockReturnValue({});
	});
	it("binds overview, freeze and export through the main-frame guard", async () => {
		const service = {
			overview: vi.fn(async () => ({ analyses: [], checkpoints: [], branches: [], replays: [] })),
			freezeRecorded: vi.fn(async () => ({
				id: "a".repeat(64),
				analysisId: "run-1",
				assay: "assembly",
				createdAt: "now",
				files: [],
				replayReady: false,
			})),
			fork: vi.fn(),
			branch: vi.fn(async () => ({
				checkpointId: "a".repeat(64),
				workspace: "/tmp/b",
				status: "ready" as const,
			})),
			exportCapsule: vi.fn(async () => ({
				path: "/tmp/capsule.json",
				sha256: "b".repeat(64),
				audience: "private" as const,
			})),
			importCapsule: vi.fn(async () => ({ id: "a".repeat(64) })),
			summary: vi.fn(() => ({
				id: "a".repeat(64),
				analysisId: "run-1",
				assay: "assembly",
				createdAt: "now",
				files: [],
				replayReady: false,
			})),
			replay: vi.fn(async () => ({
				id: "receipt",
				checkpointId: "a".repeat(64),
				status: "reproduced" as const,
				detail: "ok",
				outputChecks: [],
				environmentMatched: true,
				completedAt: "now",
			})),
		};
		registerEvidenceIpc(service as never);
		const frame = {};
		const event = { sender: { mainFrame: frame }, senderFrame: frame };
		expect(await mocks.handlers.get(IpcChannels.EvidenceOverview)!(event)).toEqual({
			analyses: [],
			checkpoints: [],
			branches: [],
			replays: [],
		});
		await mocks.handlers.get(IpcChannels.EvidenceFreeze)!(event, "run-1", "/tmp/results");
		expect(service.freezeRecorded).toHaveBeenCalledWith("run-1", "/tmp/results");
		await mocks.handlers.get(IpcChannels.EvidenceExport)!(event, "a".repeat(64), "private");
		expect(service.exportCapsule).toHaveBeenCalledWith("a".repeat(64), "private");
		await mocks.handlers.get(IpcChannels.EvidenceImport)!(event, "/tmp/capsule.json");
		expect(service.importCapsule).toHaveBeenCalledWith("/tmp/capsule.json");
		await mocks.handlers.get(IpcChannels.EvidenceReplay)!(event, "a".repeat(64));
		expect(service.replay).toHaveBeenCalledWith("a".repeat(64));
	});
	it("rejects renderer frames before dispatch", async () => {
		const service = {
			overview: vi.fn(async () => ({ analyses: [], checkpoints: [], branches: [], replays: [] })),
		};
		registerEvidenceIpc(service as never);
		const frame = {};
		const event = { sender: { mainFrame: frame }, senderFrame: {} };
		await expect(mocks.handlers.get(IpcChannels.EvidenceOverview)!(event)).rejects.toThrow("main frame");
		expect(service.overview).not.toHaveBeenCalled();
	});
});
