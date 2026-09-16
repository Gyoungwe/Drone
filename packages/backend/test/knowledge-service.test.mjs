import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWorkspaceConfig, saveWorkspaceConfig } from "../../../.pi/extensions/workspace-config.mjs";
import { readKnowledgeBinding, saveKnowledgeBinding } from "../../../.pi/lib/knowledge/config.mjs";
import { registerKnowledgeInterface } from "../../../.pi/lib/knowledge/extension.mjs";
import { runNavigationMaintenance } from "../../../.pi/lib/knowledge/maintenance.mjs";
import {
	closeKnowledgeServices,
	getKnowledgeService,
	KnowledgeService,
} from "../../../.pi/lib/knowledge/service.mjs";
import { listWikiProposals } from "../../../.pi/lib/knowledge/wiki-review.mjs";
import {
	configureObsidian,
	depositKnowledge,
	publishExplainer,
	publishSourceNote,
} from "../../../.pi/lib/obsidian-workbench.mjs";
import { resolveSubagentMcpAccess } from "../src/tools/subagent/runner";

// These are real filesystem + worker/SQLite integration tests, not 5-second unit tests.
// Hosted Windows can take >6 seconds for a cold fixture. A premature Vitest timeout
// does not cancel the async body and can race worker creation against SQLite cleanup.
// Keep a finite integration deadline and allow closeKnowledgeServices() to join workers.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let root, a, b, vault, app;
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "percho-knowledge-test-")));
	a = join(root, "project-a");
	b = join(root, "project-b");
	vault = join(root, "Vault");
	app = join(root, "app-state");
	await mkdir(a);
	await mkdir(b);
	vi.stubEnv("PERCHO_KNOWLEDGE_DIR", app);
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	vi.stubEnv("PI_SUBAGENT_CHILD", undefined);
});
afterEach(async () => {
	await closeKnowledgeServices();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});
