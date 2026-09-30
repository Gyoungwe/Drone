import { describe, expect, it } from "vitest";
import { createEventPipeline, runEventPipeline, type Stage } from "../src/session/event-pipeline";

type Context = { seen: string[] };
const stage = (
	name: string,
	run: Stage<number, Context>["run"],
	failMode: Stage<number, Context>["failMode"] = "closed",
): Stage<number, Context> => ({ name, run, failMode });

describe("event pipeline", () => {
	it("runs stages in declaration order", () => {
		const order: string[] = [];
		const stages = [1, 2, 3].map((n) =>
			stage(String(n), (event) => {
				order.push(String(n));
				return event + 1;
			}),
		);
		expect(runEventPipeline(stages, 0, { seen: [] })).toBe(3);
		expect(order).toEqual(["1", "2", "3"]);
	});

	it("closed failure suppresses the event and stops later stages", () => {
		const ran: string[] = [];
		const result = createEventPipeline([
			stage("closed", () => {
				throw new Error("boom");
			}),
			stage("later", (event) => {
				ran.push(String(event));
				return event;
			}),
		]).run(7, { seen: [] });
		expect(result).toBeNull();
		expect(ran).toEqual([]);
	});

	it("open failure is recorded and the original event continues", () => {
		const failures: unknown[] = [];
		const result = createEventPipeline(
			[
				stage(
					"trace",
					() => {
						throw new Error("trace failed");
					},
					"open",
				),
				stage("next", (event) => event + 2),
			],
			{ onError: (failure) => failures.push(failure) },
		).run(3, { seen: [] });
		expect(result).toBe(5);
		expect(failures).toHaveLength(1);
	});

	it("a stage returning null suppresses downstream stages", () => {
		const ran: string[] = [];
		const result = createEventPipeline([
			stage("filter", () => null),
			stage("downstream", (event) => {
				ran.push(String(event));
				return event;
			}),
		]).run(1, { seen: [] });
		expect(result).toBeNull();
		expect(ran).toEqual([]);
	});
});
