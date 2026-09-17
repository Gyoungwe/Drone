import type { ContextUsageInfo } from "@drone/shared";
import { describe, expect, it, vi } from "vitest";
import { createContextUsageRefresh } from "./context-usage-refresh";

function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
	const promise = new Promise<T>((ok, no) => {
		resolve = ok;
		reject = no;
	});
	return { promise, resolve, reject };
}
const sample = (tokens: number): ContextUsageInfo => ({
	tokens,
	contextWindow: 1000000,
	percent: tokens / 10000,
});
describe("context usage request lifetime", () => {
	it("cannot apply an old session response after switching sessions", async () => {
		const a = deferred<ContextUsageInfo | null>(),
			b = deferred<ContextUsageInfo | null>(),
			update = vi.fn();
		const first = createContextUsageRefresh(() => a.promise, update);
		const old = first.refresh();
		first.dispose();
		const second = createContextUsageRefresh(() => b.promise, update);
		const next = second.refresh();
		b.resolve(sample(200));
		await next;
		a.resolve(sample(900));
		await old;
		expect(update.mock.calls).toEqual([[sample(200)]]);
	});
	it("latest request wins when responses finish out of order", async () => {
		const a = deferred<ContextUsageInfo | null>(),
			b = deferred<ContextUsageInfo | null>(),
			update = vi.fn();
		const fetch = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
		const reader = createContextUsageRefresh(fetch, update);
		const p = reader.refresh(),
			q = reader.refresh();
		b.resolve(sample(250));
		await q;
		a.resolve(sample(100));
		await p;
		expect(update.mock.calls).toEqual([[sample(250)]]);
	});
	it("post-compaction unknown cannot be overwritten by a pre-compaction response", async () => {
		const a = deferred<ContextUsageInfo | null>(),
			b = deferred<ContextUsageInfo | null>(),
			update = vi.fn();
		const reader = createContextUsageRefresh(
			vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise),
			update,
		);
		const p = reader.refresh(),
			q = reader.refresh();
		const unknown = { tokens: null, percent: null, contextWindow: 1000000 };
		b.resolve(unknown);
		await q;
		a.resolve(sample(999999));
		await p;
		expect(update.mock.calls).toEqual([[unknown]]);
	});
	it("an obsolete failure cannot clear the newest estimate", async () => {
		const a = deferred<ContextUsageInfo | null>(),
			update = vi.fn();
		const reader = createContextUsageRefresh(
			vi.fn().mockReturnValueOnce(a.promise).mockResolvedValueOnce(sample(100)),
			update,
		);
		const p = reader.refresh();
		await reader.refresh();
		a.reject(new Error("late error"));
		await p;
		expect(update.mock.calls).toEqual([[sample(100)]]);
	});
	it("clears unavailable current context rather than making up zero", async () => {
		const update = vi.fn(),
			reader = createContextUsageRefresh(async () => {
				throw new Error("unavailable");
			}, update);
		await reader.refresh();
		expect(update).toHaveBeenCalledWith(null);
	});
});
