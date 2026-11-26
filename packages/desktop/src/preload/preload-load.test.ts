import type { PiApi } from "@drone/shared";
import { describe, expect, it, vi } from "vitest";

/**
 * 回归（v0.29.0 启动白屏）：preload 在加载时就为每个契约方法解析 IPC 通道，
 * 缺一条映射就会抛错，window.pi 整个不注入。这里用假 electron 真实加载 preload，
 * 确认不抛错、window.pi 被注入，且每个契约方法都有通道。
 */
const exposed: Record<string, unknown> = {};
const ipc = vi.hoisted(() => ({
	invoke: vi.fn(async () => undefined),
	on: vi.fn<(channel: string, listener: (event: unknown, payload: unknown) => void) => void>(),
	removeListener: vi.fn(),
}));
vi.mock("electron", () => ({
	contextBridge: { exposeInMainWorld: (key: string, value: unknown) => (exposed[key] = value) },
	ipcRenderer: {
		...ipc,
		send: vi.fn(),
		sendSync: vi.fn(() => undefined),
	},
	webUtils: { getPathForFile: () => "" },
}));

describe("preload", () => {
	it("loads without throwing and exposes window.pi with memory methods", async () => {
		await expect(import("./index")).resolves.toBeDefined();
		const pi = exposed.pi as Record<string, unknown>;
		expect(pi).toBeTruthy();
		for (const name of ["memoryList", "memoryRemove", "memoryPromote", "memoryPromoteToKnowledge", "command"])
			expect(typeof pi[name]).toBe("function");
	}, 15_000);

	it("exposes the desktop background jobs methods on window.pi", async () => {
		await import("./index");
		expect(exposed.pi).toEqual(
			expect.objectContaining({
				getBackgroundJobsStatus: expect.any(Function),
				setBackgroundJobsEnabled: expect.any(Function),
				setBackgroundJobsDailyLimit: expect.any(Function),
			}),
		);
	});

	it("routes app aliases through the app contract and forwards optional arguments", async () => {
		await import("./index");
		const pi = exposed.pi as PiApi;
		expect(pi.platform).toBe(process.platform);
		await pi.getAppInfo();
		await pi.previewFile("/papers/source.pdf", undefined, true);
		await pi.openResourceExternal("paper.pdf", "/papers", true);
		await pi.pickPath("directory");
		expect(ipc.invoke.mock.calls).toEqual([
			["app:getInfo"],
			["app:filePreview", "/papers/source.pdf", undefined, true],
			["app:resourceOpenExternal", "paper.pdf", "/papers", true],
			["app:pickPath", "directory"],
		]);
	});

	it.each([
		{ method: "onUpdateEvent", channel: "app:updateEvent", payload: { phase: "checking" } },
		{
			method: "onResearchSkillUpdateEvent",
			channel: "researchSkills:updateEvent",
			payload: { phase: "checking" },
		},
		{ method: "onDesktopCommand", channel: "app:desktopCommand", payload: "new-task" },
	] as const)(
		"$method subscribes to $channel and removes its listener",
		async ({ method, channel, payload }) => {
			await import("./index");
			const pi = exposed.pi as PiApi;
			const receive = vi.fn();
			const unsubscribe = pi[method](receive);
			const registration = ipc.on.mock.lastCall;
			if (!registration) throw new Error(`Missing IPC listener: ${channel}`);
			const [actualChannel, listener] = registration;
			expect(actualChannel).toBe(channel);
			listener({}, payload);
			expect(receive).toHaveBeenCalledExactlyOnceWith(payload);
			unsubscribe();
			expect(ipc.removeListener).toHaveBeenLastCalledWith(channel, listener);
		},
	);
});
