import { describe, expect, it, vi } from "vitest";
import { HostEventBridge } from "./host-event-bridge";

describe("HostEventBridge", () => {
	it("assigns increasing envelope sequences without changing payloads", () => {
		const bridge = new HostEventBridge();
		const signal = new AbortController().signal;
		const source = bridge.source(["inquiry.compute", "inquiry.decision"], signal);
		const computePayload = { id: "compute-1", type: "collected" };
		const decisionPayload = { id: "decision-1", kind: "review", summary: "accepted" };
		const received: unknown[] = [];
		source.subscribe("inquiry.compute", (event) => received.push(event));
		source.subscribe("inquiry.decision", (event) => received.push(event));

		bridge.publish("inquiry.compute", computePayload);
		bridge.publish("inquiry.decision", decisionPayload);

		expect(received).toEqual([
			{ topic: "inquiry.compute", sequence: 1, payload: computePayload },
			{ topic: "inquiry.decision", sequence: 2, payload: decisionPayload },
		]);
		expect((received[0] as { payload: unknown }).payload).toBe(computePayload);
		expect("sequence" in computePayload).toBe(false);
	});

	it("delivers only topics declared to the source and rejects other names", () => {
		const bridge = new HostEventBridge();
		const source = bridge.source(["inquiry.compute"], new AbortController().signal);
		const listener = vi.fn();
		source.subscribe("inquiry.compute", listener);
		expect(() => source.subscribe("inquiry.decision", listener)).toThrow("not declared");
		expect(() => source.subscribe("unknown.topic", listener)).toThrow("not declared");
		bridge.publish("inquiry.decision", { id: "decision-1" });
		bridge.publish("inquiry.compute", { id: "compute-1" });
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("makes unsubscribe idempotent", () => {
		const bridge = new HostEventBridge();
		const source = bridge.source(["inquiry.compute"], new AbortController().signal);
		const listener = vi.fn();
		const unsubscribe = source.subscribe("inquiry.compute", listener);

		unsubscribe();
		unsubscribe();
		bridge.publish("inquiry.compute", { id: "compute-1" });
		expect(listener).not.toHaveBeenCalled();
	});

	it("removes every subscription when aborted and rejects future subscriptions", () => {
		const bridge = new HostEventBridge();
		const abort = new AbortController();
		const source = bridge.source(["inquiry.compute", "inquiry.decision"], abort.signal);
		const listener = vi.fn();
		source.subscribe("inquiry.compute", listener);
		source.subscribe("inquiry.decision", listener);

		abort.abort();
		bridge.publish("inquiry.compute", { id: "compute-1" });
		expect(listener).not.toHaveBeenCalled();
		expect(() => source.subscribe("inquiry.compute", listener)).toThrow("aborted");
	});

	it("removes a throwing listener, reports it, and continues delivery", () => {
		const bridge = new HostEventBridge();
		const source = bridge.source(["inquiry.compute"], new AbortController().signal);
		const failed = vi.fn(() => {
			throw new Error("listener failed");
		});
		const healthy = vi.fn();
		source.subscribe("inquiry.compute", failed);
		source.subscribe("inquiry.compute", healthy);

		expect(() => bridge.publish("inquiry.compute", { id: "compute-1" })).not.toThrow();
		bridge.publish("inquiry.compute", { id: "compute-2" });
		expect(failed).toHaveBeenCalledTimes(1);
		expect(healthy).toHaveBeenCalledTimes(2);
	});
});
