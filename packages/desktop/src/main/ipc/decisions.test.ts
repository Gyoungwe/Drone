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
import { registerDecisionsIpc } from "./decisions";

describe("registerDecisionsIpc", () => {
	beforeEach(() => {
		mocks.handlers.clear();
		mocks.removeHandler.mockClear();
		mocks.fromWebContents.mockReturnValue(mocks.window);
	});

	it("lists and revokes through the inquiry port without external adapters", async () => {
		const decision = {
			id: "decision-1",
			schemaVersion: 2,
			projectId: "project-1",
			kind: "workflow-repair",
			summary: "Adjusted workflow",
			basis: ["repair-1"],
			affectedArtifactIds: [],
			status: "active",
			createdAt: "2026-01-01T00:00:00.000Z",
		} as const;
		const inquiry = {
			listDecisions: vi.fn(async () => [decision]),
			revokeDecision: vi.fn(async () => ({
				...decision,
				status: "revoked",
				revokedAt: "2026-01-02T00:00:00.000Z",
			})),
		};
		const unbind = registerDecisionsIpc(inquiry as any);
		const frame = {};
		const event = { sender: { mainFrame: frame }, senderFrame: frame };
		expect(await mocks.handlers.get(IpcChannels.DecisionsList)!(event, "project-1")).toEqual([decision]);
		expect(
			await mocks.handlers.get(IpcChannels.DecisionsRevoke)!(event, "decision-1", "review"),
		).toMatchObject({
			status: "revoked",
		});
		expect(inquiry.listDecisions).toHaveBeenCalledWith("project-1");
		expect(inquiry.revokeDecision).toHaveBeenCalledWith("decision-1", "review");
		unbind();
	});
});
