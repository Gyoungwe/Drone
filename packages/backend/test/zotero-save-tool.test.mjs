import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saveWorkspaceConfig } from "../../../.pi/extensions/workspace-config.mjs";
import zoteroLiterature from "../../../.pi/extensions/zotero-literature.mjs";
import { beginKnowledgeFlow, flowFor, noteKnowledgeOperation } from "../../../.pi/lib/knowledge/ui-state.mjs";
import { startResearchRun } from "../../../.pi/lib/research-loop.mjs";
import { createTaskWorkbench, WORKBENCH_ENTRY } from "../../../.pi/lib/tasks/workbench.mjs";
import { detectCapabilities, READ_ONLY_LIBRARY_TOOLS, toolCapabilities } from "../src/capabilities/runtime";

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
	expect(READ_ONLY_LIBRARY_TOOLS.has("research_zotero_save")).toBe(false);
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
	expect(grant.zoteroItems).toEqual([{ milestoneId: "lit", doi: DOI, libraryId: null, collection: null }]);
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
it("the context panel receives one merged literature receipt per DOI", async () => {
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
	expect(flowFor("session-ui").literature).toEqual([
		expect.objectContaining({
			doi: DOI,
			zotero: "verified",
			zoteroKey: "ABCD1234",
			obsidian: "unknown",
			source: "zotero-save",
		}),
	]);
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
	const rows = flowFor("session-ui").literature;
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({
		zotero: "verified",
		obsidian: "verified",
		notePath: "Library/Papers/example.md",
		fulltextStatus: "attachment-indexed-not-read",
		channel: "connector",
		library: "My Library",
		source: "verify",
	});
	noteKnowledgeOperation(ctx, {
		toolName: "research_zotero_save",
		toolCallId: "c",
		isError: true,
		result: {},
	});
	expect(flowFor("session-ui").literature).toHaveLength(1);
});
