import { describe, expect, it } from "vitest";
import { toSessionMessages } from "../src/session/messages";

describe("set_status history projection", () => {
	it("does not replay UI-only status calls as chat tool cards", () => {
		const messages = toSessionMessages([
			{
				role: "assistant",
				content: [
					{ type: "toolCall", id: "status-1", name: "set_status", arguments: { text: "正在检索文献…" } },
				],
				timestamp: 1,
			},
			{
				role: "toolResult",
				toolCallId: "status-1",
				content: [{ type: "text", text: "Status updated" }],
				isError: false,
				timestamp: 2,
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "Final answer" }],
				timestamp: 3,
			},
		]);
		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({ role: "assistant", text: "Final answer", tools: [] });
	});
});
