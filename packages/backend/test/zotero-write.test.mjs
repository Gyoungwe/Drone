import { describe, expect, it, vi } from "vitest";
import {
	createCompositeZoteroReconciler,
	createLocalZoteroReconciler,
} from "../../../.pi/lib/zotero-reconcile.mjs";
import {
	describeZoteroSavePlan,
	executeZoteroSave,
	normalizeZoteroItem,
	prepareZoteroSave,
	receiptWithoutWrite,
	toConnectorItem,
	toWebApiItem,
} from "../../../.pi/lib/zotero-write.mjs";

const DOI = "10.1234/example.2024";
const ITEM = {
	key: "ABCD1234",
	data: { key: "ABCD1234", title: "Example", itemType: "journalArticle", DOI: DOI, collections: [] },
};
const paper = (extra = {}) => ({
	doi: DOI,
	title: "Example paper",
	creators: [{ last_name: "Doe", first_name: "Jane" }, { name: "Example Consortium" }],
	date: "2024",
	publication: "Journal of Examples",
	volume: "1",
	pages: "1-10",
	tags: ["fixture"],
	...extra,
});
const json = (body, { status = 200, headers = {} } = {}) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/** A fake Zotero: desktop connector + local API, or Web API, driven by URL. */
function fakeZotero({
	desktop = true,
	existing = [],
	saveStatus = 201,
	web = null,
	afterSave = "visible",
} = {}) {
	const calls = [];
	let saved = false;
	const fetchImpl = vi.fn(async (url, init = {}) => {
		calls.push({
			url: String(url),
			method: init.method || "GET",
			headers: init.headers || {},
			body: init.body,
		});
		const u = new URL(String(url));
		if (u.host === "127.0.0.1:23119") {
			if (!desktop) throw new TypeError("fetch failed");
			if (u.pathname === "/connector/ping") return json({ prefs: {} });
			if (u.pathname === "/connector/getSelectedCollection")
				return json({
					libraryID: 1,
					libraryName: "My Library",
					libraryEditable: true,
					editable: true,
					id: 12,
					name: "Reading",
				});
			if (u.pathname === "/connector/saveItems") {
				saved = saveStatus === 201;
				return json({ items: [] }, { status: saveStatus });
			}
			if (u.pathname === "/api/users/0/items") {
				const items = saved && afterSave === "visible" ? [...existing, ITEM] : existing;
				return json(items, { headers: { "Total-Results": String(items.length) } });
			}
			if (/\/api\/users\/0\/items\/[A-Z0-9]{8}\/children$/.test(u.pathname))
				return json([], { headers: { "Total-Results": "0" } });
			return new Response("not found", { status: 404 });
		}
		if (u.host === "api.zotero.org" && web) {
			if (u.pathname === "/keys/current") return json({ userID: 777, username: "jane", access: web.access });
			if (u.pathname === "/users/777/items" && (init.method || "GET") === "GET") {
				const items = saved ? [...existing, ITEM] : existing;
				return json(items, { headers: { "Total-Results": String(items.length) } });
			}
			if (u.pathname === "/users/777/items" && init.method === "POST") {
				const posted = JSON.parse(init.body);
				saved = true;
				return json({
					successful: {
						0: { key: posted[0].itemType === "attachment" ? "ATTACH01" : "ABCD1234", version: 5 },
					},
					failed: {},
					unchanged: {},
				});
			}
			if (/\/users\/777\/items\/[A-Z0-9]{8}\/children$/.test(u.pathname))
				return json([], { headers: { "Total-Results": "0" } });
		}
		return new Response("not found", { status: 404 });
	});
	return {
		fetchImpl,
		calls,
		saves: () => calls.filter((c) => c.url.endsWith("/connector/saveItems")).length,
	};
}
const webEnv = { ZOTERO_API_KEY: "secret", ZOTERO_LIBRARY_ID: "777", ZOTERO_LIBRARY_TYPE: "users" };
const noSleep = { sleep: async () => {}, readBackDelayMs: 0 };

