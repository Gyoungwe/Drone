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

import { canonicalProjectId } from "@drone/backend";
import { channelOf, SubagentsContract } from "@drone/shared";
import { registerSubagentsIpc } from "./subagents";

function handlerFor(method: keyof typeof SubagentsContract.methods) {
	const channel = channelOf(SubagentsContract, method);
	const handler = mocks.handlers.get(channel);
	if (!handler) throw new Error(`Missing IPC handler for ${channel}`);
	return handler;
}

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
		} as unknown as unknown as Parameters<typeof registerSubagentsIpc>[0];

		registerSubagentsIpc(backend);
		const list = handlerFor("list");
		const dispatch = handlerFor("dispatch");
		const abort = handlerFor("abort");
		const runs = handlerFor("runs");

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
		} as unknown as unknown as Parameters<typeof registerSubagentsIpc>[0];
		registerSubagentsIpc(backend);

		const list = handlerFor("list");
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
		const backend = { sessions: {}, subagents: service } as unknown as Parameters<
			typeof registerSubagentsIpc
		>[0];
		registerSubagentsIpc(backend);

		const list = handlerFor("list");
		expect(await list({}, "session-2")).toMatchObject({ sessionId: "session-2" });
		expect(service.listSession).toHaveBeenCalledWith("session-2");
	});

	it("publishes inquiry.decision via sessions.hostEvents on dispatch without backend.inquiry", async () => {
		const publish = vi.fn();
		const run = {
			runId: "run-9",
			dispatchId: "d9",
			parentSessionId: "session-9",
			agent: "scout",
			source: "builtin" as const,
			task: "Inspect",
			cwd: "/tmp/subagent-proj",
			requiredTools: [],
			followUp: true,
			status: "running" as const,
			contextState: "pending" as const,
			createdAt: 1,
			pendingApprovalIds: [],
		};
		const service = {
			listSession: vi.fn(),
			dispatch: vi.fn(async () => ({ dispatchId: "d9", runs: [run] })),
			abort: vi.fn(async () => true),
			listRuns: vi.fn(async () => []),
			listAvailable: vi.fn(async () => []),
		};
		const backend = {
			sessions: { hostEvents: { publish } },
			subagents: service,
		} as unknown as Parameters<typeof registerSubagentsIpc>[0];
		registerSubagentsIpc(backend);

		const dispatch = handlerFor("dispatch");
		const receipt = await dispatch({}, "session-9", { tasks: [{ agent: "scout", task: "Inspect" }] });
		expect(receipt).toEqual({ dispatchId: "d9", runs: [run] });
		expect(publish).toHaveBeenCalledWith(
			"inquiry.decision",
			expect.objectContaining({
				id: "subagent-dispatch:run-9",
				kind: "subagent-dispatch",
				summary: "Dispatched 1 subagent run(s)",
				basis: ["run-9"],
				projectId: canonicalProjectId("/tmp/subagent-proj"),
				at: expect.any(String),
			}),
		);
	});
});
