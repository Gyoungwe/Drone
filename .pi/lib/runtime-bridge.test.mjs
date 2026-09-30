import assert from "node:assert/strict";
import test from "node:test";
import { createStandaloneRuntime, runRuntimeExclusive, runtimeSlot, withRuntime } from "./runtime-bridge.mjs";

const pool = runtimeSlot("knowledge", "workerPool", () => new Map(), "drone.test.worker-pool.v1");

test("runtime slots are isolated across two injected runtimes", async () => {
	const first = createStandaloneRuntime();
	const second = createStandaloneRuntime();

	await withRuntime(first, () => pool.set("owner", "first"));
	await withRuntime(second, () => pool.set("owner", "second"));

	assert.equal(await withRuntime(first, () => pool.get("owner")), "first");
	assert.equal(await withRuntime(second, () => pool.get("owner")), "second");
	assert.notEqual(first.knowledge.workerPool, second.knowledge.workerPool);

	await Promise.all([first.dispose(), second.dispose()]);
});

test("runtime scheduler serializes only the same runtime key", async () => {
	const first = createStandaloneRuntime();
	const second = createStandaloneRuntime();
	const events = [];
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	const firstA = withRuntime(first, () =>
		runRuntimeExclusive(
			"test",
			"same",
			async () => {
				events.push("first:start");
				await wait(15);
				events.push("first:end");
			},
			"drone.test.queue.v1",
		),
	);
	const firstB = withRuntime(first, () =>
		runRuntimeExclusive("test", "same", async () => events.push("first:queued"), "drone.test.queue.v1"),
	);
	const secondA = withRuntime(second, () =>
		runRuntimeExclusive("test", "same", async () => events.push("second:independent"), "drone.test.queue.v1"),
	);
	await Promise.all([firstA, firstB, secondA]);

	assert.ok(events.indexOf("first:end") < events.indexOf("first:queued"));
	assert.ok(events.indexOf("second:independent") < events.indexOf("first:end"));
	await Promise.all([first.dispose(), second.dispose()]);
});

test("an implicit standalone runtime serializes work without a global bridge", async () => {
	const events = [];
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const first = runRuntimeExclusive("standalone", "same", async () => {
		events.push("start");
		await wait(10);
		events.push("end");
	});
	const second = runRuntimeExclusive("standalone", "same", async () => events.push("queued"));
	await Promise.all([first, second]);
	assert.deepEqual(events, ["start", "end", "queued"]);
});