const setup = async (options = {}) => configureObsidian({ cwd: a, vault, project: "project-a", ...options });
async function note(path, text) {
	await mkdir(join(vault, path, ".."), { recursive: true });
	await writeFile(join(vault, path), text);
}
async function prepared({ wiki = true } = {}) {
	await setup();
	if (wiki) {
		await note("Wiki/Index.md", "# Wiki\n- [[Wiki/Autotomy]]\n");
		await note(
			"Wiki/Autotomy.md",
			"# 自切\n\n已有认识。[[Library/Papers/source]]\n\n## Human review\n取样条件需要核对。\n",
		);
	}
	await note("Library/Papers/source.md", "# 螳蛉 自切证据\n\n切勿把物种特定结果泛化。\n");
	const service = await getKnowledgeService();
	const prep = await service.prepare({ cwd: a, project: "project-a", query: "自切" });
	await service.request("reconcile");
	return { service, prep };
}
describe("application-wide knowledge ownership", () => {
	it("binds once in A; B inherits Vault and policies without acquiring A results path", async () => {
		const result = await setup();
		const second = await loadWorkspaceConfig(b);
		expect(result.scope).toBe("application");
		expect(result.accessMode).toBe("application-index");
		expect(result.connectionVerified).toBe(false);
		expect(second.obsidianVault).toBe(result.vault);
		expect(second.resultsRoot).toBe(join(b, "results"));
		expect(second.knowledgeProjectId).not.toBe("project-a");
		const local = JSON.parse(await readFile(join(a, ".pi/research-workspace.json"), "utf8"));
		expect(local.knowledgeProjectId).toBe("project-a");
		expect(local.obsidianVault).toBeUndefined();
		await expect(access(join(b, ".pi/research-workspace.json"))).rejects.toMatchObject({ code: "ENOENT" });
		await expect(access(join(a, ".mcp.json"))).rejects.toMatchObject({ code: "ENOENT" });
	});
	it("does not adopt or silently override a legacy project Vault", async () => {
		await mkdir(join(b, ".pi"));
		await writeFile(
			join(b, ".pi/research-workspace.json"),
			JSON.stringify({ obsidianVault: join(root, "old"), resultsRoot: "./special" }),
		);
		expect((await loadWorkspaceConfig(b)).obsidianVault).toBeNull();
		await setup();
		const cfg = await loadWorkspaceConfig(b);
		expect(cfg.obsidianVault).toBe(vault);
		expect(cfg.legacyProjectVault).toBe(join(root, "old"));
		expect(cfg.resultsRoot).toBe(join(b, "special"));
		await expect(saveWorkspaceConfig(b, { obsidianVault: join(root, "other") })).rejects.toThrow(
			"application-wide",
		);
	});
	it("preserves human Home and navigation on setup", async () => {
		await mkdir(vault);
		await note("Home.md", "# 我的知识库\n\n我的组织方式。\n");
		await setup();
		expect(await readFile(join(vault, "Home.md"), "utf8")).toContain("我的组织方式。");
		expect(await readFile(join(vault, "Home.md"), "utf8")).toContain("[[Wiki/Index]]");
		expect(await readFile(join(vault, "Projects/project-a/Context.md"), "utf8")).toContain("尚待用户确认");
	});
	it("rejects corrupt application config instead of falling back to a project", async () => {
		await mkdir(app);
		await writeFile(join(app, "binding.json"), "{bad");
		await expect(loadWorkspaceConfig(b)).rejects.toThrow("cannot be read");
	});
	it("checks confirmation revision and rejects overlapping application data", async () => {
		await setup();
		const binding = await readKnowledgeBinding();
		await expect(saveKnowledgeBinding({ ...binding, subagentPolicy: "none" }, 0)).rejects.toThrow("changed");
		await expect(configureObsidian({ cwd: a, vault: join(app, "notes") })).rejects.toThrow(
			"independent from application",
		);
	});
	it("gives permitted subagents the application policy, not a project-only config", async () => {
		await setup();
		expect(await resolveSubagentMcpAccess(b, {})).toBe("read-local");
		expect(await resolveSubagentMcpAccess(b, { mcpAccess: "none" })).toBe("none");
		expect(await resolveSubagentMcpAccess(b, {}, false)).toBe("none");
	});
});
describe("read-first incremental knowledge service", () => {
	it("shares one service across projects and requires a real navigation ticket", async () => {
		const { service } = await prepared();
		expect(await getKnowledgeService()).toBe(service);
		await expect(service.search("invented", a, { query: "自切" })).rejects.toThrow("navigation");
	});
	it("opens current Wiki during evidence search and returns human review with the note", async () => {
		const { service, prep } = await prepared();
		const result = await service.search(prep.ticket, a, { query: "自切" });
		expect(result.hits.some((hit) => hit.path === "Library/Papers/source.md")).toBe(true);
		expect(result.coverage).toBe("ready");
		const wiki = await service.read(prep.ticket, a, { path: "Wiki/Autotomy.md" });
		expect(wiki.humanReview.text).toContain("取样条件需要核对");
	});
	it("does not reread every body or reconcile on repeated hot searches", async () => {
		const { service, prep } = await prepared({ wiki: false });
		const before = await service.request("status");
		for (let i = 0; i < 8; i++) await service.search(prep.ticket, a, { query: "自切" });
		const after = await service.request("status");
		expect(after.stats.bodyReads).toBe(before.stats.bodyReads);
		expect(after.stats.reconciliations).toBe(before.stats.reconciliations);
	});
	it("updates only changed content and coalesces duplicate update notifications", async () => {
		const { service, prep } = await prepared({ wiki: false });
		const before = await service.request("status");
		await note("Library/Papers/source.md", "# 全新术语 autotomy-beta\n");
		await service.request("changed", { paths: ["Library/Papers/source.md"] });
		await service.request("changed", { paths: ["Library/Papers/source.md"] });
		const after = await service.request("status");
		expect(after.stats.bodyReads - before.stats.bodyReads).toBe(1);
		expect((await service.search(prep.ticket, a, { query: "autotomy-beta" })).hits[0].path).toBe(
			"Library/Papers/source.md",
		);
	});
	it("invalidates search misses after additions and removes deleted evidence", async () => {
		const { service, prep } = await prepared({ wiki: false });
		expect((await service.search(prep.ticket, a, { query: "uniqueevidence" })).hits).toEqual([]);
		await note("Library/Papers/new.md", "# uniqueevidence\n");
		await service.request("changed", { paths: ["Library/Papers/new.md"] });
		expect((await service.search(prep.ticket, a, { query: "uniqueevidence" })).hits).toHaveLength(1);
		await rm(join(vault, "Library/Papers/new.md"));
		await service.request("changed", { paths: ["Library/Papers/new.md"] });
		expect((await service.search(prep.ticket, a, { query: "uniqueevidence" })).hits).toEqual([]);
	});
	it("keeps other project notes outside normal search and direct reads", async () => {
		const { service, prep } = await prepared({ wiki: false });
		await note("Projects/other/Evidence/private.md", "# uniqueprivate\n");
		await service.request("changed", { paths: ["Projects/other/Evidence/private.md"] });
		expect((await service.search(prep.ticket, a, { query: "uniqueprivate" })).hits).toEqual([]);
		await expect(
			service.read(prep.ticket, a, { path: "Projects/other/Evidence/private.md" }),
		).rejects.toThrow("scope");
	});
	it("rejects navigation version changes and foreign turn tickets", async () => {
		const { service, prep } = await prepared({ wiki: false });
		await expect(service.search(prep.ticket, b, { query: "自切" })).rejects.toThrow("navigation");
		await note("Wiki/Index.md", "# Updated topic navigation\n");
		await expect(service.search(prep.ticket, a, { query: "自切" })).rejects.toThrow("Navigation changed");
	});
	it("rejects stale tickets after a global Vault switch", async () => {
		const { service, prep } = await prepared({ wiki: false });
		await configureObsidian({ cwd: b, vault: join(root, "Second Vault") });
		await expect(service.search(prep.ticket, a, { query: "自切" })).rejects.toThrow("binding changed");
	});
	it("does not follow child symlinks or read files outside the Vault", async () => {
		const { service, prep } = await prepared({ wiki: false });
		await writeFile(join(root, "secret.md"), "secret");
		await symlink(join(root, "secret.md"), join(vault, "Library/link.md"));
		await expect(service.read(prep.ticket, a, { path: "Library/link.md" })).rejects.toThrow("symlink");
		await expect(service.read(prep.ticket, a, { path: "../secret.md" })).rejects.toThrow("allowed");
	});
	it("keeps incomplete coverage visible when a note cannot be indexed", async () => {
		const { service, prep } = await prepared({ wiki: false });
		await note("Library/too-big.md", "x".repeat(1024 * 1024 + 1));
		await service.request("reconcile");
		const result = await service.search(prep.ticket, a, { query: "notfound" });
		expect(result.complete).toBe(false);
		expect(result.problems.some((x) => x.path === "Library/too-big.md")).toBe(true);
	});
	it("preserves the index on service restart without rereading unchanged bodies", async () => {
		const { service } = await prepared({ wiki: false });
		const before = await service.request("status");
		await closeKnowledgeServices();
		const next = await getKnowledgeService();
		const after = await next.request("reconcile");
		expect(after.noteCount).toBe(before.noteCount);
		expect(after.stats.bodyReads).toBe(0);
	});
	it("indexes a new deposit immediately while leaving Wiki maintenance queued", async () => {
		const { service, prep } = await prepared({ wiki: false });
		const saved = await depositKnowledge({
			cwd: a,
			project: "project-a",
			type: "evidence",
			title: "New evidence",
			markdown: "brandnewevidence",
			sourceLinks: ["fixture:source"],
		});
		expect(saved.indexes.maintenance).toBe("queued");
		expect((await service.search(prep.ticket, a, { query: "brandnewevidence" })).hits).toHaveLength(1);
		expect(
			(await service.request("jobs", { project: "project-a" })).items.some(
				(x) => x.kind === "evidence-review",
			),
		).toBe(true);
	});
	it("protects human notes and does not rewrite Wiki during navigation maintenance", async () => {
		const { service } = await prepared();
		const original = await readFile(join(vault, "Wiki/Autotomy.md"), "utf8");
		await note(
			"Library/Index.md",
			"# Library\n\n<!-- pi-agent:managed:start -->\nold\n<!-- pi-agent:managed:end -->\n\n## Human review\n保留我的批注\n",
		);
		await service.request("enqueueNavigation", { project: "project-a" });
		const result = await runNavigationMaintenance(service, "project-a", 10);
		expect(result.semanticWikiRewritten).toBe(false);
		expect(await readFile(join(vault, "Library/Index.md"), "utf8")).toContain("保留我的批注");
		expect(await readFile(join(vault, "Wiki/Autotomy.md"), "utf8")).toBe(original);
	});
	it("run-only mode blocks the source archival note side path", async () => {
		await setup({ depositMode: "run-only" });
		expect((await publishSourceNote({ cwd: a, entry: {}, runDir: root })).knowledge_status).toBe(
			"disabled-run-only",
		);
		await expect(
			depositKnowledge({ cwd: a, project: "project-a", type: "paper", title: "x", markdown: "x" }),
		).rejects.toThrow("run-only");
	});
});

