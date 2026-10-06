import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	describeZoteroUpdatePlan,
	executeZoteroUpdate,
	prepareZoteroUpdate,
	receiptWithoutUpdate,
} from "../src/zotero-write-runtime";

const env = { ZOTERO_API_KEY: "k".repeat(24), ZOTERO_LIBRARY_ID: "123", ZOTERO_LIBRARY_TYPE: "users" };
const DOI = "10.1234/gut.2024";

/** In-memory Zotero Web API: one item, two collections, a children list and the file upload protocol. */
function fakeZotero({ write = true, staleVersion = false } = {}) {
	const state = {
		item: {
			key: "DN97UI2G",
			version: 7,
			data: {
				title: "Gut microbes of lacewings",
				DOI,
				itemType: "journalArticle",
				collections: ["AAAA1111"],
			},
		},
		children: [] as any[],
		calls: [] as { method: string; url: string; headers: Record<string, string>; body?: string }[],
		uploaded: null as Buffer | null,
		pendingMd5: undefined as string | undefined,
	};
	const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json", ...headers },
		});
	const fetchImpl = (async (input: string, init: RequestInit = {}) => {
		const url = String(input);
		const method = init.method || "GET";
		const headers = Object.fromEntries(Object.entries((init.headers as Record<string, string>) || {}));
		const body =
			typeof init.body === "string"
				? init.body
				: init.body
					? Buffer.from(init.body as Buffer).toString("latin1")
					: undefined;
		state.calls.push({ method, url, headers, body });
		const path = url.replace("https://api.zotero.org", "");
		if (path === "/keys/current")
			return json({ userID: 123, username: "lab", access: { user: { library: true, write } } });
		if (path.startsWith("/users/123/items?") && path.includes("q="))
			return json([{ key: state.item.key, data: state.item.data }], 200, { "Total-Results": "1" });
		if (path.startsWith("/users/123/collections?"))
			return json(
				[
					{ key: "AAAA1111", data: { name: "Inbox" } },
					{ key: "97GKN8YV", data: { name: "脉翅目肠道微生物" } },
				],
				200,
				{ "Total-Results": "2" },
			);
		if (path === `/users/123/items/${state.item.key}?format=json` && method === "GET")
			return json({ key: state.item.key, version: state.item.version, data: state.item.data });
		if (path.startsWith(`/users/123/items/${state.item.key}/children`)) return json(state.children);
		if (path === `/users/123/items/${state.item.key}` && method === "PATCH") {
			if (staleVersion || headers["If-Unmodified-Since-Version"] !== String(state.item.version))
				return new Response("", { status: 412 });
			state.item.data.collections = JSON.parse(body || "{}").collections;
			state.item.version++;
			return new Response(null, { status: 204 });
		}
		if (path === "/users/123/items" && method === "POST") {
			const [entry] = JSON.parse(body || "[]");
			const key = `ATT${String(state.children.length).padStart(5, "0")}`;
			state.children.push({ key, data: { ...entry } });
			return json({ successful: { 0: { key } }, failed: {} });
		}
		if (/\/users\/123\/items\/ATT\d+\/file$/.test(path)) {
			const params = new URLSearchParams(body);
			if (params.get("upload")) {
				const child = state.children.find((c) => path.includes(c.key));
				child.data.md5 = state.pendingMd5;
				return new Response(null, { status: 204 });
			}
			state.pendingMd5 = params.get("md5") ?? undefined;
			return json({
				url: "https://storage.example/upload",
				contentType: "multipart/form-data; boundary=x",
				prefix: "PRE",
				suffix: "SUF",
				uploadKey: "UPKEY",
			});
		}
		if (url === "https://storage.example/upload") {
			state.uploaded = Buffer.from(body || "", "latin1");
			return new Response(null, { status: 201 });
		}
		return new Response("unexpected", { status: 500 });
	}) as unknown as typeof fetch;
	return { state, fetchImpl } as { state: typeof state & { pendingMd5?: string }; fetchImpl: typeof fetch };
}

