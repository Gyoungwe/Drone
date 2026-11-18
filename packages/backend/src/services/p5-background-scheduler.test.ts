import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createP5BackgroundScheduler, type P5BackgroundJob } from "./p5-background-scheduler";
import { createP5SpendLedger } from "./p5-spend-ledger";

const known = {
	state: "known",
	inputTokens: 6,
	outputTokens: 3,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	cost: null,
} as const;

function deferred<T>() {
	let resolve: (value: T) => void = vi.fn();
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

function fixture(limit: number | "default" = 100) {
	const directory = mkdtempSync(join(tmpdir(), "drone-p5-background-"));
	const clock = { now: new Date("2026-11-18T23:59:59+08:00") };
	const enabled = new Set(["a", "b"]);
	const spend = createP5SpendLedger({
		path: join(directory, "ledger.json"),
		clock: () => clock.now,
		localDayKey: (date) => new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10),
		limitFor: () => limit,
	});
	const scheduler = createP5BackgroundScheduler({
		isEnabled: (workspaceId) => enabled.has(workspaceId),
		spend,
		clock: () => clock.now,
	});
	const add = (jobId: string, run: P5BackgroundJob["run"], workspaceId = "a") =>
		scheduler.enqueue({ workspaceId, jobId, run });
	const check = (workspaceId = "a") => spend.check({ workspaceId, metered: true });
	return { scheduler, enabled, clock, add, check, spend };
}

it("never admits a disabled workspace", async () => {
	const f = fixture();
	f.enabled.clear();
	const run = vi.fn(async () => known);
	await expect(f.add("disabled", run)).rejects.toThrow("disabled");
	expect(run).not.toHaveBeenCalled();
	expect(await f.check()).toBe("allowed");
	await f.scheduler.dispose();
});

it("runs FIFO with only one active item per workspace", async () => {
	const f = fixture();
	const started = deferred<void>();
	const release = deferred<void>();
	const order: string[] = [];
	const first = f.add("first", async () => {
		order.push("first:start");
		started.resolve();
		await release.promise;
		order.push("first:end");
		return known;
	});
	const second = f.add("second", async () => {
		order.push("second");
		return known;
	});
	const third = f.add("third", async () => {
		order.push("third");
		return known;
	});
	await started.promise;
	expect(order).toEqual(["first:start"]);
	release.resolve();
	await Promise.all([first, second, third]);
	expect(order).toEqual(["first:start", "first:end", "second", "third"]);
	await f.scheduler.dispose();
});

it("rechecks the host setting before each queued item", async () => {
	const f = fixture();
	const started = deferred<void>();
	const release = deferred<void>();
	const first = f.add("first", async () => {
		started.resolve();
		await release.promise;
		return known;
	});
	const run = vi.fn(async () => known);
	const second = expect(f.add("second", run)).rejects.toThrow("disabled");
	await started.promise;
	f.enabled.delete("a");
	release.resolve();
	await Promise.all([first, second]);
	expect(run).not.toHaveBeenCalled();
	await f.scheduler.dispose();
});

it("disable aborts the current signal and cancels queued items without blocking other workspaces", async () => {
	const f = fixture();
	const started = deferred<AbortSignal>();
	const release = deferred<void>();
	const first = expect(
		f.add("first", async (signal) => {
			started.resolve(signal);
			await release.promise;
			return known;
		}),
	).rejects.toThrow("cancelled");
	const run = vi.fn(async () => known);
	const second = expect(f.add("second", run)).rejects.toThrow("cancelled");
	const signal = await started.promise;
	f.enabled.delete("a");
	f.scheduler.disable("a");
	expect(signal.aborted).toBe(true);
	await second;
	expect(run).not.toHaveBeenCalled();
	await expect(f.add("independent", async () => known, "b")).resolves.toMatchObject({
		usage: { ...known, metered: true },
		finishedAt: f.clock.now.toISOString(),
	});
	release.resolve();
	await first;
	await f.scheduler.dispose();
});

it("finishes an over-limit item, records its input/output/cache writes, and denies the rest", async () => {
	const f = fixture(10);
	const first = f.add("overshoot", async () => ({ ...known, cacheWriteTokens: 2 }));
	const run = vi.fn(async () => known);
	const second = expect(f.add("blocked", run)).rejects.toThrow("budget");
	await expect(first).resolves.toMatchObject({ usage: { cacheWriteTokens: 2 } });
	await second;
	expect(await f.check()).toBe("denied");
	expect(await f.check("b")).toBe("allowed");
	expect(run).not.toHaveBeenCalled();
	await f.scheduler.dispose();
});

it("unknown usage blocks only that workspace until the next local day", async () => {
	const f = fixture();
	await f.add("unknown", async () => ({
		state: "unknown",
		inputTokens: null,
		outputTokens: null,
		cost: null,
	}));
	await expect(f.add("same-day", async () => known)).rejects.toThrow("budget");
	await f.add("other-workspace", async () => known, "b");
	const utcDay = f.clock.now.toISOString().slice(0, 10);
	f.clock.now = new Date("2026-11-19T00:00:00+08:00");
	expect(f.clock.now.toISOString().slice(0, 10)).toBe(utcDay);
	await expect(f.add("next-day", async () => known)).resolves.toMatchObject({
		usage: { metered: true },
	});
	expect(await f.check()).toBe("allowed");
	await f.scheduler.dispose();
});