describe("Show Me presentation layer", () => {
	it("archives versioned explainers in the Vault while keeping them out of evidence receipts", async () => {
		const { service, prep } = await prepared();
		await service.read(prep.ticket, a, { path: "Library/Papers/source.md" });
		const receipts = await service.evidenceReceipts(prep.ticket, a, ["Library/Papers/source.md"]);
		const out = join(a, "results", "autotomy", "run-20260912113000-test", "show.html");
		await mkdir(join(out, ".."), { recursive: true });
		await writeFile(out, "<!doctype html><title>Autotomy explainer</title><h1>Round one</h1>");
		const first = await publishExplainer({
			cwd: a,
			project: "project-a",
			topicId: "autotomy",
			title: "Autotomy explainer",
			artifactPath: out,
			summary: "A source-grounded visual explanation.",
			sources: receipts.sources,
		});
		expect(first.knowledge_status).toBe("written");
		expect(first.evidenceRole).toBe("presentation-only");
		expect(await readFile(first.attachment, "utf8")).toContain("Round one");
		let noteText = await readFile(first.note, "utf8");
		expect(noteText).toContain("展示层，不是科学证据");
		expect(noteText).toContain("[[Library/Papers/source]]");
		await service.request("reconcile");
		const turn = await service.prepare({ cwd: a, project: "project-a", query: "Autotomy explainer" });
		const page = await service.read(turn.ticket, a, { path: "Library/Explainers/autotomy.md" });
		expect(page.text).toContain("presentation-only");
		expect(
			(
				await service.search(turn.ticket, a, {
					query: "source-grounded visual explanation",
					explainerOnly: true,
				})
			).hits[0].kind,
		).toBe("explainer");
		await service.read(turn.ticket, a, { path: "Wiki/Autotomy.md" });
		expect(
			(await service.search(turn.ticket, a, { query: "source-grounded visual explanation" })).hits,
		).toEqual([]);
		await expect(
			service.evidenceReceipts(turn.ticket, a, ["Library/Explainers/autotomy.md"]),
		).rejects.toThrow("presentation-only");
		expect(
			(await service.currentReadEvidence(turn.ticket, a)).sources.some(
				(x) => x.path === "Library/Explainers/autotomy.md",
			),
		).toBe(false);
		await writeFile(out, "<!doctype html><title>Autotomy explainer</title><h1>Round two</h1>");
		const second = await publishExplainer({
			cwd: a,
			project: "project-a",
			topicId: "autotomy",
			title: "Autotomy explainer",
			artifactPath: out,
			summary: "Updated explanation.",
			sources: receipts.sources,
		});
		expect(second.note).toBe(first.note);
		noteText = await readFile(second.note, "utf8");
		expect((noteText.match(/\[打开讲解\]/g) || []).length).toBe(2);
		expect(noteText).toContain("Updated explanation.");
	});
});

