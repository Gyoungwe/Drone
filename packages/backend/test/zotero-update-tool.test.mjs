import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runZoteroUpdate } from "@drone/extensions/zotero-literature";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = { ZOTERO_API_KEY: "k".repeat(24), ZOTERO_LIBRARY_ID: "123" };
function fakeFetch() {
	const calls = [];
	const json = (body, headers = {}) =>
		new Response(JSON.stringify(body), {
			status: 200,
			headers: { "Content-Type": "application/json", ...headers },
		});
	const fetchImpl = vi.fn(async (url, init = {}) => {
		const path = String(url).replace("https://api.zotero.org", "");
		calls.push({ method: init.method || "GET", path });
		if (path === "/keys/current")
			return json({ userID: 123, username: "lab", access: { user: { library: true, write: true } } });
		if (path.startsWith("/users/123/collections"))
			return json([{ key: "97GKN8YV", data: { name: "Lacewings" } }], { "Total-Results": "1" });
		if (path.startsWith("/users/123/items/DN97UI2G?"))
			return json({ key: "DN97UI2G", version: 3, data: { title: "T", DOI: "10.1/x", collections: [] } });
		if (path.startsWith("/users/123/items/DN97UI2G/children")) return json([]);
		if (init.method === "PATCH") return new Response(null, { status: 204 });
		return new Response("unexpected", { status: 500 });
	});
	return { fetchImpl, calls };
}
const pi = { events: { emit: vi.fn() } };
let cwd;
beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "drone-zotero-tool-"));
});
afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

describe("research_zotero_update consent", () => {
	it("asks on a native card and writes nothing when the user declines", async () => {
		const { fetchImpl, calls } = fakeFetch();
		const select = vi.fn(async (_title, options) => options[0]);
		const receipt = await runZoteroUpdate(
			pi,
			{ zotero_key: "DN97UI2G", collection_name: "Lacewings" },
			{ cwd, hasUI: true, ui: { select } },
			undefined,
			{ fetchImpl, env },
		);
		expect(select).toHaveBeenCalledOnce();
		expect(select.mock.calls[0][0]).toContain("加入分类「Lacewings」");
		expect(receipt.status).toBe("cancelled");
		expect(calls.some((call) => call.method === "PATCH")).toBe(false);
	});

	it("files the item after approval and refuses without any UI", async () => {
		const { fetchImpl, calls } = fakeFetch();
		const receipt = await runZoteroUpdate(
			pi,
			{ zotero_key: "DN97UI2G", collection_key: "97GKN8YV" },
			{ cwd, hasUI: true, ui: { select: async (_title, options) => options[1] } },
			undefined,
			{ fetchImpl, env },
		);
		expect(calls.some((call) => call.method === "PATCH")).toBe(true);
		expect(receipt.consent.via).toBe("ask-card");
		await expect(
			runZoteroUpdate(
				pi,
				{ zotero_key: "DN97UI2G", collection_key: "97GKN8YV" },
				{ cwd, hasUI: false },
				undefined,
				{
					fetchImpl,
					env,
				},
			),
		).rejects.toThrow(/interactive desktop confirmation/);
	});

	it("reports blocked (no card) when the Web API is not configured", async () => {
		const select = vi.fn();
		const receipt = await runZoteroUpdate(
			pi,
			{ doi: "10.1/x", collection_name: "x" },
			{ cwd, hasUI: true, ui: { select } },
			undefined,
			{
				env: {},
			},
		);
		expect(receipt.status).toBe("blocked");
		expect(select).not.toHaveBeenCalled();
	});
});