describe("normalizeZoteroItem", () => {
	it("whitelists fields per item type and keeps the DOI exact", () => {
		const item = normalizeZoteroItem(paper({ doi: "https://doi.org/10.1234/Example.2024", nonsense: "x" }));
		expect(item.doi).toBe(DOI);
		expect(item.fields).toEqual({ volume: "1", pages: "1-10", publicationTitle: "Journal of Examples" });
		expect(item.creators).toEqual([
			{ creatorType: "author", lastName: "Doe", firstName: "Jane" },
			{ creatorType: "author", name: "Example Consortium" },
		]);
		const connector = toConnectorItem(item, { url: "https://example.org/a.pdf", title: "PDF" });
		expect(connector.DOI).toBe(DOI);
		expect(connector).not.toHaveProperty("nonsense");
		expect(connector.creators[1]).toEqual({
			creatorType: "author",
			lastName: "Example Consortium",
			fieldMode: 1,
		});
		expect(connector.attachments).toEqual([
			{ title: "PDF", url: "https://example.org/a.pdf", mimeType: "application/pdf" },
		]);
		const web = toWebApiItem(item, { collectionKey: "COLL0001" });
		expect(web.collections).toEqual(["COLL0001"]);
		expect(web).not.toHaveProperty("attachments");
	});
	it("moves the DOI into extra for item types without a DOI field", () => {
		const book = normalizeZoteroItem(paper({ item_type: "book", publication: "Big Press" }));
		expect(book.doiField).toBe(false);
		expect(toWebApiItem(book)).not.toHaveProperty("DOI");
		expect(toWebApiItem(book).extra).toContain(`DOI: ${DOI}`);
		const talk = normalizeZoteroItem(paper({ item_type: "conferencePaper" }));
		expect(talk.fields.proceedingsTitle).toBe("Journal of Examples");
		expect(talk.fields).not.toHaveProperty("issue");
	});
	it("rejects invalid identity or oversized input instead of guessing", () => {
		expect(() => normalizeZoteroItem(paper({ doi: "not-a-doi" }))).toThrow(/DOI/);
		expect(() => normalizeZoteroItem(paper({ item_type: "podcast" }))).toThrow(/item_type/);
		expect(() => normalizeZoteroItem(paper({ title: "x".repeat(1001) }))).toThrow(/title/);
		expect(() => normalizeZoteroItem(paper({ creators: [{ first_name: "Only" }] }))).toThrow(/creators\[0\]/);
		expect(() => normalizeZoteroItem(paper({ url: "file:///etc/passwd" }))).toThrow(/http/);
	});
});

describe("prepareZoteroSave", () => {
	it("prefers Zotero desktop, reports the selected target and dedups by DOI before any write", async () => {
		const z = fakeZotero();
		const plan = await prepareZoteroSave(paper(), { fetchImpl: z.fetchImpl, env: {} });
		expect(plan.channel).toBe("connector");
		expect(plan.action).toBe("create");
		expect(plan.target).toMatchObject({
			libraryName: "My Library",
			collectionName: "Reading",
			editable: true,
			local: true,
		});
		expect(plan.existing).toEqual([]);
		expect(z.saves()).toBe(0);
		expect(describeZoteroSavePlan(plan)).toContain(DOI);
		expect(describeZoteroSavePlan(plan)).toContain("暂不写入");
	});
	it("reuses an existing item with the same DOI without consent or write", async () => {
		const z = fakeZotero({ existing: [ITEM] });
		const plan = await prepareZoteroSave(paper(), { fetchImpl: z.fetchImpl, env: {} });
		expect(plan.action).toBe("reuse");
		const receipt = receiptWithoutWrite(plan);
		expect(receipt).toMatchObject({
			status: "reused",
			zoteroKey: "ABCD1234",
			zoteroSelect: "zotero://select/library/items/ABCD1234",
			writesToLibraries: 0,
		});
		expect(z.saves()).toBe(0);
	});
	it("refuses to write when several items already share the DOI", async () => {
		const z = fakeZotero({ existing: [ITEM, { ...ITEM, key: "DUPL0001" }] });
		const plan = await prepareZoteroSave(paper(), { fetchImpl: z.fetchImpl, env: {} });
		expect(plan.action).toBe("ambiguous");
		expect(receiptWithoutWrite(plan).status).toBe("ambiguous");
	});
	it("falls back to the Web API only with a write-scoped key from the environment", async () => {
		const readOnly = fakeZotero({
			desktop: false,
			web: { access: { user: { library: true, write: false } } },
		});
		await expect(prepareZoteroSave(paper(), { fetchImpl: readOnly.fetchImpl, env: webEnv })).rejects.toThrow(
			/write permission/,
		);
		const z = fakeZotero({ desktop: false, web: { access: { user: { library: true, write: true } } } });
		const plan = await prepareZoteroSave(paper(), { fetchImpl: z.fetchImpl, env: webEnv });
		expect(plan.channel).toBe("web");
		expect(plan.action).toBe("create");
		expect(plan.target).toMatchObject({ libraryType: "users", libraryId: "777", local: false });
		expect(plan.web).not.toHaveProperty("apiKey");
		await expect(prepareZoteroSave(paper(), { fetchImpl: z.fetchImpl, env: {} })).rejects.toThrow(
			/No Zotero write channel/,
		);
	});
});

