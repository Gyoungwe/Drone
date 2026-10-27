import { describe, expect, it, vi } from "vitest";

/**
 * 回归（v0.29.0 启动白屏）：preload 在加载时就为每个契约方法解析 IPC 通道，
 * 缺一条映射就会抛错，window.pi 整个不注入。这里用假 electron 真实加载 preload，
 * 确认不抛错、window.pi 被注入，且每个契约方法都有通道。
 */
const exposed: Record<string, unknown> = {};
vi.mock("electron", () => ({
	contextBridge: { exposeInMainWorld: (key: string, value: unknown) => (exposed[key] = value) },
	ipcRenderer: {
		invoke: vi.fn(async () => undefined),
		on: vi.fn(),
		removeListener: vi.fn(),
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
});
