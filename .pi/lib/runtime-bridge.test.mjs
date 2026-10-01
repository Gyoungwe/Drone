import assert from "node:assert/strict";
import test from "node:test";
import {
	bindRuntime,
	createStandaloneRuntime,
	runRuntimeExclusive,
	runtimeForHost,
	runtimeSlot,
	withHostRuntime,
	withRuntime,
} from "./runtime-bridge.mjs";

const pool = runtimeSlot("knowledge", "workerPool", () => new Map());

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
		runRuntimeExclusive("test", "same", async () => {
			events.push("first:start");
			await wait(15);
			events.push("first:end");
		}),
	);
	const firstB = withRuntime(first, () =>
		runRuntimeExclusive("test", "same", async () => events.push("first:queued")),
	);
	const secondA = withRuntime(second, () =>
		runRuntimeExclusive("test", "same", async () => events.push("second:independent")),
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

test("dynamic hosts receive only their announced runtime", async () => {
	const first = createStandaloneRuntime();
	const second = createStandaloneRuntime();
	const makeHost = () => {
		const listeners = new Map();
		return {
			events: {
				on(name, handler) {
					listeners.set(name, handler);
				},
				emit(name, payload) {
					if (name === "drone:runtime/request/v1") listeners.get("drone:runtime/v1")?.(payload);
				},
			},
			announce(runtime) {
				listeners.get("drone:runtime/v1")?.({ version: 1, runtime });
			},
		};
	};
	const firstHost = makeHost();
	const secondHost = makeHost();
	bindRuntime(firstHost);
	bindRuntime(secondHost);
	firstHost.announce(first);
	secondHost.announce(second);
	const slot = runtimeSlot("knowledge", "host-isolation", () => new Map());
	await withHostRuntime(firstHost, () => slot.set("owner", "first"));
	await withHostRuntime(secondHost, () => slot.set("owner", "second"));
	assert.equal(await withHostRuntime(firstHost, () => slot.get("owner")), "first");
	assert.equal(await withHostRuntime(secondHost, () => slot.get("owner")), "second");
	await Promise.all([first.dispose(), second.dispose()]);
});

test("CLI hosts receive independent standalone runtimes", async () => {
	const firstHost = {};
	const secondHost = {};
	const disposeFirst = bindRuntime(firstHost);
	const disposeSecond = bindRuntime(secondHost);
	assert.notEqual(runtimeForHost(firstHost), runtimeForHost(secondHost));

	const slot = runtimeSlot("knowledge", "cli-host-isolation", () => new Map());
	await withHostRuntime(firstHost, () => slot.set("owner", "first"));
	await withHostRuntime(secondHost, () => slot.set("owner", "second"));
	assert.equal(await withHostRuntime(firstHost, () => slot.get("owner")), "first");
	assert.equal(await withHostRuntime(secondHost, () => slot.get("owner")), "second");

	disposeFirst();
	disposeSecond();
});

test("disposing one host runtime rejects only that host's future work", async () => {
	const first = createStandaloneRuntime();
	const second = createStandaloneRuntime();
	const makeHost = () => {
		const listeners = new Map();
		return {
			events: {
				on(name, handler) {
					listeners.set(name, handler);
				},
				emit(name, payload) {
					if (name === "drone:runtime/request/v1") listeners.get("drone:runtime/v1")?.(payload);
				},
			},
			announce(runtime) {
				listeners.get("drone:runtime/v1")?.({ version: 1, runtime });
			},
		};
	};
	const firstHost = makeHost();
	const secondHost = makeHost();
	bindRuntime(firstHost);
	bindRuntime(secondHost);
	firstHost.announce(first);
	secondHost.announce(second);

	await first.dispose();
	await assert.rejects(
		withHostRuntime(firstHost, () => runRuntimeExclusive("dispose", "first", async () => {})),
		/Runtime scheduler has been disposed/,
	);
	await withHostRuntime(secondHost, () =>
		runRuntimeExclusive("dispose", "second", async () => "still available"),
	);
	await second.dispose();
});