describe("executeZoteroSave", () => {
	it("writes once through the connector and verifies by DOI read-back", async () => {
		const z = fakeZotero();
		const plan = await prepareZoteroSave(paper({ attachment_url: "https://example.org/oa.pdf" }), {
			fetchImpl: z.fetchImpl,
			env: {},
		});
		const receipt = await executeZoteroSave(plan, { fetchImpl: z.fetchImpl, env: {}, ...noSleep });
		expect(receipt).toMatchObject({
			status: "saved",
			channel: "connector",
			zoteroKey: "ABCD1234",
			fulltextStatus: "metadata-only",
			writesToLibraries: 1,
			autoRetry: false,
			scientificallyVerified: false,
		});
		expect(receipt.attachment).toMatchObject({ requested: true, mode: "zotero-downloads-url" });
		expect(receipt.readBack).toMatchObject({ state: "found", count: 1 });
		expect(z.saves()).toBe(1);
		const save = z.calls.find((c) => c.url.endsWith("/connector/saveItems"));
		expect(JSON.parse(save.body).items[0].attachments[0].url).toBe("https://example.org/oa.pdf");
	});
	it("never retries an uncertain connector write; the receipt stays unverified or failed", async () => {
		const failed = fakeZotero({ saveStatus: 500 });
		const plan = await prepareZoteroSave(paper(), { fetchImpl: failed.fetchImpl, env: {} });
		const receipt = await executeZoteroSave(plan, {
			fetchImpl: failed.fetchImpl,
			env: {},
			readBackAttempts: 2,
			...noSleep,
		});
		expect(receipt.status).toBe("failed");
		expect(receipt.readBack).toMatchObject({ state: "not-found", attempts: 2 });
		expect(failed.saves()).toBe(1);
		const silent = fakeZotero({ afterSave: "hidden" });
		const plan2 = await prepareZoteroSave(paper(), { fetchImpl: silent.fetchImpl, env: {} });
		const receipt2 = await executeZoteroSave(plan2, {
			fetchImpl: silent.fetchImpl,
			env: {},
			readBackAttempts: 2,
			...noSleep,
		});
		expect(receipt2.status).toBe("unverified");
		expect(receipt2.reason).toBe("written-but-not-read-back");
		expect(silent.saves()).toBe(1);
	});
	it("writes through the Web API with a write token and records attachments as linked URLs", async () => {
		const z = fakeZotero({ desktop: false, web: { access: { user: { library: true, write: true } } } });
		const plan = await prepareZoteroSave(
			paper({ attachment_url: "https://example.org/oa.pdf", collection_key: "COLL0001" }),
			{
				fetchImpl: z.fetchImpl,
				env: webEnv,
			},
		);
		const receipt = await executeZoteroSave(plan, { fetchImpl: z.fetchImpl, env: webEnv, ...noSleep });
		expect(receipt).toMatchObject({ status: "saved", channel: "web", zoteroKey: "ABCD1234" });
		expect(receipt.attachment).toMatchObject({ mode: "linked_url", key: "ATTACH01" });
		const posts = z.calls.filter((c) => c.method === "POST" && c.url.includes("api.zotero.org"));
		expect(posts).toHaveLength(2);
		expect(posts[0].headers["Zotero-Write-Token"]).toMatch(/^[a-f0-9]{32}$/);
		expect(JSON.parse(posts[0].body)[0].collections).toEqual(["COLL0001"]);
		expect(JSON.parse(posts[1].body)[0]).toMatchObject({
			itemType: "attachment",
			linkMode: "linked_url",
			parentItem: "ABCD1234",
		});
	});
	it("refuses to execute anything but a create plan", async () => {
		const z = fakeZotero({ existing: [ITEM] });
		const plan = await prepareZoteroSave(paper(), { fetchImpl: z.fetchImpl, env: {} });
		await expect(executeZoteroSave(plan, { fetchImpl: z.fetchImpl, env: {} })).rejects.toThrow(
			/Refusing to write/,
		);
	});
});

describe("composite zotero reconciler", () => {
	const found = { data: [ITEM], total: 1 };
	const children = { data: [], total: 0 };
	it("answers from the desktop local API first and never touches the Web API when found", async () => {
		const local = createLocalZoteroReconciler({
			request: async (path) => (path.startsWith("items?") ? found : children),
		});
		const web = vi.fn();
		const result = await createCompositeZoteroReconciler({ local, web })({ doi: DOI });
		expect(result).toMatchObject({
			state: "found",
			itemId: "ABCD1234",
			verifier: "zotero-local-api-item-identity",
		});
		expect(web).not.toHaveBeenCalled();
	});
	it("falls back to the Web API answer when the desktop is unreachable", async () => {
		const local = createLocalZoteroReconciler({
			request: async () => {
				throw new TypeError("fetch failed");
			},
		});
		const web = vi.fn(async () => ({
			state: "found",
			itemId: "ABCD1234",
			verifier: "zotero-read-only-item-identity",
		}));
		expect(await createCompositeZoteroReconciler({ local, web })({ doi: DOI })).toMatchObject({
			itemId: "ABCD1234",
		});
		const none = vi.fn(async () => ({ state: "unavailable" }));
		expect((await createCompositeZoteroReconciler({ local, web: none })({ doi: DOI })).state).toBe(
			"unavailable",
		);
		const notFound = createLocalZoteroReconciler({ request: async () => ({ data: [], total: 0 }) });
		expect((await createCompositeZoteroReconciler({ local: notFound, web: none })({ doi: DOI })).state).toBe(
			"not-found",
		);
	});
	it("leaves milestones that name another library to the Web API adapter", async () => {
		const local = createLocalZoteroReconciler({ request: vi.fn() });
		expect((await local({ doi: DOI, libraryId: "999" })).state).toBe("unavailable");
	});
});
