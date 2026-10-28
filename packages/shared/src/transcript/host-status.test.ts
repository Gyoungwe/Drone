import { expect, it } from "vitest";
import { buildChatRows } from "./chat-rows";
import { messagesToUIMessages } from "./mapping";
import { reduceEvent } from "./reducer";
import { emptyTranscript } from "./types";

const report = {
	role: "custom" as const,
	customType: "drone-task-status",
	display: true,
	content: "",
	timestamp: 100,
	details: { operational: true, reportId: "status-1" },
};

it("keeps display origin identical for history and live without requiring domain UI", () => {
	const history = messagesToUIMessages([
		{
			role: "assistant",
			text: "",
			thinking: "",
			tools: [],
			images: [],
			timestamp: 100,
			hostStatus: true,
		},
	]);
	const live = reduceEvent(emptyTranscript(), { type: "message_end", message: report });
	expect(history[0]).toMatchObject({ hostStatus: true, text: "" });
	expect(live.messages[0]).toMatchObject({ hostStatus: true, text: "" });
	for (const message of [...history, ...live.messages]) {
		const rows = buildChatRows({ ...emptyTranscript(), messages: [message] }, "session");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: "message", message: { hostStatus: true } });
	}
});

it("does not promote model metadata to host display origin or task state", () => {
	const message = {
		role: "assistant" as const,
		api: "openai-completions" as const,
		provider: "offline",
		model: "synthetic",
		stopReason: "stop" as const,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		content: [{ type: "text" as const, text: "Ordinary answer" }],
		timestamp: 100,
		hostStatus: true,
		taskView: { version: 2, tasks: [] },
	};
	const state = reduceEvent(emptyTranscript(), { type: "turn_end", toolResults: [], message });
	expect(state.messages[0]).toMatchObject({ kind: "assistant", text: "Ordinary answer" });
	expect(state.messages[0]).not.toHaveProperty("hostStatus");
	expect(state.messages[0]).not.toHaveProperty("taskView");
});
