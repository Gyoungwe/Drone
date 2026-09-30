import { describe, expect, it } from "vitest";
import { KeyedScheduler } from "./runtime";

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
