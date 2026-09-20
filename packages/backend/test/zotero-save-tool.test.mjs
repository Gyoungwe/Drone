import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import sourceArchive from "../../../.pi/extensions/source-archive.mjs";
import { saveWorkspaceConfig } from "../../../.pi/extensions/workspace-config.mjs";
import zoteroLiterature from "../../../.pi/extensions/zotero-literature.mjs";
import { beginKnowledgeFlow, flowFor, noteKnowledgeOperation } from "../../../.pi/lib/knowledge/ui-state.mjs";
import { startResearchRun } from "../../../.pi/lib/research-loop.mjs";
import { createTaskWorkbench, WORKBENCH_ENTRY } from "../../../.pi/lib/tasks/workbench.mjs";
import { detectCapabilities, isReadOnlyLibraryTool, toolCapabilities } from "../src/capabilities/runtime";

const DOI = "10.1234/example.2024";
const ITEM = {
	key: "ABCD1234",
	data: { key: "ABCD1234", title: "Example", itemType: "journalArticle", DOI, collections: [] },
};
let cwd, runDir, saves, saved, tools, listeners;

function fakePi() {
	tools = new Map();
	listeners = new Map();
	return {
		registerTool: (tool) => tools.set(tool.name, tool),
		registerCommand: () => {},
		on: () => {},
		events: {
			on: (name, fn) => listeners.set(name, fn),
			emit: async (name, payload) => {
				await listeners.get(name)?.(payload);
			},
		},
	};
}
function stubZotero() {
	saves = 0;
	saved = false;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url, init = {}) => {
			const u = new URL(String(url));
			const json = (body, status = 200, headers = {}) =>
				new Response(JSON.stringify(body), {
					status,
					headers: { "Content-Type": "application/json", ...headers },
				});
			if (u.pathname === "/connector/ping") return json({});
			if (u.pathname === "/connector/getSelectedCollection")
				return json({
					libraryID: 1,
					libraryName: "My Library",
					libraryEditable: true,
					editable: true,
					id: null,
					name: "My Library",
				});
			if (u.pathname === "/connector/saveItems") {
				saves += 1;
				saved = true;
				expect(init.method).toBe("POST");
				return json({ items: [] }, 201);
			}
			if (u.pathname === "/api/users/0/items") {
				const items = saved ? [ITEM] : [];
				return json(items, 200, { "Total-Results": String(items.length) });
			}
			if (u.pathname.endsWith("/children")) return json([], 200, { "Total-Results": "0" });
			return new Response("not found", { status: 404 });
		}),
	);
}
const ctxFor = ({ hasUI = true, select } = {}) => ({
	cwd,
	hasUI,
	sessionManager: { getSessionId: () => "session-z" },
	ui: select ? { select } : undefined,
});
const params = (extra = {}) => ({
	doi: DOI,
	title: "Example paper",
	creators: [{ last_name: "Doe", first_name: "Jane" }],
	date: "2024",
	publication: "Journal of Examples",
	...extra,
});
beforeEach(async () => {
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	vi.stubEnv("ZOTERO_API_KEY", undefined);
	vi.stubEnv("PI_SUBAGENT_CHILD", undefined);
	cwd = await mkdtemp(join(tmpdir(), "zotero-save-"));
	await mkdir(join(cwd, "Vault"));
	await saveWorkspaceConfig(cwd, { obsidianVault: join(cwd, "Vault") });
	runDir = (await startResearchRun({ cwd, resultSlug: "fixture", query: "test" })).run_dir;
	stubZotero();
});
afterEach(async () => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	await rm(cwd, { recursive: true, force: true });
});
const run = (ctx, extra) =>
	tools.get("research_zotero_save").execute("call-1", params(extra), undefined, () => {}, ctx);

