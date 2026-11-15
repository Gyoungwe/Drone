import sourceArchive from "@drone/extensions/source-archive";
import zoteroLiterature, { identifyZoteroReceipt } from "@drone/extensions/zotero-literature";
import { beginKnowledgeFlow, flowFor, noteKnowledgeOperation } from "@gyoungwe/pi-knowledge/host";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { detectCapabilities, isReadOnlyLibraryTool, toolCapabilities } from "../src/capabilities/runtime";
import { createManagedResearchRuntime, registerResearchToolMeta, stubPi } from "./tool-manifest-fixture.mjs";

const DOI = "10.1234/example.2024";
const ITEM = {
	key: "ABCD1234",
	data: { key: "ABCD1234", title: "Example", itemType: "journalArticle", DOI, collections: [] },
};

/** Only Zotero is simulated; registration and receipt/card construction use the shipped runtime. */
async function managedSave() {
	const state = { saved: false, calls: [] };
	const json = (value, status = 200, headers = {}) => ({
		status,
		headers: { "content-type": "application/json", ...headers },
		base64: Buffer.from(JSON.stringify(value)).toString("base64"),
	});
	const runtime = await createManagedResearchRuntime({
		capabilities: {
			call: async (name, input) => {
				if (name === "credentials.status") return { slots: {} };
				if (name === "task.grant.allowances") return { allowances: [] };
				const { host, pathname } = new URL(input.url);
				if (host !== "127.0.0.1:23119") throw new Error(`Unexpected upstream ${host}`);
				state.calls.push(`${name} ${input.method} ${pathname}`);
				if (pathname === "/connector/ping") return json({});
				if (pathname === "/connector/getSelectedCollection")
					return json({ libraryID: 1, libraryName: "My Library", libraryEditable: true });
				if (pathname === "/connector/saveItems") {
					state.saved = true;
					return json({}, 201);
				}
				if (pathname === "/api/users/0/items") {
					const items = state.saved ? [ITEM] : [];
					return json(items, 200, { "total-results": String(items.length) });
				}
				if (pathname.endsWith("/children")) return json([], 200, { "total-results": "0" });
				throw new Error(`Unexpected Zotero request ${input.method} ${pathname}`);
			},
		},
	});
	const native = await runtime.createNativeSession();
	const tools = new Map();
	native.extension(stubPi(tools));
	const result = await tools.get("research_zotero_save").execute("save", { doi: DOI, title: "Example" });
	await native.dispose();
	await runtime.dispose();
	return { result, calls: state.calls };
}

beforeEach(() => {
	registerResearchToolMeta();
	sourceArchive(stubPi());
});
afterEach(() => vi.unstubAllEnvs());

it("routes the managed Zotero metadata and keeps writes out of read-only library mode and subagents", () => {
	const tools = registerResearchToolMeta();
	expect(tools.has("research_zotero_save")).toBe(true);
	expect(tools.get("research_zotero_save").drone.subagent).toBe("exclude");
	expect(isReadOnlyLibraryTool("research_zotero_save")).toBe(false);
	expect(isReadOnlyLibraryTool("research_zotero_status")).toBe(true);
	expect(isReadOnlyLibraryTool("research-zotero_search")).toBe(true);
	expect(toolCapabilities("research_zotero_save")).toEqual(["research", "external"]);
	expect(detectCapabilities("请把这篇论文存进 Zotero 文献库")).toEqual(
		expect.arrayContaining(["research", "external"]),
	);
	vi.stubEnv("PI_SUBAGENT_CHILD", "1");
	const childTools = new Map();
	zoteroLiterature(stubPi(childTools));
	expect(childTools.size).toBe(0);
});

it("preserves the managed read-back receipt and its bindable DOI alongside details.cards", async () => {
	const { result, calls } = await managedSave();
	expect(result.details).toMatchObject({
		status: "saved",
		zoteroKey: "ABCD1234",
		zoteroSelect: "zotero://select/library/items/ABCD1234",
		consent: { via: "host-dialog" },
		writesToLibraries: 1,
	});
	expect(calls.filter((call) => call.startsWith("network.write"))).toEqual([
		"network.write POST /connector/saveItems",
	]);
	const write = calls.indexOf("network.write POST /connector/saveItems");
	expect(calls.slice(write + 1)).toContain("network.read GET /api/users/0/items");
	expect(identifyZoteroReceipt({ toolName: "research_zotero_save" }, result.details)).toEqual({ doi: DOI });
	expect(result.details.next).toContain("research_deposit_knowledge");
	const { cards, ...receipt } = result.details;
	expect(cards).toHaveLength(1);
	expect(result.content).toEqual([{ type: "text", text: JSON.stringify(receipt, null, 2) }]);
});

it("merges the managed details.cards into one KnowledgeFlow literature card per DOI", async () => {
	const { result } = await managedSave();
	const ctx = { sessionManager: { getSessionId: () => "session-ui" } };
	beginKnowledgeFlow(ctx, { vaultId: "v", revision: 3, vault: "/vault" });
	noteKnowledgeOperation(ctx, { toolName: "research_zotero_save", toolCallId: "a", result });
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
	expect(field("Zotero")).toMatchObject({ value: "verified", code: "ABCD1234", note: "连接器 · My Library" });
	expect(field("Vault 笔记")).toMatchObject({ value: "verified", code: "Library/Papers/example.md" });
	expect(field("全文")).toMatchObject({ value: "attachment-indexed-not-read" });
	expect(cards[0].links.map((link) => link.kind).sort()).toEqual(["external", "note", "resource"]);
});
