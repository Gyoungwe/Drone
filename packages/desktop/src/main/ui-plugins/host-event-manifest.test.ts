import { describe, expect, it } from "vitest";
import { parseHostEventsDeclaration } from "./host-event-manifest";

describe("parseHostEventsDeclaration", () => {
	it("returns a sorted copy of a valid declaration", () => {
		expect(parseHostEventsDeclaration(["inquiry.task-terminal", "inquiry.compute"])).toEqual([
			"inquiry.compute",
			"inquiry.task-terminal",
		]);
	});

	it.each(["inquiry.compute", null, {}, [], ["inquiry.compute", 1], ["inquiry.compute", "inquiry.compute"]])(
		"rejects an invalid declaration: %j",
		(value) => {
			expect(() => parseHostEventsDeclaration(value)).toThrow(
				"drone.hostEvents must be a non-empty list of distinct known host event topics",
			);
		},
	);

	it("includes the unknown topic in its error", () => {
		expect(() => parseHostEventsDeclaration(["inquiry.unknown"])).toThrow("inquiry.unknown");
	});
});