let cwd: string;
beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "drone-zotero-update-"));
	await mkdir(join(cwd, "papers"));
	await writeFile(join(cwd, "papers", "paper.pdf"), "%PDF-1.7\nfixture pdf body\n");
	await writeFile(join(cwd, "papers", "fake.pdf"), "not a pdf");
});
afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

describe("zotero update of an existing item", () => {
	it("blocks with guidance when no Web API key is configured", async () => {
		const plan = await prepareZoteroUpdate({ doi: DOI, collection_name: "x" }, { env: {}, cwd });
		expect(plan.action).toBe("blocked");
		expect(plan.reason).toMatch(/Settings → Zotero → Web API/);
		expect(receiptWithoutUpdate(plan)).toMatchObject({ status: "blocked", write: { performed: false } });
	});

	it("files the item into a collection by name and uploads a local PDF, then reads both back", async () => {
		const { state, fetchImpl } = fakeZotero();
		const plan = await prepareZoteroUpdate(
			{ doi: DOI, collection_name: "脉翅目肠道微生物", local_file: "papers/paper.pdf" },
			{ env, cwd, fetchImpl },
		);
		expect(plan.action).toBe("update");
		expect(plan.changes.addCollection).toEqual({ key: "97GKN8YV", name: "脉翅目肠道微生物" });
		expect(plan.changes.uploadFile).toMatchObject({
			relativePath: "papers/paper.pdf",
			filename: "paper.pdf",
		});
		expect(describeZoteroUpdatePlan(plan)).toContain("加入分类「脉翅目肠道微生物」");

		const receipt = await executeZoteroUpdate(plan, { env, fetchImpl });
		expect(receipt.status).toBe("updated");
		expect(state.item.data.collections).toEqual(["AAAA1111", "97GKN8YV"]);
		expect(receipt.changes.addCollection.verified).toBe(true);
		expect(receipt.changes.uploadFile).toMatchObject({ verified: true, error: null });
		expect(state.uploaded?.toString("latin1")).toBe("PRE%PDF-1.7\nfixture pdf body\nSUF");
		const patch = state.calls.find((call) => call.method === "PATCH");
		expect(patch?.headers["If-Unmodified-Since-Version"]).toBe("7");
	});

	it("is unchanged when the item is already filed, and refuses non-PDF or out-of-project files", async () => {
		const { fetchImpl } = fakeZotero();
		const plan = await prepareZoteroUpdate(
			{ zotero_key: "DN97UI2G", collection_key: "AAAA1111" },
			{ env, cwd, fetchImpl },
		);
		expect(plan.action).toBe("unchanged");
		await expect(
			prepareZoteroUpdate({ zotero_key: "DN97UI2G", local_file: "papers/fake.pdf" }, { env, cwd, fetchImpl }),
		).rejects.toThrow(/not a PDF/);
		await expect(
			prepareZoteroUpdate({ zotero_key: "DN97UI2G", local_file: "/etc/hostname" }, { env, cwd, fetchImpl }),
		).rejects.toThrow(/inside the current project|ENOENT/);
	});

	it("reports a concurrent edit instead of overwriting it, and needs a write-scoped key", async () => {
		const stale = fakeZotero({ staleVersion: true });
		const plan = await prepareZoteroUpdate(
			{ zotero_key: "DN97UI2G", collection_key: "97GKN8YV" },
			{ env, cwd, fetchImpl: stale.fetchImpl },
		);
		const receipt = await executeZoteroUpdate(plan, { env, fetchImpl: stale.fetchImpl });
		expect(receipt.status).toBe("failed");
		expect(receipt.changes.addCollection.error).toMatch(/changed in Zotero/);

		const readOnly = fakeZotero({ write: false });
		const blocked = await prepareZoteroUpdate(
			{ zotero_key: "DN97UI2G", collection_key: "97GKN8YV" },
			{ env, cwd, fetchImpl: readOnly.fetchImpl },
		);
		expect(blocked).toMatchObject({ action: "blocked" });
		expect(blocked.reason).toMatch(/no write permission/);
	});
});
