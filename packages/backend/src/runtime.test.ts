import { describe, expect, it } from "vitest";
import { createDroneRuntime, KeyedScheduler } from "./runtime";

describe("KeyedScheduler", () => {
	it("serializes the same key while allowing independent keys", async () => {
		const scheduler = new KeyedScheduler();
		const order: string[] = [];
		const first = scheduler.run("same", async () => {
			order.push("first:start");
			await new Promise((resolve) => setTimeout(resolve, 5));
			order.push("first:end");
		});
		const second = scheduler.run("same", async () => order.push("second"));
		await Promise.all([first, second]);
		expect(order).toEqual(["first:start", "first:end", "second"]);
		await scheduler.dispose();
		await expect(scheduler.run("after-dispose", () => undefined)).rejects.toThrow("disposed");
	});
});

describe("createDroneRuntime", () => {
	it("owns and disposes resources registered by runtime slots", async () => {
		const runtime = createDroneRuntime();
		let disposed = 0;
		runtime.registerDisposable?.({ dispose: () => void disposed++ });
		await runtime.dispose();
		await runtime.dispose();
		expect(disposed).toBe(1);
		await expect(runtime.scheduler.run("after-dispose", () => undefined)).rejects.toThrow("disposed");
	});

	it("does not dispose a slot after its registration is removed", async () => {
		const runtime = createDroneRuntime();
		let disposed = 0;
		const unregister = runtime.registerDisposable?.({ dispose: () => void disposed++ });
		unregister?.();
		await runtime.dispose();
		expect(disposed).toBe(0);
	});
});

describe("runtime event bus", () => {
	it("isolates event delivery between backend runtimes", async () => {
		const first = createDroneRuntime();
		const second = createDroneRuntime();
		const firstEvents: unknown[] = [];
		const secondEvents: unknown[] = [];
		first.events.on("knowledge-deposited", (payload) => firstEvents.push(payload));
		second.events.on("knowledge-deposited", (payload) => secondEvents.push(payload));

		first.events.emit("knowledge-deposited", { cwd: "/first" });
		second.events.emit("knowledge-deposited", { cwd: "/second" });

		expect(firstEvents).toEqual([{ cwd: "/first" }]);
		expect(secondEvents).toEqual([{ cwd: "/second" }]);
		await first.dispose();
		await second.dispose();
	});

	it("detaches listeners when a runtime is disposed", async () => {
		const runtime = createDroneRuntime();
		const received: unknown[] = [];
		runtime.events.on("changed", (payload) => received.push(payload));
		await runtime.dispose();
		runtime.events.emit("changed", { value: 1 });
		expect(received).toEqual([]);
	});
});
