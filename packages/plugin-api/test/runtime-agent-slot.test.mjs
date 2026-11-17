import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { withPluginAgentSlot } from "../dist/runtime.js";

function capabilities(release = async () => ({ released: true })) {
	const call = mock.fn(async (name, input, signal) => {
		if (name === "agent.slot.acquire") {
			assert.deepEqual(input, {});
			return { lease: "test-lease" };
		}
		assert.equal(name, "agent.slot.release");
		assert.deepEqual(input, { lease: "test-lease" });
		assert.equal(signal, undefined);
		return release();
	});
	return { port: { call }, call };
}

test("holds a slot throughout work, releases it, and preserves the result", async () => {
	const { port, call } = capabilities();
	const signal = new AbortController().signal;
	const result = { completed: true };
	const work = mock.fn(async () => {
		assert.equal(call.mock.callCount(), 1);
		return result;
	});
	assert.equal(await withPluginAgentSlot(port, signal, work), result);
	assert.equal(work.mock.callCount(), 1);
	assert.equal(call.mock.callCount(), 2);
	assert.equal(call.mock.calls[0].arguments[2], signal);
});

for (const releaseFails of [false, true]) {
	test(`releases on work failure and preserves that error when release fails: ${releaseFails}`, async () => {
		const workError = new Error("Work failed");
		const { port, call } = capabilities(async () => {
			if (releaseFails) throw new Error("Release failed");
			return { released: true };
		});
		await assert.rejects(
			withPluginAgentSlot(port, undefined, async () => {
				throw workError;
			}),
			(error) => error === workError,
		);
		assert.equal(call.mock.callCount(), 2);
	});
}

test("releases after an aborted signal prevents work", async () => {
	const { port, call } = capabilities();
	const reason = new Error("Cancelled before work");
	const signal = AbortSignal.abort(reason);
	const work = mock.fn(async () => "unexpected");
	await assert.rejects(withPluginAgentSlot(port, signal, work), (error) => error === reason);
	assert.equal(work.mock.callCount(), 0);
	assert.equal(call.mock.callCount(), 2);
});

test("reports a release failure after successful work", async () => {
	const failure = new Error("Release failed");
	const { port, call } = capabilities(async () => {
		throw failure;
	});
	await assert.rejects(
		withPluginAgentSlot(port, undefined, async () => "done"),
		(error) => error === failure,
	);
	assert.equal(call.mock.callCount(), 2);
});

test("does not start work or release when acquisition fails", async () => {
	const failure = new Error("Queue full");
	const call = mock.fn(async () => {
		throw failure;
	});
	const work = mock.fn(async () => "unexpected");
	await assert.rejects(withPluginAgentSlot({ call }, undefined, work), (error) => error === failure);
	assert.equal(work.mock.callCount(), 0);
	assert.equal(call.mock.callCount(), 1);
});
