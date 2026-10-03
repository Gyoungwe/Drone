import { describe, expect, it } from "vitest";
import { createEventPipeline, runEventPipeline, type Stage } from "../src/session-engine/event-pipeline";

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

	it.each([
		{ name: "publication", failMode: "closed" as const, expected: null, laterRuns: false },
		{ name: "trace", failMode: "open" as const, expected: 5, laterRuns: true },
	])("$name failure follows its $failMode policy", ({ name, failMode, expected, laterRuns }) => {
		const ran: number[] = [];
		const failures: Array<{ stage: string; event: number; context: Context; error: unknown }> = [];
		const result = createEventPipeline(
			[
				stage(
					name,
					() => {
						throw new Error(`${name} failed`);
					},
					failMode,
				),
				stage("next", (event) => {
					ran.push(event);
					return event + 2;
				}),
			],
			{
				onError: (failure) => failures.push(failure),
			},
		).run(3, { seen: [] });

		expect(result).toBe(expected);
		expect(ran).toEqual(laterRuns ? [3] : []);
		expect(failures).toHaveLength(failMode === "open" ? 1 : 0);
		if (failMode === "open") {
			expect(failures[0]).toMatchObject({ stage: { name }, event: 3, context: { seen: [] } });
			expect(failures[0]?.error).toBeInstanceOf(Error);
		}
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
