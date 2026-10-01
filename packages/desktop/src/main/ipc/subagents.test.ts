import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	removeHandler: vi.fn((channel: string) => mocks.handlers.delete(channel)),
}));

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(channel, handler),
		removeHandler: mocks.removeHandler,
	},
}));

import { IpcChannels } from "@drone/shared";
import { registerSubagentsIpc } from "./subagents";

describe("registerSubagentsIpc", () => {
	beforeEach(() => {
		mocks.handlers.clear();
		mocks.removeHandler.mockClear();
	});

	it("routes panel methods through the subagents contract", async () => {
		const listSessionSubagents = vi.fn(async (sessionId: string) => ({
			sessionId,
			cwd: "/tmp/project",
			agents: [],
			maxConcurrent: 2,
			projectTrusted: true,
			userAgentsDir: "/tmp/agents",
			projectAgentsDir: "/tmp/project/.pi/agents",
			readOnly: false,
		}));
		const dispatchSubagents = vi.fn(async () => ({ dispatchId: "d1", runs: [] }));
		const abortSubagentRun = vi.fn(async () => true);
		const listSubagentRuns = vi.fn(async () => []);
		const backend = {
			listSessionSubagents,
			dispatchSubagents,
			abortSubagentRun,
			listSubagentRuns,
		} as unknown as Parameters<typeof registerSubagentsIpc>[0];

		registerSubagentsIpc(backend);
		const list = mocks.handlers.get(IpcChannels.SubagentsList)!;
		const dispatch = mocks.handlers.get(IpcChannels.SubagentsDispatch)!;
		const abort = mocks.handlers.get(IpcChannels.SubagentsAbort)!;
		const runs = mocks.handlers.get(IpcChannels.SubagentsRuns)!;

		expect(await list({}, "session-1")).toMatchObject({ sessionId: "session-1" });
		expect(await dispatch({}, "session-1", { tasks: [{ agent: "scout", task: "Inspect" }] })).toEqual({
			dispatchId: "d1",
			runs: [],
		});
		expect(await abort({}, "run-1")).toBe(true);
		expect(await runs({}, "session-1")).toEqual([]);
		expect(listSessionSubagents).toHaveBeenCalledWith("session-1");
		expect(dispatchSubagents).toHaveBeenCalledWith("session-1", {
			tasks: [{ agent: "scout", task: "Inspect" }],
		});
		expect(abortSubagentRun).toHaveBeenCalledWith("run-1");
		expect(listSubagentRuns).toHaveBeenCalledWith("session-1");
	});

	it("rejects invalid arguments before invoking the backend", async () => {
		const listSessionSubagents = vi.fn();
		const backend = {
			listSessionSubagents,
			dispatchSubagents: vi.fn(),
			abortSubagentRun: vi.fn(),
			listSubagentRuns: vi.fn(),
		} as unknown as Parameters<typeof registerSubagentsIpc>[0];
		registerSubagentsIpc(backend);

		const list = mocks.handlers.get(IpcChannels.SubagentsList)!;
		const invalid = await list({}, "");
		expect(invalid).toMatchObject({ code: "invalid_arguments", severity: "error" });
		expect(listSessionSubagents).not.toHaveBeenCalled();
	});

	it("prefers the explicit host service over façade methods", async () => {
		const service = {
			listSession: vi.fn(async () => ({
				sessionId: "session-2",
				cwd: "/tmp/project",
				agents: [],
				maxConcurrent: 1,
				projectTrusted: false,
				userAgentsDir: "/tmp/agents",
				projectAgentsDir: "/tmp/project/.pi/agents",
				readOnly: false,
			})),
			dispatch: vi.fn(async () => ({ dispatchId: "d2", runs: [] })),
			abort: vi.fn(async () => true),
			listRuns: vi.fn(async () => []),
			listAvailable: vi.fn(async () => []),
		};
		const backend = {} as Parameters<typeof registerSubagentsIpc>[0];
		registerSubagentsIpc(backend, { subagents: service });

		const list = mocks.handlers.get(IpcChannels.SubagentsList)!;
		expect(await list({}, "session-2")).toMatchObject({ sessionId: "session-2" });
		expect(service.listSession).toHaveBeenCalledWith("session-2");
	});
});