it("registers a write tool that is neither read-only nor available to subagents", () => {
	zoteroLiterature(fakePi());
	expect(tools.has("research_zotero_save")).toBe(true);
	// 只读文献模式 / 能力路由都读 registerTool 的 drone 声明（挂钩 1），核心没有名字表
	expect(isReadOnlyLibraryTool("research_zotero_save")).toBe(false);
	expect(isReadOnlyLibraryTool("research_zotero_status")).toBe(true);
	expect(toolCapabilities("research_zotero_save")).toEqual(["research", "external"]);
	expect(detectCapabilities("请把这篇论文存进 Zotero 文献库")).toEqual(
		expect.arrayContaining(["research", "external"]),
	);
	vi.stubEnv("PI_SUBAGENT_CHILD", "1");
	zoteroLiterature(fakePi());
	expect(tools.size).toBe(0);
});
it("asks on the native card and a declined card writes nothing", async () => {
	const pi = fakePi();
	zoteroLiterature(pi);
	const select = vi.fn(async () => "暂不写入");
	const result = await run(ctxFor({ select }));
	expect(select).toHaveBeenCalledTimes(1);
	const [question, options] = select.mock.calls[0];
	expect(question).toContain("ask_user · 写入 Zotero 文献库？");
	expect(question).toContain(DOI);
	expect(question).toContain("My Library");
	expect(options).toEqual(["暂不写入", "同意写入 Zotero"]);
	expect(result.details).toMatchObject({
		status: "cancelled",
		writesToLibraries: 0,
		consent: { via: "ask-card" },
	});
	expect(saves).toBe(0);
});
it("an accepted card writes exactly once, reads back and journals the receipt into the run", async () => {
	const pi = fakePi();
	zoteroLiterature(pi);
	const result = await run(ctxFor({ select: async () => "同意写入 Zotero" }), { run_dir: runDir });
	expect(result.details).toMatchObject({
		status: "saved",
		zoteroKey: "ABCD1234",
		zoteroSelect: "zotero://select/library/items/ABCD1234",
		consent: { via: "ask-card" },
		writesToLibraries: 1,
	});
	expect(saves).toBe(1);
	expect(result.details.journal.writes).toBe(1);
	const journal = JSON.parse(await readFile(join(runDir, "literature-operations.json"), "utf8"));
	expect(journal.version).toBe(1);
	expect(journal.writes[0]).toMatchObject({
		doi: DOI,
		status: "saved",
		zoteroKey: "ABCD1234",
		channel: "connector",
	});
	expect(result.details.next).toContain("research_deposit_knowledge");
});
it("an authorized task plan naming the DOI as a zotero_item milestone covers the write without a second card", async () => {
	const pi = fakePi();
	zoteroLiterature(pi);
	const entries = [];
	const journal = createTaskWorkbench({
		requireAuthorization: true,
		persist: (data) => entries.push({ customType: WORKBENCH_ENTRY, data }),
	});
	journal.attach("session-z");
	journal.begin("把这篇论文收进 Zotero 并写笔记");
	journal.plan({
		summary: "只写入这一篇文献。",
		milestones: [{ id: "lit", title: "文献入库", acceptance: { kind: "zotero_item", doi: DOI } }],
	});
	const act = (action) =>
		journal.command({ taskId: journal.snapshot().id, revision: journal.view().revision, action });
	act("authorize-task");
	const grant = journal.authorization(true);
	// 通用里程碑验收清单（挂钩 2）：zotero_item 由扩展登记的验收器贡献 DOI 条目
	expect(grant.acceptances).toEqual([
		{ milestoneId: "lit", kind: "zotero_item", doi: DOI, libraryId: null, collection: null },
	]);
	pi.events.on("drone:task-write-consent", (request) => {
		if (request.cwd === cwd && request.sessionId === "session-z")
			request.respond(journal.authorization(true));
	});
	const select = vi.fn();
	const result = await run(ctxFor({ select }));
	expect(select).not.toHaveBeenCalled();
	expect(result.details).toMatchObject({
		status: "saved",
		consent: { via: "task-plan", milestoneId: "lit" },
	});
	expect(saves).toBe(1);
	// A different DOI is outside the approved contract and must go back to the card.
	saved = false;
	const other = await run(ctxFor({ select: vi.fn(async () => "暂不写入") }), { doi: "10.1234/other" });
	expect(other.details.status).toBe("cancelled");
	expect(saves).toBe(1);
});
it("a DOI-less zotero_item milestone is a one-write slot covered by the task authorization; extra papers go back to the card", async () => {
	const pi = fakePi();
	zoteroLiterature(pi);
	const journal = createTaskWorkbench({ requireAuthorization: true, persist: () => {} });
	journal.attach("session-z");
	journal.begin("精读后把文献收进 Zotero");
	journal.plan({
		summary: "精读一篇并写入 Zotero。",
		milestones: [{ id: "lit", title: "精读文献进入 Zotero", acceptance: { kind: "zotero_item" } }],
	});
	journal.command({
		taskId: journal.snapshot().id,
		revision: journal.view().revision,
		action: "authorize-task",
	});
	// 授权卡上写明的槽位进入写入同意：没有 DOI，只有 slot 标记
	expect(journal.authorization(true).acceptances).toEqual([
		{ milestoneId: "lit", kind: "zotero_item", slot: true, libraryId: null, collection: null },
	]);
	pi.events.on("drone:task-write-consent", (request) => {
		if (request.cwd === cwd && request.sessionId === "session-z")
			request.respond(journal.authorization(true));
	});
	const select = vi.fn(async () => "暂不写入");
	// 同一批并行写入两篇、只有一个槽位：恰好一篇经槽位放行，另一篇回到确认卡（这里被拒绝）
	const [first, second] = await Promise.all([
		run(ctxFor({ select })),
		run(ctxFor({ select }), { doi: "10.1234/other" }),
	]);
	const bySlot = [first, second].find((r) => r.details.consent.via === "task-plan-slot");
	const byCard = [first, second].find((r) => r.details.consent.via === "ask-card");
	expect(bySlot.details).toMatchObject({ status: "saved", consent: { milestoneId: "lit" } });
	expect(byCard.details.status).toBe("cancelled");
	expect(select).toHaveBeenCalledTimes(1);
	expect(saves).toBe(1);
	// 宿主按回执把 DOI 绑到槽位后，这一项不再为别的文献放行
	const event = {
		toolName: "research_zotero_save",
		toolCallId: "slot-1",
		input: { doi: bySlot.details.doi },
	};
	expect(journal.guard(event)).toBeNull();
	await journal.observe({ ...event, details: bySlot.details, content: [] }, cwd);
	expect(journal.snapshot().milestones[0].bound).toMatchObject({ fields: { doi: bySlot.details.doi } });
	expect(journal.authorization(true).acceptances).toEqual([]);
	saved = false;
	const third = await run(ctxFor({ select }), { doi: "10.1234/third" });
	expect(third.details).toMatchObject({ status: "cancelled", consent: { via: "ask-card" } });
	expect(saves).toBe(1);
});
it("headless sessions cannot write without task consent; existing items are reused silently", async () => {
	const pi = fakePi();
	zoteroLiterature(pi);
	await expect(run(ctxFor({ hasUI: false }))).rejects.toThrow(/interactive desktop confirmation/);
	expect(saves).toBe(0);
	saved = true;
	const reused = await run(ctxFor({ hasUI: false }));
	expect(reused.details).toMatchObject({
		status: "reused",
		zoteroKey: "ABCD1234",
		consent: { via: "not-needed" },
	});
	expect(saves).toBe(0);
});
it("the context panel receives one merged literature card per DOI", async () => {
	zoteroLiterature(fakePi());
	sourceArchive(fakePi());
	const ctx = { sessionManager: { getSessionId: () => "session-ui" } };
	beginKnowledgeFlow(ctx, { vaultId: "v", revision: 3, vault: "/vault" });
	noteKnowledgeOperation(ctx, {
		toolName: "research_zotero_save",
		toolCallId: "a",
		result: {
			details: {
				doi: DOI,
				title: "Example",
				status: "saved",
				zoteroKey: "ABCD1234",
				channel: "connector",
				library: { name: "My Library" },
				fulltextStatus: "metadata-only",
			},
		},
	});
	const field = (label) => flowFor("session-ui").cards[0].fields.find((f) => f.label === label);
	expect(flowFor("session-ui").cards).toEqual([
		expect.objectContaining({
			key: `doi:${DOI}`,
			kind: "literature",
			title: "Example",
			subtitle: `DOI ${DOI}`,
			status: "saved",
			source: "research_zotero_save",
		}),
	]);
	expect(field("Zotero")).toMatchObject({ value: "verified", code: "ABCD1234", note: "连接器 · My Library" });
	expect(field("Vault 笔记")).toMatchObject({ value: "unknown", i18n: "flow.field.vaultNote" });
	expect(field("全文")).toMatchObject({ value: "metadata-only" });
	noteKnowledgeOperation(ctx, {
		toolName: "research_verify_literature",
		toolCallId: "b",
		result: {
			details: {
				doi: DOI,
				zoteroKey: "ABCD1234",
				status: "both-verified",
				zotero: { status: "verified", fulltextStatus: "attachment-indexed-not-read" },
				obsidian: { status: "verified", path: "Library/Papers/example.md" },
			},
		},
	});
	const cards = flowFor("session-ui").cards;
	expect(cards).toHaveLength(1);
	expect(cards[0]).toMatchObject({
		title: "Example",
		status: "both-verified",
		path: "Library/Papers/example.md",
		source: "research_verify_literature",
	});
	// 后来的核对不会抹掉已知事实（渠道 / 库名），但会补上笔记路径与全文状态
	expect(field("Zotero")).toMatchObject({ value: "verified", code: "ABCD1234", note: "连接器 · My Library" });
	expect(field("Vault 笔记")).toMatchObject({ value: "verified", code: "Library/Papers/example.md" });
	expect(field("全文")).toMatchObject({ value: "attachment-indexed-not-read" });
	expect(cards[0].links.map((link) => link.kind).sort()).toEqual(["external", "note", "resource"]);
	noteKnowledgeOperation(ctx, {
		toolName: "research_zotero_save",
		toolCallId: "c",
		isError: true,
		result: {},
	});
	const after = flowFor("session-ui").cards;
	expect(after.filter((card) => card.kind === "literature")).toHaveLength(1);
	expect(after.find((card) => card.kind === "failure")).toMatchObject({
		status: "failed",
		source: "research_zotero_save",
	});
});
