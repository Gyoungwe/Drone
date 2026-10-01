import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTaskFeedback, guardResearchToolResult } from "../src/task-feedback";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("knowledge task feedback", () => {
	it("reports observed output files and sanitized failures", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-task-feedback-"));
		roots.push(root);
		await mkdir(join(root, "results"));
		const path = join(root, "results/report.md");
		await writeFile(path, "report");
		const feedback = createTaskFeedback();
		await feedback.observe({ toolCallId: "w", toolName: "write", input: { path } }, { cwd: root });
		await feedback.observe(
			{ toolCallId: "a", toolName: "research_archive_source", details: { status: "downloaded" } },
			{ cwd: root },
		);
		await feedback.observe(
			{
				toolCallId: "bad",
				toolName: "webfetch",
				isError: true,
				content: [{ type: "text", text: "api_key=secret" }],
			},
			{ cwd: root },
		);
		const facts = feedback.facts();
		expect(facts.archivedSources).toBe(1);
		expect(facts.files[0]?.path).toBe(await realpath(path));
		expect(facts.failures[0]?.reason).toBe("[redacted]");
		expect(feedback.report("source-unread", "needs review", ["Library/missing.md"])).toContain("report.md");
	});
	it("deduplicates tool receipts and resets state per turn", async () => {
		const feedback = createTaskFeedback();
		await feedback.observe(
			{ toolCallId: "a", toolName: "research_archive_source", details: { status: "downloaded" } },
			{ cwd: "/missing" },
		);
		await feedback.observe(
			{ toolCallId: "a", toolName: "research_archive_source", details: { status: "downloaded" } },
			{ cwd: "/missing" },
		);
		expect(feedback.facts().archivedSources).toBe(1);
		feedback.begin();
		expect(feedback.facts()).toMatchObject({ archivedSources: 0, failures: [], files: [] });
	});
	it("guards binary PDFs and structured failures", () => {
		const binary = guardResearchToolResult({
			toolName: "fetch_content",
			content: [{ type: "text", text: "%PDF-1.5\n1 0 obj\nBINARY\u0000" }],
			details: {},
		});
		expect(binary?.isError).toBe(true);
		expect(JSON.stringify(binary)).not.toContain("BINARY");
		expect(
			guardResearchToolResult({
				toolName: "research_archive_source",
				isError: false,
				content: [],
				details: { status: "failed" },
			})?.isError,
		).toBe(true);
	});
});
