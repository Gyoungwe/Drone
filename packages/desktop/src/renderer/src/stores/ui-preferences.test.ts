import { beforeEach, describe, expect, it, vi } from "vitest";

/** window.pi 的 mock：ui-preferences store 经 getPi() 访问，测试环境无 preload 注入 */
const piMock = vi.hoisted(() => ({
	loadUiState: vi.fn(),
	saveUiState: vi.fn(() => Promise.resolve()),
}));
vi.mock("../api", () => ({ getPi: () => piMock }));

import { useUiPreferencesStore } from "./ui-preferences";

beforeEach(() => {
	vi.clearAllMocks();
	useUiPreferencesStore.setState({ centerOrbEnabled: false });
});

describe("useUiPreferencesStore", () => {
	it("默认关闭（旧版本 ui-state 无该字段）", () => {
		expect(useUiPreferencesStore.getState().centerOrbEnabled).toBe(false);
	});

	it("init 从 ui-state 恢复开关", async () => {
		piMock.loadUiState.mockResolvedValue({ centerOrbEnabled: true });
		await useUiPreferencesStore.getState().init();
		expect(useUiPreferencesStore.getState().centerOrbEnabled).toBe(true);
	});

	it("init 加载失败或字段缺失时回落默认关闭", async () => {
		piMock.loadUiState.mockRejectedValue(new Error("no file"));
		await useUiPreferencesStore.getState().init();
		expect(useUiPreferencesStore.getState().centerOrbEnabled).toBe(false);

		piMock.loadUiState.mockResolvedValue({});
		await useUiPreferencesStore.getState().init();
		expect(useUiPreferencesStore.getState().centerOrbEnabled).toBe(false);
	});

	it("切换开关即持久化补丁", () => {
		useUiPreferencesStore.getState().setCenterOrbEnabled(true);
		expect(useUiPreferencesStore.getState().centerOrbEnabled).toBe(true);
		expect(piMock.saveUiState).toHaveBeenCalledWith({ centerOrbEnabled: true });
	});
});
