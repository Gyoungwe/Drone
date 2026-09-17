import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveTurnUsage, messagesToUIMessages } from "@drone/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAnswerPublication } from "../../../.pi/lib/knowledge/publication.mjs";
import { closeKnowledgeServices, getKnowledgeService } from "../../../.pi/lib/knowledge/service.mjs";
import { createTaskFeedback, guardResearchToolResult } from "../../../.pi/lib/knowledge/task-feedback.mjs";
import { configureObsidian } from "../../../.pi/lib/obsidian-workbench.mjs";
import { toSessionMessages } from "../src/session/messages";

let root, cwd, vault, service, prep;
async function note(path, text) {
	await mkdir(join(vault, path, ".."), { recursive: true });
	await writeFile(join(vault, path), text);
}
beforeEach(async () => {
	// Prior mandatory-review behavior remains covered as optional strict mode.
	vi.stubEnv("DRONE_REVIEW_MODE", "strict");
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-usage-feedback-")));
	cwd = join(root, "project");
	vault = join(root, "Vault");
	await mkdir(cwd);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "app"));
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	vi.stubEnv("PI_SUBAGENT_CHILD", undefined);
	await configureObsidian({ cwd, vault, project: "project-a" });
	await note("Wiki/Index.md", "# Empty navigation");
	await note("Library/Software/source.md", "# Evidence source\nRead evidence.");
	await note("Library/Explainers/demo.md", "# Presentation only");
	await note("Projects/project-a/Runs/demo.md", "# Generated run summary");
	service = await getKnowledgeService();
	prep = await service.prepare({ cwd, project: "project-a" });
	await service.request("reconcile");
});
afterEach(async () => {
	await closeKnowledgeServices();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});
