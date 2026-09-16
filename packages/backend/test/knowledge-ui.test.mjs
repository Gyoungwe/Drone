import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeKnowledgeServices, getKnowledgeService } from "../../../.pi/lib/knowledge/service.mjs";
import * as ui from "../../../.pi/lib/knowledge/ui-service.mjs";
import {
	beginKnowledgeFlow,
	flowFor,
	noteKnowledgeRead,
	publicationKnowledgeFlow,
	subscribeKnowledgeUi,
	updateKnowledgeFlow,
} from "../../../.pi/lib/knowledge/ui-state.mjs";
import { stageWikiProposal } from "../../../.pi/lib/knowledge/wiki-review.mjs";
import { configureObsidian } from "../../../.pi/lib/obsidian-workbench.mjs";

let root, cwd, vault, service, prep, revision;
async function note(path, text) {
	await mkdir(join(vault, path, ".."), { recursive: true });
	await writeFile(join(vault, path), text);
}
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-knowledge-ui-")));
	cwd = join(root, "project");
	vault = join(root, "Vault");
	await mkdir(cwd);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "app"));
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	const result = await configureObsidian({ cwd, vault, project: "project-a" });
	revision = result.bindingRevision;
	await note("Wiki/Index.md", "# Wiki\n[[Wiki/Topic]]\n");
	await note("Wiki/Topic.md", "# Topic\nOriginal user paragraph.\n");
	await note("Library/Papers/source.md", "# Source\nActual evidence.\n## Human review\nKeep limits.\n");
	service = await getKnowledgeService();
	prep = await service.prepare({ cwd, project: "project-a", query: "Topic" });
	await service.request("reconcile");
});
afterEach(async () => {
	await closeKnowledgeServices();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});
