import { describe, expect, it } from "vitest";
import { runOverview } from "./run-overview";

const tool = (name: string, args: string) => ({
	key: name + args,
	id: "",
	name,
	args,
	output: "",
	state: "done",
});

describe("runOverview", () => {
	it("collects stages, tool count and unique changed files", () => {
		const messages = [
			{ kind: "user", id: "u", text: "hi", timestamp: 1 },
			{
				kind: "assistant",
				id: "a",
				text: "",
				thinking: "",
				timestamp: 1,
				progress: { kind: "plan", text: "检索" },
				tools: [tool("webfetch", "{}"), tool("edit", '{"path":"a.md"}')],
			},
			{
				kind: "assistant",
				id: "b",
				text: "",
				thinking: "",
				timestamp: 2,
				tools: [tool("write", '{"path":"a.md"}'), tool("write", "not json")],
			},
		] as never;
		expect(runOverview(messages)).toEqual({ stages: [{ id: "a", text: "检索" }], tools: 4, files: ["a.md"] });
	});
});
