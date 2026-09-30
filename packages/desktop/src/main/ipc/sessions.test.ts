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

import { IpcChannels, SessionsContract } from "@drone/shared";
import { registerSessionsIpc } from "./sessions";

function backendForTests(overrides: Record<string, unknown> = {}) {
	const defaults: Record<string, unknown> = {};
	for (const method of Object.keys(SessionsContract.methods)) defaults[method] = vi.fn(async () => undefined);
	defaults.createSession = vi.fn(async (options: { cwd: string }) => ({
		sessionId: "s1",
		cwd: options.cwd,
		active: true,
		messageCount: 0,
		createdAt: 1,
	}));
	defaults.listSessions = vi.fn(async () => []);
	defaults.prompt = vi.fn(async () => ({ kind: "agent" }));
	return { ...defaults, ...overrides } as unknown as Parameters<typeof registerSessionsIpc>[0];
}

describe("registerSessionsIpc", () => {
	beforeEach(() => {
		mocks.handlers.clear();
		mocks.removeHandler.mockClear();
	});

	it("routes every session method through its legacy session channel", async () => {
		const createSession = vi.fn(async (options: { cwd: string }) => ({
			sessionId: "s1",
			cwd: options.cwd,
			active: true,
			messageCount: 0,
			createdAt: 1,
		}));
		const listSessions = vi.fn(async () => []);
		const backend = backendForTests({ createSession, listSessions });

		registerSessionsIpc(backend);
		const create = mocks.handlers.get(IpcChannels.SessionCreate)!;
		const list = mocks.handlers.get(IpcChannels.SessionList)!;

		expect(await create({}, { cwd: "/tmp/project" })).toMatchObject({ sessionId: "s1" });
		expect(await list({}, "/tmp/project")).toEqual([]);
		expect(await list({})).toEqual([]);
		expect(createSession).toHaveBeenCalledWith({ cwd: "/tmp/project" });
		expect(listSessions).toHaveBeenCalledWith("/tmp/project");
		expect(listSessions).toHaveBeenCalledWith();
		expect(mocks.handlers.has("sessions:createSession")).toBe(false);
		expect(mocks.handlers.has(IpcChannels.SessionOpen)).toBe(true);
		expect(mocks.handlers.has(IpcChannels.SessionGetMessages)).toBe(true);
		expect(mocks.handlers.has(IpcChannels.ProjectListFiles)).toBe(true);
	});

	it("rejects invalid migrated arguments before calling the backend", async () => {
		const createSession = vi.fn();
		const backend = backendForTests({ createSession });
		registerSessionsIpc(backend);

		const create = mocks.handlers.get(IpcChannels.SessionCreate)!;
		const invalid = await create({}, { cwd: "" });
		expect(invalid).toMatchObject({ code: "invalid_arguments", severity: "error" });
		expect(createSession).not.toHaveBeenCalled();
	});
});
