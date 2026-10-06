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

const localEnv = { ZOTERO_LOCAL_API_KEY: "LOCALKEY123", ZOTERO_LOCAL_SERVER_ID: "SRV1" };

/**
 * In-memory Zotero: one item, two collections, a children list and the file upload protocol, served either
 * as the Web API (users/123) or as Zotero 10's local API (users/0, Zotero-Server-ID + local key on writes).
 */
function fakeZotero({ write = true, staleVersion = false, local = false, serverId = "SRV1" } = {}) {
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
		const localUpload = "http://127.0.0.1:23119/upload/x";
		if (local) {
			if (url === "http://127.0.0.1:23119/api/")
				return new Response("Nothing to see here.", {
					status: 200,
					headers: { "Zotero-Server-ID": serverId },
				});
			if (url === localUpload) {
				if (headers["Zotero-Server-ID"] !== serverId) return new Response("", { status: 428 });
				state.uploaded = Buffer.from(body || "", "latin1");
				return new Response(null, { status: 201 });
			}
			if (!url.startsWith("http://127.0.0.1:23119/api/users/0/"))
				return new Response("unexpected", { status: 500 });
			if (method !== "GET") {
				if (headers["Zotero-Server-ID"] !== serverId) return new Response("", { status: 428 });
				if (headers["Zotero-API-Key"] !== localEnv.ZOTERO_LOCAL_API_KEY)
					return new Response("", { status: 401 });
			}
		}
		const path = local
			? url.replace("http://127.0.0.1:23119/api", "").replace("/users/0/", "/users/123/")
			: url.replace("https://api.zotero.org", "");
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
				url: local ? localUpload : "https://storage.example/upload",
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
	it("blocks with guidance when neither local writes nor a Web API key are configured", async () => {
		const plan = await prepareZoteroUpdate({ doi: DOI, collection_name: "x" }, { env: {}, cwd });
		expect(plan.action).toBe("blocked");
		expect(plan.reason).toMatch(/authorize local writes/);
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

	it("writes through Zotero 10's local API with the local key, keeping the PDF on this computer", async () => {
		const { state, fetchImpl } = fakeZotero({ local: true });
		const plan = await prepareZoteroUpdate(
			{ zotero_key: "DN97UI2G", collection_name: "脉翅目肠道微生物", local_file: "papers/paper.pdf" },
			{ env: localEnv, cwd, fetchImpl },
		);
		expect(plan).toMatchObject({ action: "update", channel: "local", target: { local: true } });
		expect(describeZoteroUpdatePlan(plan)).toContain("不占云存储配额");
		const receipt = await executeZoteroUpdate(plan, { env: localEnv, fetchImpl });
		expect(receipt).toMatchObject({ status: "updated", channel: "local", library: { local: true } });
		expect(state.item.data.collections).toEqual(["AAAA1111", "97GKN8YV"]);
		expect(state.uploaded?.toString("latin1")).toBe("PRE%PDF-1.7\nfixture pdf body\nSUF");
		// every local request stays on the loopback API; nothing goes to api.zotero.org
		expect(state.calls.every((call) => call.url.startsWith("http://127.0.0.1:23119/"))).toBe(true);
		const patch = state.calls.find((call) => call.method === "PATCH");
		expect(patch?.headers).toMatchObject({ "Zotero-Server-ID": "SRV1", "Zotero-API-Key": "LOCALKEY123" });
	});

	it("does not use a local key that belongs to another Zotero database", async () => {
		const { fetchImpl } = fakeZotero({ local: true, serverId: "OTHERDB" });
		const plan = await prepareZoteroUpdate(
			{ zotero_key: "DN97UI2G", collection_key: "97GKN8YV" },
			{
				env: localEnv,
				cwd,
				fetchImpl,
			},
		);
		expect(plan.action).toBe("blocked");
		expect(plan.reason).toMatch(/different Zotero database/);
	});

	it("prefers the Web API when it is configured for a group library", async () => {
		const { fetchImpl } = fakeZotero();
		const plan = await prepareZoteroUpdate(
			{ zotero_key: "DN97UI2G", collection_key: "97GKN8YV" },
			{ env: { ...localEnv, ...env, ZOTERO_LIBRARY_TYPE: "groups" }, cwd, fetchImpl },
		);
		expect(plan.channel).toBe("web");
	});
});
