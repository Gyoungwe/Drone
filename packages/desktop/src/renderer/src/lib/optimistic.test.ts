import { describe, expect, it, vi } from "vitest";
import { optimisticUpdate } from "./optimistic";

describe("optimisticUpdate", () => {
	it("同步成功：apply 执行，revert / onError 不触发", async () => {
		const apply = vi.fn();
		const revert = vi.fn();
		const onError = vi.fn();
		await optimisticUpdate({ apply, sync: () => Promise.resolve(), revert, onError });
		expect(apply).toHaveBeenCalledOnce();
		expect(revert).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
	});

	it("同步失败：回滚早于错误善后，onError 收到原始错误", async () => {
		const order: string[] = [];
		const err = new Error("boom");
		const apply = vi.fn(() => order.push("apply"));
		const revert = vi.fn(async () => {
			order.push("revert");
		});
		const onError = vi.fn(() => order.push("onError"));
		await optimisticUpdate({
			apply,
			sync: () => Promise.reject(err),
			revert,
			onError,
		});
		expect(order).toEqual(["apply", "revert", "onError"]);
		expect(onError).toHaveBeenCalledWith(err);
	});

	it("no-op sync：apply 后直接返回，不回滚（draft / 纯本地路径）", async () => {
		const revert = vi.fn();
		const onError = vi.fn();
		await optimisticUpdate({ apply: () => {}, sync: () => Promise.resolve(), revert, onError });
		expect(revert).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
	});
});
