import { describe, expect, it } from "vitest";
import { restoreTaskToolOrder as repair, type TaskProtocolMessage } from "../src/index";

const assistant: TaskProtocolMessage = {
	role: "assistant",
	content: [
		{ type: "thinking", thinking: "signed", thinkingSignature: "signature" },
		{ type: "toolCall", id: "a", name: "read", arguments: { path: "a" } },
		{ type: "toolCall", id: "b", name: "read", arguments: { path: "b" } },
	],
};
const a: TaskProtocolMessage = { role: "toolResult", toolCallId: "a", content: [] };
const b: TaskProtocolMessage = { role: "toolResult", toolCallId: "b", content: [] };
const status: TaskProtocolMessage = { role: "custom", customType: "drone-task-status", content: [] };

describe("legacy task tool protocol repair", () => {
	it.each([
		[assistant, status, a, b],
		[assistant, a, status, b],
		[assistant, status, a, status, b],
	])("repairs complete batches without changing signed blocks %#", (...input) => {
		const original = structuredClone(input);
		const out = repair(input);
		expect(out.slice(0, 3)).toEqual([assistant, a, b]);
		expect(out.slice(3).every((message) => message === status)).toBe(true);
		expect(input).toEqual(original);
		expect(repair(out)).toEqual(out);
	});

	it.each([
		[assistant, status, a],
		[assistant, status, a, a, b],
		[assistant, status, { role: "user", content: [] }, a, b],
		[assistant, { ...status, customType: "other-host-message" }, a, b],
		[status, a, b],
		[assistant, a, b, status],
	])("leaves incomplete or foreign batches untouched %#", (...messages) => {
		expect(repair(messages)).toEqual(messages);
	});
});
