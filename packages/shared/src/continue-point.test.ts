import { describe, expect, it } from "vitest";
import { findContinuePoint } from "./error-codes";

describe("H3 findContinuePoint", () => {
	it("returns the last unfinished tool since the last user message", () => {
		const messages = [
			{ kind: "user" },
			{ kind: "assistant", tools: [{ name: "read", state: "done" }] },
			{
				kind: "assistant",
				tools: [
					{ name: "grep", state: "done" },
					{ name: "bash", state: "error" },
				],
			},
			{ kind: "error" },
		];
		expect(findContinuePoint(messages, 3)).toEqual({ step: 3, tool: "bash" });
	});
	it("returns undefined when everything finished or a newer user turn exists", () => {
		expect(
			findContinuePoint([{ kind: "assistant", tools: [{ name: "read", state: "done" }] }]),
		).toBeUndefined();
		expect(
			findContinuePoint([{ kind: "assistant", tools: [{ name: "x", state: "error" }] }, { kind: "user" }]),
		).toBeUndefined();
	});
});