describe("navigation delivery and bounded maintenance", () => {
	function harness(readOnly = false) {
		const tools = new Map(),
			events = new Map();
		const api = {
			registerCommand: () => {},
			registerTool: (t) => tools.set(t.name, t),
			on: (name, fn) => events.set(name, fn),
		};
		return { tools, events, interface: registerKnowledgeInterface(api, { readOnly }) };
	}
	it("auto-stages one shared topic candidate after a successful evidence-gated run summary", async () => {
		await prepared({ wiki: false });
		const h = harness();
		const ctx = { cwd: a, sessionId: "auto-topic" };
		await h.interface.beforeStart({ prompt: "介绍这组研究文献并沉淀可复用主题" }, ctx);
		await h.tools
			.get("research_read_knowledge")
			.execute("read", { path: "Library/Papers/source.md" }, undefined, undefined, ctx);
		const summary =
			"# Insect autotomy evidence\n\nThis completed run compares the observed behavior, its method, scope, evidence limits, and what remains unknown. It is reusable across future literature review while preserving species-specific applicability.";
		await h.events.get("tool_execution_start")(
			{
				toolCallId: "sum",
				toolName: "research_summarize_run",
				args: {
					run_dir: "results/insect-autotomy-20260912/run-fixture",
					result_slug: "insect-autotomy-20260912",
					summary_markdown: summary,
				},
			},
			ctx,
		);
		await h.events.get("tool_execution_end")(
			{
				toolCallId: "sum",
				toolName: "research_summarize_run",
				isError: false,
				result: { details: { summary_saved: true, run: "/tmp/SUMMARY.md" } },
			},
			ctx,
		);
		const pending = await listWikiProposals(await getKnowledgeService(), "project-a");
		expect(pending.items).toHaveLength(1);
		expect(pending.items[0].path).toBe("Wiki/insect-autotomy.md");
		expect(pending.items[0].title).toBe("Insect autotomy evidence");
		await expect(access(join(vault, "Wiki/insect-autotomy.md"))).rejects.toMatchObject({ code: "ENOENT" });
	});
	it("does not fabricate an auto topic when no current evidence note was actually read", async () => {
		await prepared({ wiki: false });
		const h = harness();
		const ctx = { cwd: a, sessionId: "auto-topic-empty" };
		await h.interface.beforeStart({ prompt: "介绍研究并沉淀" }, ctx);
		await h.events.get("tool_execution_start")(
			{
				toolCallId: "sum2",
				toolName: "research_summarize_run",
				args: {
					result_slug: "empty-topic-20260912",
					summary_markdown:
						"# Empty topic\n\nThis is deliberately long enough to pass the summary size check but it has no actual knowledge-note read receipt, so the host must not turn it into a topic candidate.",
				},
			},
			ctx,
		);
		await h.events.get("tool_execution_end")(
			{
				toolCallId: "sum2",
				toolName: "research_summarize_run",
				isError: false,
				result: { details: { summary_saved: true } },
			},
			ctx,
		);
		expect((await listWikiProposals(await getKnowledgeService(), "project-a")).items).toEqual([]);
	});
	it("automatically delivers current navigation and keeps only one context copy", async () => {
		await prepared();
		const h = harness();
		const ctx = { cwd: a };
		const start = await h.interface.beforeStart({ prompt: "自切的知识有哪些？" }, ctx);
		expect(start.message.content).toContain("Wiki/Index.md");
		expect(start.message.content).toContain("project-a");
		expect(start.message.content).not.toContain('"ticket"');
		const messages = [
			{ role: "user", content: "question" },
			{ role: "custom", customType: "percho-knowledge-navigation", content: "OLD" },
		];
		const output = await h.events.get("context")({ messages });
		expect(output.messages.filter((m) => m.customType === "percho-knowledge-navigation")).toHaveLength(1);
		expect(JSON.stringify(output.messages)).not.toContain("OLD");
	});
	it("removes the old navigation payload when the application binding changes", async () => {
		await prepared();
		const h = harness();
		await h.interface.beforeStart({ prompt: "x" }, { cwd: a });
		await configureObsidian({ cwd: b, vault: join(root, "Second Vault") });
		const output = await h.events.get("context")({ messages: [] });
		expect(output.messages[0].content).toContain("binding changed");
		expect(output.messages[0].content).not.toContain("已有认识");
	});
	it("read-only children receive no maintenance or deposition tools", async () => {
		await setup();
		const h = harness(true);
		expect([...h.tools.keys()]).toContain("research_search_knowledge");
		expect([...h.tools.keys()]).not.toContain("research_maintain_knowledge");
		expect([...h.tools.keys()]).not.toContain("research_deposit_knowledge");
	});
	it("Wiki navigation never absorbs unrelated Library entries", async () => {
		const { service } = await prepared();
		await service.request("changed", { paths: ["Wiki/Autotomy.md"] });
		await runNavigationMaintenance(service, "project-a", 10);
		const wikiIndex = await readFile(join(vault, "Wiki/Index.md"), "utf8");
		expect(wikiIndex).toContain("[[Wiki/Autotomy]]");
		expect(wikiIndex).not.toContain("[[Library/Papers/source]]");
	});
	it("navigation jobs remain available under a large evidence review queue", async () => {
		const { service } = await prepared({ wiki: false });
		const paths = [];
		for (let i = 0; i < 120; i++) {
			const path = `Library/Papers/new-${i}.md`;
			paths.push(path);
			await note(path, `# Evidence ${i}\n`);
		}
		for (let i = 0; i < paths.length; i += 50)
			await service.request("changed", { paths: paths.slice(i, i + 50) });
		const result = await runNavigationMaintenance(service, "project-a", 10);
		expect(result.navigation.some((item) => item.path === "Library/Index.md")).toBe(true);
		expect(result.navigation.every((item) => !item.error)).toBe(true);
	});
	it("direct application Wiki writes cannot bypass the review command", async () => {
		await setup();
		await expect(
			depositKnowledge({
				cwd: a,
				project: "project-a",
				type: "wiki",
				targetScope: "shared",
				title: "Shared topic",
				markdown: "draft",
				sourceLinks: ["fixture:source"],
			}),
		).rejects.toThrow("obsidian-review");
		await expect(access(join(vault, "Wiki/shared-topic.md"))).rejects.toMatchObject({ code: "ENOENT" });
	});
});

