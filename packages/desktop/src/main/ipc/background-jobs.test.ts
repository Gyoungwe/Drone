import { expect, it, vi } from "vitest";
import { registerBackgroundJobsIpc } from "./background-jobs";

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
		removeHandler: vi.fn(),
	},
}));

function invoke(channel: string, ...args: unknown[]) {
	const handler = handlers.get(channel);
	if (!handler) throw new Error(`Test IPC handler was not registered: ${channel}`);
	return handler({}, ...args);
}

it("dispatches each background jobs method with the exact service arguments", async () => {
	const cwd = "/workspace";
	const status = {
		enabled: false,
		dailyTokenLimit: 10_000_000,
		usedTokens: 21,
		exhausted: false,
		unknownUsage: false,
	};
	const enabled = { ...status, enabled: true };
	const limited = { ...enabled, dailyTokenLimit: 2_000_000 };
	const backgroundJobs = {
		getStatus: vi.fn(async () => status),
		setEnabled: vi.fn(async () => enabled),
		setDailyTokenLimit: vi.fn(async () => limited),
	};
	registerBackgroundJobsIpc({ backgroundJobs });

	expect(await invoke("backgroundJobs:getBackgroundJobsStatus", cwd)).toStrictEqual(status);
	expect(backgroundJobs.getStatus).toHaveBeenCalledExactlyOnceWith(cwd);
	expect(await invoke("backgroundJobs:setBackgroundJobsEnabled", cwd, true)).toStrictEqual(enabled);
	expect(backgroundJobs.setEnabled).toHaveBeenCalledExactlyOnceWith(cwd, true);
	expect(await invoke("backgroundJobs:setBackgroundJobsDailyLimit", cwd, 2_000_000)).toStrictEqual(limited);
	expect(backgroundJobs.setDailyTokenLimit).toHaveBeenCalledExactlyOnceWith(cwd, 2_000_000);
});
