import { describe, expect, it } from "vitest";
import { taskStatusDisplay } from "./task-status";

const message = (customType: string, details: unknown = { reportId: "r-1" }) => ({
	role: "custom",
	customType,
	display: true,
	content: "status",
	timestamp: 5,
	details,
});

describe("taskStatusDisplay", () => {
	it("renders the in-process host's and managed plugins' host-rendered status notices", () => {
		expect(taskStatusDisplay(message("drone-task-status"))).toEqual({
			id: "task-status-r-1",
			text: "status",
			timestamp: 5,
		});
		expect(taskStatusDisplay(message("plugin-notice:%40gyoungwe%2Fpi-core"))).toMatchObject({
			text: "status",
		});
	});
	it("rejects other custom types, hidden messages and missing host report ids", () => {
		expect(taskStatusDisplay(message("plugin-continue:x"))).toBeNull();
		expect(taskStatusDisplay(message("plugin-notice:x", {}))).toBeNull();
		expect(taskStatusDisplay({ ...message("plugin-notice:x"), display: false })).toBeNull();
	});
});