it("excludes cache reads from the explicit 10M default budget", async () => {
	const f = fixture("default");
	await f.add("cached", async () => ({
		...known,
		inputTokens: 4_000_000,
		outputTokens: 3_000_000,
		cacheReadTokens: 50_000_000,
		cacheWriteTokens: 2_999_999,
	}));
	await f.add("last-token", async () => ({ ...known, inputTokens: 1, outputTokens: 0 }));
	await expect(f.add("exhausted", async () => known)).rejects.toThrow("budget");
	f.clock.now = new Date("2026-11-19T00:00:00+08:00");
	await f.add("reset", async () => known);
	await f.scheduler.dispose();
});

it("dispose aborts all jobs and awaits running work and usage persistence", async () => {
	const f = fixture(9);
	const started = deferred<AbortSignal>();
	const release = deferred<void>();
	const first = expect(
		f.add("running", async (signal) => {
			started.resolve(signal);
			await release.promise;
			return known;
		}),
	).rejects.toThrow("cancelled");
	const run = vi.fn(async () => known);
	const second = expect(f.add("queued", run)).rejects.toThrow("cancelled");
	const signal = await started.promise;
	const drained = vi.fn();
	const disposal = f.scheduler.dispose().then(drained);
	expect(signal.aborted).toBe(true);
	await second;
	expect(drained).not.toHaveBeenCalled();
	await expect(f.add("late", run)).rejects.toThrow("disposed");
	release.resolve();
	await Promise.all([first, disposal]);
	expect(await f.check()).toBe("denied");
	expect(run).not.toHaveBeenCalled();
	await f.scheduler.dispose();
});

it("rejects duplicate IDs across workspaces and after completion", async () => {
	const f = fixture();
	const started = deferred<void>();
	const release = deferred<void>();
	const first = f.add("unique", async () => {
		started.resolve();
		await release.promise;
		return known;
	});
	await started.promise;
	await expect(f.add("unique", async () => known, "b")).rejects.toThrow("Duplicate");
	release.resolve();
	await first;
	await expect(f.add("unique", async () => known)).rejects.toThrow("Duplicate");
	await f.scheduler.dispose();
});

it("cancels one queued item without running it or disturbing FIFO", async () => {
	const f = fixture(18);
	const started = deferred<void>();
	const release = deferred<void>();
	const first = f.add("first", async () => {
		started.resolve();
		await release.promise;
		return known;
	});
	const run = vi.fn(async () => known);
	const second = expect(f.add("cancelled", run)).rejects.toThrow("cancelled");
	const third = f.add("third", async () => known);
	await started.promise;
	expect(f.scheduler.cancel("cancelled")).toBe(true);
	await second;
	expect(f.scheduler.cancel("cancelled")).toBe(false);
	expect(f.scheduler.cancel("missing")).toBe(false);
	release.resolve();
	await Promise.all([first, third]);
	expect(run).not.toHaveBeenCalled();
	expect(await f.check()).toBe("denied");
	await f.scheduler.dispose();
});

it("records unknown usage when a running job throws and denies the remaining queue", async () => {
	const f = fixture();
	const failure = new Error("Model request failed");
	const first = expect(
		f.add("failed", async () => {
			throw failure;
		}),
	).rejects.toBe(failure);
	const run = vi.fn(async () => known);
	const second = expect(f.add("blocked", run)).rejects.toThrow("budget");
	await Promise.all([first, second]);
	expect(await f.check()).toBe("denied");
	expect(run).not.toHaveBeenCalled();
	await f.scheduler.dispose();
});

it("rechecks consent after a pending real ledger check before starting a model job", async () => {
	const f = fixture();
	const checked = deferred<void>();
	const release = deferred<void>();
	const scheduler = createP5BackgroundScheduler({
		clock: () => f.clock.now,
		isEnabled: (workspaceId) => f.enabled.has(workspaceId),
		spend: {
			record: f.spend.record,
			check: async (scope) => {
				const result = await f.spend.check(scope);
				checked.resolve();
				await release.promise;
				return result;
			},
		},
	});
	const run = vi.fn(async () => known);
	const denied = expect(scheduler.enqueue({ workspaceId: "a", jobId: "race", run })).rejects.toThrow(
		"disabled",
	);
	await checked.promise;
	f.enabled.delete("a");
	release.resolve();
	await denied;
	expect(run).not.toHaveBeenCalled();
	await scheduler.dispose();
	await f.scheduler.dispose();
});

it("halts a workspace after ledger persistence fails instead of trusting stale totals", async () => {
	const f = fixture();
	const failure = new Error("Ledger write failed");
	const scheduler = createP5BackgroundScheduler({
		clock: () => f.clock.now,
		isEnabled: (workspaceId) => f.enabled.has(workspaceId),
		spend: {
			check: f.spend.check,
			record: async (usage) => {
				if (usage.workspaceId === "a") throw failure;
				await f.spend.record(usage);
			},
		},
	});
	const run = vi.fn(async () => known);
	const first = expect(scheduler.enqueue({ workspaceId: "a", jobId: "failed", run })).rejects.toBe(failure);
	const second = expect(scheduler.enqueue({ workspaceId: "a", jobId: "queued", run })).rejects.toBe(failure);
	await Promise.all([first, second]);
	expect(await f.check()).toBe("allowed");
	await expect(scheduler.enqueue({ workspaceId: "a", jobId: "later", run })).rejects.toBe(failure);
	expect(run).toHaveBeenCalledTimes(1);
	await scheduler.enqueue({ workspaceId: "b", jobId: "independent", run });
	await scheduler.dispose();
	await f.scheduler.dispose();
});
