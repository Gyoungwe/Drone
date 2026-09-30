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
import { registerSessionsIpc } from "./sessions";

describe("registerSessionsIpc", () => {
	beforeEach(() => {
		mocks.handlers.clear();
		mocks.removeHandler.mockClear();
	});

	it("routes migrated methods through the sessions contract channels", async () => {
		const createSession = vi.fn(async (options: { cwd: string }) => ({
			sessionId: "s1",
			cwd: options.cwd,
			active: true,
			messageCount: 0,
			createdAt: 1,
		}));
		const listSessions = vi.fn(async () => []);
		const backend = {
			createSession,
			listSessions,
			prompt: vi.fn(async () => ({ accepted: true })),
			openSession: vi.fn(async () => undefined),
		} as unknown as Parameters<typeof registerSessionsIpc>[0];

		registerSessionsIpc(backend);
		const create = mocks.handlers.get(IpcChannels.SessionCreate)!;
		const list = mocks.handlers.get(IpcChannels.SessionList)!;

		expect(await create({}, { cwd: "/tmp/project" })).toMatchObject({ sessionId: "s1" });
		expect(await list({}, "/tmp/project")).toEqual([]);
		expect(createSession).toHaveBeenCalledWith({ cwd: "/tmp/project" });
		expect(listSessions).toHaveBeenCalledWith("/tmp/project");
		expect(mocks.handlers.has("sessions:create")).toBe(false);
		expect(mocks.handlers.has(IpcChannels.SessionOpen)).toBe(true);
	});

	it("rejects invalid migrated arguments before calling the backend", async () => {
		const createSession = vi.fn();
		const backend = {
			createSession,
			listSessions: vi.fn(),
			prompt: vi.fn(),
		} as unknown as Parameters<typeof registerSessionsIpc>[0];
		registerSessionsIpc(backend);

		const create = mocks.handlers.get(IpcChannels.SessionCreate)!;
		const invalid = await create({}, { cwd: "" });
		expect(invalid).toMatchObject({ code: "invalid_arguments", severity: "error" });
		expect(createSession).not.toHaveBeenCalled();
	});
});
