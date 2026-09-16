import { taskStatusDisplay } from "@drone/shared";
import { describe, expect, it } from "vitest";
import { assignEntryIds, readSessionMessagesFromContent, toSessionMessages } from "../src/session/messages";

const status = {
	role: "custom",
	customType: "drone-task-status",
	content: "任务执行记录：文件已回读，不是科研结论",
	display: true,
	timestamp: 100,
	details: { operational: true, reportId: "host-report-1" },
};
describe("host task status history", () => {
	it("replays a no-model command as a standalone display message", () => {
		expect(toSessionMessages([status])).toMatchObject([
			{ role: "assistant", text: status.content, timestamp: 100 },
		]);
	});
	it.each([
		{ ...status, display: false },
		{ ...status, customType: "drone-task-context" },
		{ ...status, role: "assistant" },
		{ ...status, details: {} },
		{ ...status, content: "x".repeat(16001) },
	])("rejects hidden context and unrelated shapes", (message) => {
		expect(taskStatusDisplay(message)).toBeNull();
	});
	it("never replays hidden task context", () => {
		expect(toSessionMessages([{ ...status, display: false }])).toEqual([]);
	});
});
it("file replay includes displayed custom checkpoints but not hidden context", () => {
	const entries = [
		{ type: "session", version: 3, id: "fixture", timestamp: "2026-09-16T00:00:00.000Z", cwd: "/fixture" },
		{ type: "custom_message", id: "a", parentId: null, ...status, timestamp: "2026-09-16T00:00:01.000Z" },
		{
			type: "custom_message",
			id: "b",
			parentId: "a",
			...status,
			display: false,
			timestamp: "2026-09-16T00:00:02.000Z",
		},
	];
	expect(
		readSessionMessagesFromContent(entries.map((entry) => JSON.stringify(entry)).join("\n")),
	).toMatchObject([{ role: "assistant", text: status.content, hostStatus: true }]);
});
it("host display does not consume a same-timestamp model fork entry", () => {
	const messages = toSessionMessages([
		status,
		{ role: "assistant", content: [{ type: "text", text: "model answer" }], timestamp: 100 },
	]);
	assignEntryIds(messages, [
		{
			type: "message",
			id: "model-id",
			parentId: null,
			timestamp: "2026-09-16T00:00:00.000Z",
			message: { role: "assistant", timestamp: 100 },
		},
	] as any);
	expect(messages[0].entryId).toBeUndefined();
	expect(messages[1].entryId).toBe("model-id");
});
