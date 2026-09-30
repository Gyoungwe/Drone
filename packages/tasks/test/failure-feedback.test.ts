import { describe, expect, it } from "vitest";
import {
	diagnosticText,
	FAILURE_EXPLANATION_POLICY,
	failureContext,
	failureObservation,
	failureReceipt,
	TASK_HANDOFF_POLICY,
	taskProgressContext,
	toolResultFailed,
} from "../src/failure-feedback";

describe("failure-feedback domain functions", () => {
	it("redacts credentials, URLs, controls, and bounds the excerpt", () => {
		const text =
			'Authorization: Bearer very-secret; "api_key": "quoted-secret" password=pass123 https://alice:password@example.org/path?token=sign#private sk-abcdefgh123456';
		const redacted = diagnosticText(text);
		for (const secret of [
			"very-secret",
			"quoted-secret",
			"pass123",
			"alice",
			"token=sign",
			"#private",
			"sk-abcdefgh",
		])
			expect(redacted).not.toContain(secret);
		expect(diagnosticText("x".repeat(10000))).toHaveLength(600);
		expect(diagnosticText("line\nwith\u0000controls")).toBe("line with controls");
	});

	it("recognizes structured failures without treating ordinary text as a failure", () => {
		for (const event of [
			{ isError: true },
			{ details: { ok: false } },
			{ details: { status: "failed" } },
			{ details: { status: "blocked" } },
			{ details: { status: "budget-exhausted" } },
			{ details: { exitCode: 2 } },
			{ details: { exit_code: 1 } },
		])
			expect(toolResultFailed(event)).toBe(true);
		for (const event of [
			{ details: { status: "running", exitCode: null } },
			{ details: { exitCode: 0 } },
			{ content: [{ type: "text", text: "report discusses a failed hypothesis" }] },
		])
			expect(toolResultFailed(event)).toBe(false);
	});

	it("returns a bounded, redacted failure observation and grounded context", () => {
		const event = {
			toolCallId: "read-1",
			toolName: "read",
			input: { path: "input.csv" },
			isError: true,
			content: [{ type: "text", text: "ENOENT: input.csv was not found" }],
		};
		const observation = failureObservation(event, "now");
		expect(observation).toMatchObject({
			id: "read-1",
			tool: "read",
			target: "input.csv",
			error: "ENOENT: input.csv was not found",
		});
		const context = failureContext(
			{
				id: "task",
				goal: "analysis",
				reason: "tool-failure",
				failures: [observation],
				milestones: [{ id: "report", title: "报告", state: "blocked", acceptance: { path: "report.md" } }],
			},
			observation,
		);
		expect(context).toContain("task_failure_context");
		expect(context).toContain("not-determined-by-host");
		expect(context).toContain("report.md");
	});

	it("keeps progress context separate and reports missing historical detail honestly", () => {
		const task = {
			id: "task",
			state: "partial",
			stage: 2,
			reason: "tool-failure",
			milestones: [
				{ id: "report", state: "blocked", acceptance: { path: "report.md" }, evidence: { code: "ENOENT" } },
			],
		};
		expect(failureContext(task)).toContain('"historicalErrorDetailMissing":true');
		expect(taskProgressContext({ ...task, reason: undefined })).toContain("task_progress_context");
		expect(failureReceipt({ failures: [] })).toContain("没保留下来");
		expect(FAILURE_EXPLANATION_POLICY).toContain("impact not yet known");
		expect(TASK_HANDOFF_POLICY).toContain("next concrete action");
	});
});