async function ready() {
	await vi.waitFor(
		async () => expect((await service.search(prep.ticket, cwd, { query: "Evidence" })).complete).toBe(true),
		{ timeout: 2000 },
	);
	await service.read(prep.ticket, cwd, { path: "Library/Software/source.md" });
}
const msg = (text) => ({
	role: "assistant",
	timestamp: 4,
	content: [{ type: "text", text }],
	stopReason: "stop",
});
describe("generated links are delivery receipts, not scientific citations", () => {
	it("allows a confirmed Show Me link beside a genuinely read evidence citation", async () => {
		await ready();
		const receipt = await service.deliveryReceipt(
			prep.ticket,
			cwd,
			join(vault, "Library/Explainers/demo.md"),
		);
		const proof = await service.validateAnswer(
			prep.ticket,
			cwd,
			"Evidence [[Library/Software/source]]; output [[Library/Explainers/demo]]",
			{ deliveries: [receipt] },
		);
		expect(proof.sources.map((x) => x.path)).toEqual(["Library/Software/source.md"]);
		expect(proof.deliveries).toHaveLength(1);
		await expect(
			service.evidenceReceipts(prep.ticket, cwd, ["Library/Explainers/demo.md"]),
		).rejects.toThrow();
	});
	it("does not accept only presentation links as research evidence", async () => {
		await ready();
		const receipt = await service.deliveryReceipt(
			prep.ticket,
			cwd,
			join(vault, "Library/Explainers/demo.md"),
		);
		await expect(
			service.validateAnswer(prep.ticket, cwd, "Evidence [[Library/Explainers/demo]]", {
				deliveries: [receipt],
			}),
		).rejects.toMatchObject({ code: "citation-required" });
	});
	it("requires an actual output receipt instead of treating every generated-looking path as safe", async () => {
		await ready();
		await expect(
			service.validateAnswer(
				prep.ticket,
				cwd,
				"Source [[Library/Software/source]] and [[Library/Explainers/demo]]",
			),
		).rejects.toMatchObject({ code: "source-unread", paths: ["Library/Explainers/demo.md"] });
	});
	it("rejects changed outputs and foreign project delivery paths", async () => {
		await ready();
		const receipt = await service.deliveryReceipt(
			prep.ticket,
			cwd,
			join(vault, "Library/Explainers/demo.md"),
		);
		await note("Library/Explainers/demo.md", "# Modified presentation");
		await expect(
			service.validateAnswer(prep.ticket, cwd, "[[Library/Software/source]] [[Library/Explainers/demo]]", {
				deliveries: [receipt],
			}),
		).rejects.toMatchObject({ code: "delivery-changed" });
		await expect(
			service.deliveryReceipt(prep.ticket, cwd, join(vault, "Projects/other/Runs/x.md")),
		).rejects.toThrow();
	});
	it("runs a host evidence search before blocking on search-required", async () => {
		const events = new Map();
		const gate = registerAnswerPublication(
			{ on: (name, fn) => events.set(name, fn) },
			{ getCurrent: () => ({ service, ticket: prep.ticket, query: "Evidence" }) },
		);
		gate.begin();
		await vi.waitFor(async () => expect((await service.request("status")).coverage).toBe("ready"), {
			timeout: 2000,
		});
		const final = await events.get("message_end")(
			{ message: msg("请核对该版本的安装命令与参数。") },
			{ cwd },
		);
		expect(["released", "no-hits"]).toContain(final.message.knowledgePublication.status);
		expect(JSON.stringify(final.message.content)).toContain("请核对该版本的安装命令与参数");
		expect(JSON.stringify(final.message.content)).not.toContain("知识库检查未通过");
	});
	it("releases an uncited user-facing answer by attaching this-turn read citations", async () => {
		const events = new Map();
		const gate = registerAnswerPublication(
			{ on: (name, fn) => events.set(name, fn) },
			{ getCurrent: () => ({ service, ticket: prep.ticket }) },
		);
		gate.begin();
		await ready();
		const final = await events.get("message_end")({ message: msg("证据只在限定条件下成立。") }, { cwd });
		expect(final.message.knowledgePublication.status).toBe("released");
		expect(JSON.stringify(final.message.content)).toContain("证据只在限定条件下成立");
		expect(JSON.stringify(final.message.content)).toContain("Library/Software/source");
		expect(JSON.stringify(final.message.content)).not.toContain("知识库检查未通过");
	});
	it("preflight gives the main agent a specific missing path and does not bypass the final gate", async () => {
		const events = new Map(),
			feedback = createTaskFeedback();
		const gate = registerAnswerPublication(
			{ on: (name, fn) => events.set(name, fn) },
			{ getCurrent: () => ({ service, ticket: prep.ticket }), getTaskFeedback: () => feedback },
		);
		gate.begin();
		await ready();
		const checked = await gate.preflight({ cwd }, "[[Library/missing]]");
		expect(checked.ok).toBe(false);
		expect(checked.paths).toEqual(["Library/missing.md"]);
		const final = await events.get("message_end")(
			{ message: msg("UNPUBLISHED_RESEARCH [[Library/missing]]") },
			{ cwd },
		);
		expect(final.message.knowledgePublication.status).toBe("blocked");
		expect(JSON.stringify(final)).toContain("Library/missing.md");
		expect(JSON.stringify(final)).not.toContain("UNPUBLISHED_RESEARCH");
	});
});
describe("observed work and useful failures survive a blocked answer", () => {
	it("reports files that were really written without guessing task completion", async () => {
		const path = join(cwd, "results/report.md");
		await mkdir(join(cwd, "results"));
		await writeFile(path, "fixture report");
		const feedback = createTaskFeedback();
		await feedback.observe(
			{ toolCallId: "w", toolName: "write", input: { path }, content: [], isError: false },
			{ cwd },
		);
		await feedback.observe(
			{
				toolCallId: "a",
				toolName: "research_archive_source",
				details: { status: "downloaded" },
				content: [],
			},
			{ cwd },
		);
		await feedback.observe(
			{
				toolCallId: "bad",
				toolName: "webfetch",
				isError: true,
				content: [{ type: "text", text: "timed out" }],
			},
			{ cwd },
		);
		const text = feedback.report("source-unread", "未阅读实际引用条目", ["Library/missing.md"]);
		expect(text).toContain("report.md");
		expect(text).toContain("归档来源 1 项");
		expect(text).toContain("timed out");
		expect(text).toContain("不需要重新下载");
		expect(feedback.facts().summarySaved).toBe(false);
		feedback.begin();
		expect(feedback.facts().files).toEqual([]);
	});
	it("never advertises a failed write or an arbitrary outside-workspace path", async () => {
		const feedback = createTaskFeedback();
		await feedback.observe(
			{ toolCallId: "w", toolName: "write", input: { path: "/private/secret" }, content: [], isError: true },
			{ cwd },
		);
		expect(feedback.facts().files).toEqual([]);
	});
	it("replaces raw PDF bytes instead of spending context on unreadable data", () => {
		const content = "Note: large repository.\n%PDF-1.5\n1 0 obj\nBINARY_FIXTURE";
		const result = guardResearchToolResult({
			toolName: "fetch_content",
			content: [{ type: "text", text: content }],
			details: {},
		});
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result)).not.toContain("BINARY_FIXTURE");
		expect(JSON.stringify(result)).toContain("二进制");
	});
	it("marks structured failure as failed even when a third-party tool claims isError:false", () => {
		expect(
			guardResearchToolResult({
				toolName: "research_archive_source",
				isError: false,
				content: [],
				details: { status: "failed", reason: "HTTP 404" },
			})?.isError,
		).toBe(true);
	});
});
it("history preserves reported usage exactly once across split text/tool and status-only messages", () => {
	const u = { input: 100, output: 20, cacheRead: 80, cacheWrite: 0, reasoning: 5, cost: { total: 0 } };
	const raw = [
		{ role: "user", content: "Question", timestamp: 1 },
		{
			role: "assistant",
			responseId: "one",
			timestamp: 2,
			usage: u,
			content: [
				{ type: "text", text: "Public text" },
				{ type: "toolCall", id: "t", name: "read", arguments: { path: "a" } },
			],
		},
		{
			role: "assistant",
			responseId: "two",
			timestamp: 3,
			usage: u,
			content: [{ type: "toolCall", id: "s", name: "set_status", arguments: { text: "Review" } }],
		},
		{
			role: "toolResult",
			toolName: "set_status",
			toolCallId: "s",
			timestamp: 4,
			isError: false,
			details: { status: "Review sources", detail: "Checking versions.", hiddenReasoning: "NOT_VISIBLE" },
		},
	];
	const history = toSessionMessages(raw),
		ui = messagesToUIMessages(history);
	expect(deriveTurnUsage(ui)[0].total).toBe(400);
	expect(deriveTurnUsage(ui)[0].requests).toBe(2);
	expect(JSON.stringify(history)).toContain("Checking versions.");
	expect(JSON.stringify(history)).not.toContain("NOT_VISIBLE");
});

it("does not reject ordinary documentation that mentions the PDF signature", () => {
	expect(
		guardResearchToolResult({
			toolName: "fetch_content",
			content: [{ type: "text", text: "A PDF starts with %PDF-1.5; extract text before reading." }],
			details: {},
		}),
	).toBeUndefined();
});