async function candidate(title = "Topic") {
	await service.read(prep.ticket, cwd, { path: "Wiki/Topic.md" });
	await service.read(prep.ticket, cwd, { path: "Library/Papers/source.md" });
	return stageWikiProposal(service, prep.ticket, cwd, {
		path: "Wiki/Topic.md",
		title,
		markdown: "A conditional interpretation.",
		rationale: "Evidence changed.",
		source_paths: ["Library/Papers/source.md"],
	});
}
describe("real human-facing knowledge APIs", () => {
	it("overview reads real application binding without model calls or reconciliation", async () => {
		const before = await service.request("status"),
			value = await ui.knowledgeOverview({ cwd });
		const after = await service.request("status");
		expect(value.binding.vault).toBe(vault);
		expect(value.project).toBe("project-a");
		expect(value.index.noteCount).toBeGreaterThan(0);
		expect(after.stats.reconciliations).toBe(before.stats.reconciliations);
	});
	it("folder/template preview is read-only and reports a missing target", async () => {
		const path = join(root, "New Vault"),
			value = await ui.knowledgeSetupPreview({ cwd, path });
		expect(value.context.vault.exists).toBe(false);
		expect(value.options.profiles).toHaveLength(3);
		expect((await ui.knowledgeOverview({ cwd })).binding.vault).toBe(vault);
	});
	it("human note reads do not grant model publication or proposal receipts", async () => {
		const note = await ui.knowledgeReadNote({ cwd, path: "Library/Papers/source.md", revision });
		expect(note.humanReview.text).toContain("Keep limits");
		await expect(service.evidenceReceipts(prep.ticket, cwd, ["Library/Papers/source.md"])).rejects.toThrow(
			"not read",
		);
	});
	it("human preview resolves generated explainer attachments without changing stored Markdown", async () => {
		const attachment = join(vault, "Attachments", "Explainers", "topic", "20260912-demo.html");
		await mkdir(join(attachment, ".."), { recursive: true });
		await writeFile(attachment, "<h1>demo</h1>");
		await note(
			"Library/Explainers/topic.md",
			"# Topic explainer\n\n[打开 Show Me 页面](../../Attachments/Explainers/topic/20260912-demo.html)\n",
		);
		await service.request("reconcile");
		const raw = await readFile(join(vault, "Library/Explainers/topic.md"), "utf8");
		expect(raw).toContain("../../Attachments/Explainers/");
		const shown = await ui.knowledgeReadNote({ cwd, path: "Library/Explainers/topic.md", revision });
		expect(shown.displayText).toContain("file://");
		expect(shown.displayText).not.toContain("](../../Attachments/Explainers/");
		expect(await readFile(join(vault, "Library/Explainers/topic.md"), "utf8")).toBe(raw);
	});
	it("human reads and open targets reject traversal, other-project notes and stale bindings", async () => {
		await expect(ui.knowledgeReadNote({ cwd, path: "../private.md", revision })).rejects.toThrow("allowed");
		await note("Projects/other/Evidence/private.md", "# private");
		await expect(
			ui.knowledgeReadNote({ cwd, path: "Projects/other/Evidence/private.md", revision }),
		).rejects.toThrow("scope");
		await expect(
			ui.knowledgeOpenTarget({ cwd, path: "Projects/other/Evidence/private.md", revision }),
		).rejects.toThrow("scope");
		await expect(ui.knowledgeOpenTarget({ cwd, revision: 0 })).rejects.toThrow("binding changed");
	});
	it("maintenance has real pagination without overlap", async () => {
		for (let i = 0; i < 12; i++) {
			await note(`Library/Papers/p${i}.md`, `# Source ${i}`);
		}
		await service.request("reconcile");
		const first = await ui.knowledgeJobs({ cwd, revision, limit: 5 }),
			second = await ui.knowledgeJobs({ cwd, revision, limit: 5, offset: first.nextOffset });
		expect(first.items).toHaveLength(5);
		expect(second.items).toHaveLength(5);
		expect(first.items.some((a) => second.items.some((b) => b.key === a.key))).toBe(false);
	});
	it("proposal list loads summaries while preview detects changed source and protects user content", async () => {
		const staged = await candidate();
		await note("Library/Papers/source.md", "# Updated source");
		const page = await ui.knowledgeReviews({ cwd, revision, limit: 5 });
		expect(page.items[0].id).toBe(staged.id);
		expect(page.items[0].after).toBeUndefined();
		const preview = await ui.knowledgePreviewReview({ cwd, revision, id: staged.id });
		expect(preview.canApply).toBe(false);
		expect(preview.sources[0].changed).toBe(true);
		expect(preview.protectedText).toContain("Original user paragraph");
	});
	it("only an exact preview capability permits approval, and it is one-use", async () => {
		const staged = await candidate();
		await expect(ui.knowledgeDecideReview({ cwd, token: staged.id, decision: "apply" })).rejects.toThrow(
			"Review expired",
		);
		const preview = await ui.knowledgePreviewReview({ cwd, revision, id: staged.id });
		expect(preview.canApply).toBe(true);
		const result = await ui.knowledgeDecideReview({ cwd, token: preview.reviewToken, decision: "apply" });
		expect(result.vaultWritten).toBe(true);
		expect(result.indexed).toBe(true);
		expect(await readFile(join(vault, "Wiki/Topic.md"), "utf8")).toContain("Original user paragraph");
		await expect(
			ui.knowledgeDecideReview({ cwd, token: preview.reviewToken, decision: "apply" }),
		).rejects.toThrow("Review expired");
	});
	it("cancelling or merely previewing never writes the target", async () => {
		const staged = await candidate(),
			before = await readFile(join(vault, "Wiki/Topic.md"), "utf8");
		await ui.knowledgePreviewReview({ cwd, revision, id: staged.id });
		expect(await readFile(join(vault, "Wiki/Topic.md"), "utf8")).toBe(before);
	});
	it("changed target or binding invalidates the exact preview", async () => {
		const staged = await candidate(),
			preview = await ui.knowledgePreviewReview({ cwd, revision, id: staged.id });
		await note("Wiki/Topic.md", "# Human edit after preview");
		await expect(
			ui.knowledgeDecideReview({ cwd, token: preview.reviewToken, decision: "apply" }),
		).rejects.toThrow("Wiki changed");
		const next = await ui.knowledgePreviewReview({ cwd, revision, id: staged.id });
		expect(next.targetChanged).toBe(true);
		await configureObsidian({ cwd, vault: join(root, "Other Vault") });
		await expect(
			ui.knowledgeDecideReview({ cwd, token: next.reviewToken, decision: "reject" }),
		).rejects.toThrow("binding changed");
	});
	it("a review capability cannot be reused from another workspace", async () => {
		const staged = await candidate(),
			preview = await ui.knowledgePreviewReview({ cwd, revision, id: staged.id });
		await expect(
			ui.knowledgeDecideReview({ cwd: join(root, "other"), token: preview.reviewToken, decision: "apply" }),
		).rejects.toThrow("Review expired");
	});
	it("review expiry is explicit but an expired candidate can still be rejected", async () => {
		const staged = await candidate(),
			now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 25 * 3600000);
		try {
			const preview = await ui.knowledgePreviewReview({ cwd, revision, id: staged.id });
			expect(preview.expired).toBe(true);
			expect(preview.canApply).toBe(false);
			expect(
				(await ui.knowledgeDecideReview({ cwd, token: preview.reviewToken, decision: "reject" })).status,
			).toBe("rejected");
		} finally {
			now.mockRestore();
		}
	});
	it("maintenance uses bound revision and does not invoke semantic Wiki rewriting", async () => {
		const before = await readFile(join(vault, "Wiki/Topic.md"), "utf8");
		const result = await ui.knowledgeMaintenance({ cwd, revision, action: "refresh-navigation" });
		expect(result.semanticWikiRewritten).toBe(false);
		expect(await readFile(join(vault, "Wiki/Topic.md"), "utf8")).toBe(before);
		await expect(ui.knowledgeMaintenance({ cwd, action: "reconcile" })).rejects.toThrow("binding");
	});
});
describe("host-owned step events", () => {
	it("records bounded read excerpts and versions without full bodies or draft answers", () => {
		const events = [],
			off = subscribeKnowledgeUi((e) => events.push(e)),
			ctx = { sessionId: "ui-fixture" };
		try {
			beginKnowledgeFlow(ctx, { vaultId: "fixture", revision: 1, vault });
			updateKnowledgeFlow(ctx, { phase: "searching" });
			noteKnowledgeRead(ctx, {
				path: "Wiki/Topic.md",
				text: `READ_EXCERPT ${"x".repeat(2000)}HIDDEN_TAIL`,
				hash: "123",
				startLine: 1,
				endLine: 2,
			});
			publicationKnowledgeFlow(ctx, { status: "blocked", reason: "source-changed" });
			expect(flowFor("ui-fixture").phase).toBe("blocked");
			expect(JSON.stringify(events)).toContain("READ_EXCERPT");
			expect(JSON.stringify(events)).not.toContain("HIDDEN_TAIL");
			expect(flowFor("ui-fixture").reads[0].excerpt.length).toBeLessThanOrEqual(320);
			expect(events.some((e) => e.flow?.phase === "reading-wiki")).toBe(true);
		} finally {
			off();
		}
	});
	it("UI snapshots are copies, not writable backend state", () => {
		const ctx = { sessionId: "snapshot-test" };
		beginKnowledgeFlow(ctx, null);
		const value = flowFor("snapshot-test");
		value.phase = "released";
		expect(flowFor("snapshot-test").phase).toBe("unconfigured");
	});
});

