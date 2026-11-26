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

import { channelOf, SessionsContract } from "@drone/shared";
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

function sessionHandler(method: keyof typeof SessionsContract.methods) {
	const channel = channelOf(SessionsContract, method);
	const handler = mocks.handlers.get(channel);
	if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
	return handler;
}

describe("registerSessionsIpc", () => {
	beforeEach(() => {
		mocks.handlers.clear();
		mocks.removeHandler.mockClear();
	});

	it("registers every canonical session channel and forwards both list arities", async () => {
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
		expect([...mocks.handlers.keys()].sort()).toEqual(
			Object.keys(SessionsContract.methods)
				.map((method) => channelOf(SessionsContract, method))
				.sort(),
		);
		const create = sessionHandler("createSession");
		const list = sessionHandler("listSessions");

		expect(await create({}, { cwd: "/tmp/project" })).toMatchObject({ sessionId: "s1" });
		expect(await list({}, "/tmp/project")).toEqual([]);
		expect(await list({})).toEqual([]);
		expect(createSession).toHaveBeenCalledWith({ cwd: "/tmp/project" });
		expect(listSessions).toHaveBeenCalledWith("/tmp/project");
		expect(listSessions).toHaveBeenCalledWith();
	});

	it("rejects invalid migrated arguments before calling the backend", async () => {
		const createSession = vi.fn();
		const backend = backendForTests({ createSession });
		registerSessionsIpc(backend);

		const create = sessionHandler("createSession");
		const invalid = await create({}, { cwd: "" });
		expect(invalid).toMatchObject({ code: "invalid_arguments", severity: "error" });
		expect(createSession).not.toHaveBeenCalled();
	});

	it("accepts the composition root while preserving the legacy façade fallback", async () => {
		const createSession = vi.fn(async () => ({
			sessionId: "s2",
			cwd: "/tmp/project",
			active: true,
			messageCount: 0,
			createdAt: 2,
		}));
		const backend = backendForTests({ createSession });
		registerSessionsIpc({ sessions: backend } as unknown as Parameters<typeof registerSessionsIpc>[0]);
		const create = sessionHandler("createSession");
		expect(await create({}, { cwd: "/tmp/project" })).toMatchObject({ sessionId: "s2" });
		expect(createSession).toHaveBeenCalledWith({ cwd: "/tmp/project" });
	});
});

it("dispatches explicit commands on their own validated channel and reports failures", async () => {
	const command = vi.fn().mockRejectedValue(new Error("Extension command unavailable: removed"));
	const prompt = vi.fn();
	registerSessionsIpc(backendForTests({ command, prompt }));
	const handler = sessionHandler("command");
	await expect(handler({}, "session", "removed", "input")).rejects.toThrow(
		"Extension command unavailable: removed",
	);
	expect(command).toHaveBeenCalledExactlyOnceWith("session", "removed", "input");
	expect(prompt).not.toHaveBeenCalled();
	const invalid = await handler({}, "session", "/removed");
	expect(invalid).toMatchObject({ code: "invalid_arguments" });
	expect(command).toHaveBeenCalledOnce();
});
