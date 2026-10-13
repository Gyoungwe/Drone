import { describe, expect, it } from "vitest";
import { assignToolStartTimes, toSessionMessages } from "../src/session/messages";

const T0 = Date.parse("2026-10-13T08:00:00.000Z");
const raw = [
	{
		role: "assistant",
		timestamp: T0 - 4000,
		content: [
			{ type: "toolCall", id: "a", name: "read", arguments: { path: "x" } },
			{ type: "toolCall", id: "b", name: "bash", arguments: { command: "ls" } },
		],
	},
	{ role: "toolResult", toolCallId: "a", toolName: "read", content: "ok", timestamp: T0 + 300 },
	{ role: "toolResult", toolCallId: "b", toolName: "bash", content: "ok", timestamp: T0 + 1800 },
];
const entry = (timestamp: string | undefined) =>
	[
		{
			type: "message",
			id: "m1",
			parentId: null,
			timestamp,
			message: { role: "assistant", timestamp: T0 - 4000 },
		},
	] as never;

describe("history tool start times", () => {
	it("uses the assistant entry append time as each tool's start", () => {
		const messages = toSessionMessages(raw as never);
		assignToolStartTimes(messages, entry("2026-10-13T08:00:00.000Z"));
		const tools = messages.find((m) => m.role === "assistant")?.tools ?? [];
		expect(tools.map((t) => [t.startedAt, t.endedAt])).toEqual([
			[T0, T0 + 300],
			[T0, T0 + 1800],
		]);
	});
	it("leaves startedAt unset when the entry time is missing or after the tool ended", () => {
		for (const ts of [undefined, "2026-10-13T08:00:05.000Z"]) {
			const messages = toSessionMessages(raw as never);
			assignToolStartTimes(messages, entry(ts));
			const tools = messages.find((m) => m.role === "assistant")?.tools ?? [];
			expect(tools.every((t) => t.startedAt === undefined)).toBe(true);
		}
	});
});