it("no-path preview uses the current Vault and always includes actual template content", async () => {
	const value = await ui.knowledgeSetupPreview({ cwd });
	expect(value.path).toBe(vault);
	expect(value.options.profiles[0].directories).toContain("Home.md");
	expect(value.templateSamples.find((x) => x.path === "Templates/Source.md").text).toContain(
		"<!-- pi-agent:managed:start -->",
	);
});
it("template-only preview works without a project, binding or destination", async () => {
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "unbound-app"));
	const value = await ui.knowledgeSetupPreview({});
	expect(value.context.vault).toBeNull();
	expect(value.context.workspace).toBeNull();
	expect(value.options.profiles).toHaveLength(3);
	expect(value.templateSamples.length).toBeGreaterThan(0);
});

it("existing bare results paths become display-only links, without rewriting the stored note", async () => {
	const results = join(cwd, "results", "old-run");
	await mkdir(results, { recursive: true });
	await writeFile(join(results, "paper.pdf"), "fixture only");
	const original = '---\nproject: "project-a"\n---\n# Note\n\n## Sources\n- results/old-run/paper.pdf\n';
	await note("Library/Methods/legacy.md", original);
	const value = await ui.knowledgeReadNote({ cwd, path: "Library/Methods/legacy.md", revision });
	expect(value.displayText).toContain("](<file:");
	expect(value.text).toBe(original);
	expect(await readFile(join(vault, "Library/Methods/legacy.md"), "utf8")).toBe(original);
	const other = join(root, "other-workspace");
	await mkdir(other);
	expect(
		(await ui.knowledgeReadNote({ cwd: other, path: "Library/Methods/legacy.md", revision })).displayText,
	).toBeUndefined();
});
