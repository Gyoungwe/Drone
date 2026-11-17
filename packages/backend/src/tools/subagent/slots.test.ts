import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { acquireNativeSubagentSlot, withNativeSubagentSlot } from "./slots";

async function setupSlots() {
	const cwd = await mkdtemp(join(tmpdir(), "drone-subagent-slots-"));
	const releases: Array<() => void> = [];
	const requests: Array<Promise<() => void>> = [];
	const controllers: AbortController[] = [];
	onTestFinished(async () => {
		for (const controller of controllers) controller.abort();
		await Promise.allSettled(requests);
		for (const release of releases) release();
	});
	const acquire = (project = cwd, signal?: AbortSignal) => {
		const request = acquireNativeSubagentSlot(project, signal).then((release) => {
			releases.push(release);
			return release;
		});
		requests.push(request);
		return request;
	};
	const enqueue = async (project = cwd) => {
		const controller = new AbortController();
		controllers.push(controller);
		// Observe queue entry after the real config read without relying on elapsed time.
		const enqueued = new Promise<void>((resolveEnqueued) => {
			const addEventListener = controller.signal.addEventListener.bind(controller.signal);
			vi.spyOn(controller.signal, "addEventListener").mockImplementationOnce((type, listener, options) => {
				addEventListener(type, listener, options);
				resolveEnqueued();
			});
		});
		const acquired = acquire(project, controller.signal);
		await enqueued;
		return { acquired, controller };
	};
	return { cwd, acquire, enqueue };
}

it("allows three default-project slots and admits other projects in FIFO order", async () => {
	const slots = await setupSlots();
	const release = await slots.acquire();
	await slots.acquire();
	await slots.acquire();
	const other = await mkdtemp(join(tmpdir(), "drone-subagent-other-"));
	const admitted: string[] = [];
	const first = await slots.enqueue(other);
	const firstRelease = first.acquired.then((release) => {
		admitted.push("first");
		return release;
	});
	const second = await slots.enqueue(other);
	const secondRelease = second.acquired.then((release) => {
		admitted.push("second");
		return release;
	});
	expect(admitted).toEqual([]);
	release();
	const releaseFirst = await firstRelease;
	expect(admitted).toEqual(["first"]);
	releaseFirst();
	(await secondRelease)();
	expect(admitted).toEqual(["first", "second"]);
});

it("skips a project at its configured limit while another project proceeds", async () => {
	const slots = await setupSlots();
	await mkdir(join(slots.cwd, ".pi"));
	await writeFile(join(slots.cwd, ".pi/research-workspace.json"), '{"maxConcurrentSubagents":1}');
	const release = await slots.acquire();
	const admitted: string[] = [];
	const blocked = await slots.enqueue();
	const blockedRelease = blocked.acquired.then((release) => {
		admitted.push("limited");
		return release;
	});
	const other = await mkdtemp(join(tmpdir(), "drone-subagent-other-"));
	const eligible = await slots.enqueue(other);
	(await eligible.acquired)();
	expect(admitted).toEqual([]);
	release();
	(await blockedRelease)();
	expect(admitted).toEqual(["limited"]);
});

it("a double release admits only one waiter", async () => {
	const slots = await setupSlots();
	const release = await slots.acquire();
	await slots.acquire();
	await slots.acquire();
	const admitted: string[] = [];
	const first = await slots.enqueue();
	const firstRelease = first.acquired.then((release) => {
		admitted.push("first");
		return release;
	});
	const second = await slots.enqueue();
	const secondRelease = second.acquired.then((release) => {
		admitted.push("second");
		return release;
	});
	release();
	release();
	const releaseFirst = await firstRelease;
	expect(admitted).toEqual(["first"]);
	releaseFirst();
	(await secondRelease)();
	expect(admitted).toEqual(["first", "second"]);
});

it("cancels a queued acquire without admitting an extra waiter", async () => {
	const slots = await setupSlots();
	const release = await slots.acquire();
	await slots.acquire();
	await slots.acquire();
	const cancelled = await slots.enqueue();
	const admitted: string[] = [];
	const waiting = await slots.enqueue();
	const waitingRelease = waiting.acquired.then((release) => {
		admitted.push("waiting");
		return release;
	});
	const rejection = expect(cancelled.acquired).rejects.toThrow("Native subagent cancelled while queued");
	cancelled.controller.abort();
	await rejection;
	expect(admitted).toEqual([]);
	release();
	(await waitingRelease)();
	expect(admitted).toEqual(["waiting"]);
});

it("keeps the queue ceiling at 32 and rejects overflow with the same message", async () => {
	const slots = await setupSlots();
	await slots.acquire();
	await slots.acquire();
	await slots.acquire();
	for (let index = 0; index < 32; index++) await slots.enqueue();
	await expect(slots.acquire()).rejects.toThrow("Native subagent queue is full");
});

it("releases the wrapper slot after success and preserves its result", async () => {
	const slots = await setupSlots();
	await slots.acquire();
	await slots.acquire();
	await expect(withNativeSubagentSlot(slots.cwd, undefined, async () => "completed")).resolves.toBe(
		"completed",
	);
	(await slots.acquire())();
});

it("releases the wrapper slot when work throws and preserves the error", async () => {
	const slots = await setupSlots();
	await slots.acquire();
	await slots.acquire();
	const failure = new Error("Work failed");
	await expect(
		withNativeSubagentSlot(slots.cwd, undefined, async () => {
			throw failure;
		}),
	).rejects.toBe(failure);
	(await slots.acquire())();
});

it("rejects an already-aborted signal before entering the queue", async () => {
	const slots = await setupSlots();
	const reason = new Error("Already cancelled");
	const signal = AbortSignal.abort(reason);
	const addEventListener = vi.spyOn(signal, "addEventListener");
	await expect(slots.acquire(slots.cwd, signal)).rejects.toBe(reason);
	expect(addEventListener).not.toHaveBeenCalled();
	await slots.acquire();
	await slots.acquire();
	await slots.acquire();
});

it("returns a release when aborted after a queued slot is granted", async () => {
	const slots = await setupSlots();
	const release = await slots.acquire();
	await slots.acquire();
	await slots.acquire();
	const waiting = await slots.enqueue();
	release();
	waiting.controller.abort();
	(await waiting.acquired)();
	(await slots.acquire())();
});

it("the wrapper skips work and releases when aborted between grant and start", async () => {
	const slots = await setupSlots();
	const release = await slots.acquire();
	await slots.acquire();
	await slots.acquire();
	const controller = new AbortController();
	const work = vi.fn(async () => "unexpected");
	const addEventListener = vi.spyOn(controller.signal, "addEventListener");
	const result = withNativeSubagentSlot(slots.cwd, controller.signal, work);
	await vi.waitFor(() => expect(addEventListener).toHaveBeenCalled());
	const reason = new Error("Cancelled before work");
	const rejection = expect(result).rejects.toBe(reason);
	release();
	controller.abort(reason);
	await rejection;
	expect(work).not.toHaveBeenCalled();
	(await slots.acquire())();
});
