import { expect, it } from "vitest";
import { restoreTaskToolOrder as repair } from "../../../.pi/lib/tasks/tool-protocol.mjs";

const assistant = {
	role: "assistant",
	content: [
		{ type: "thinking", thinking: "signed", thinkingSignature: "signature" },
		{ type: "toolCall", id: "a", name: "read", arguments: { path: "a" } },
		{ type: "toolCall", id: "b", name: "read", arguments: { path: "b" } },
	],
};
const a = { role: "toolResult", toolCallId: "a", content: [] },
	b = { role: "toolResult", toolCallId: "b", content: [] };
const status = { role: "custom", customType: "drone-task-status", content: "observed" };
it.each([
	[assistant, status, a, b],
	[assistant, a, status, b],
	[assistant, status, a, status, b],
])("repairs complete legacy batch without modifying signed blocks %#", (...input) => {
	const original = structuredClone(input);
	const out = repair(input);
	expect(out.slice(0, 3)).toEqual([assistant, a, b]);
	expect(out.slice(3).every((m) => m === status)).toBe(true);
	expect(out[0]).toBe(assistant);
	expect(out[1]).toBe(a);
	expect(out[2]).toBe(b);
	expect(input).toEqual(original);
	expect(repair(out)).toEqual(out);
});
it.each([
	[assistant, status, a],
	[assistant, status, a, a, b],
	[assistant, status, { role: "user", content: "continue" }, a, b],
	[assistant, { ...status, customType: "other-host-message" }, a, b],
	[status, a, b],
	[assistant, a, b, status],
])("never invents, drops, or moves across an unknown/missing boundary %#", (...messages) => {
	expect(repair(messages)).toEqual(messages);
});