it("FTS-first query plan does not enumerate all notes through the scope index", async () => {
	const source = await readFile(new URL("../../../.pi/lib/knowledge/worker.mjs", import.meta.url), "utf8");
	const schema = source.match(/db\.exec\(`([\s\S]*?)`\);/)[1];
	const match = source.match(/const rows = db\s*\.prepare\(`([\s\S]*?)`\)\s*\.all\(expression/);
	expect(match).not.toBeNull();
	const query = (match?.[1] ?? "").replace(/\$\{kindFilter\}/g, "AND n.kind!='explainer'");
	const db = new DatabaseSync(":memory:");
	try {
		db.exec(schema);
		const details = db
			.prepare(`EXPLAIN QUERY PLAN ${query}`)
			.all("autotomy", "project-a", 5)
			.map((row) => row.detail);
		expect(details[0]).toMatch(/search VIRTUAL TABLE/);
		expect(details.some((line) => /SEARCH n USING INTEGER PRIMARY KEY/.test(line))).toBe(true);
		expect(details.some((line) => line.includes("notes_scope"))).toBe(false);
	} finally {
		db.close();
	}
});

describe("optional semantic candidate retrieval", () => {
	it("treats semantic retrieval as candidate generation only and still requires an actual read receipt", async () => {
		await setup();
		await note(
			"Library/Papers/semantic-only.md",
			"# Mechanosensory escape circuit\n\nThis note intentionally omits the lexical query token.\n",
		);
		const binding = await readKnowledgeBinding();
		const semantic = new KnowledgeService(binding, app, {
			semanticCandidateProvider: async ({ query }) =>
				query === "nomatchinguniquetoken" ? [{ path: "Library/Papers/semantic-only.md", score: 0.98 }] : [],
		});
		try {
			const prep = await semantic.prepare({ cwd: a, project: "project-a", query: "nomatchinguniquetoken" });
			await semantic.request("reconcile");
			const found = await semantic.search(prep.ticket, a, { query: "nomatchinguniquetoken", limit: 5 });
			expect(found.semantic).toMatchObject({ enabled: true, candidateCount: 1, acceptedCount: 1 });
			expect(found.hits).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						path: "Library/Papers/semantic-only.md",
						retrieval: "semantic-candidate",
					}),
				]),
			);
			await expect(
				semantic.evidenceReceipts(prep.ticket, a, ["Library/Papers/semantic-only.md"]),
			).rejects.toThrow("not read");
			await semantic.read(prep.ticket, a, { path: "Library/Papers/semantic-only.md" });
			const receipts = await semantic.evidenceReceipts(prep.ticket, a, ["Library/Papers/semantic-only.md"]);
			expect(receipts.sources[0]?.path).toBe("Library/Papers/semantic-only.md");
		} finally {
			await semantic.close();
		}
	});
});
