import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completionText, DailyDiscoveryService } from "../src/services/daily-discovery";

const DAY = 24 * 60 * 60 * 1000;
let dir = "";
afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

async function setup(reply = "[]", fresh = [{ path: "Library/new.md", title: "New", text: "n", mtime: 1 }]) {
	dir = await mkdtemp(join(tmpdir(), "daily-discovery-service-"));
	let now = 10 * DAY;
	const options = {
		path: join(dir, "daily-discovery.json"),
		context: vi.fn(async () => ({ bound: true, fresh, related: [] })),
		saveIdea: vi.fn(async () => ({ path: "Library/Ideas/a.md" })),
		complete: vi.fn(async () => reply),
		notify: vi.fn(),
		now: () => now,
	};
	const service = new DailyDiscoveryService(options);
	return { service, options, advance: (ms: number) => (now += ms) };
}

const idea = { title: "A", idea: "x", basis: ["Library/new.md"], test: "qPCR", whyOverlooked: "" };

describe("DailyDiscoveryService", () => {
	it("is on by default and runs at most once a day", async () => {
		const { service, options, advance } = await setup(JSON.stringify([idea]));
		expect((await service.getState()).enabled).toBe(true);
		await service.runIfDue();
		await service.runIfDue();
		expect(options.complete).toHaveBeenCalledOnce();
		expect(options.notify).toHaveBeenCalledOnce();
		advance(DAY);
		await service.runIfDue();
		expect(options.complete).toHaveBeenCalledTimes(2);
		expect((await service.getState()).ideas).toHaveLength(1);
	});

	it("does not call a model when nothing changed, and does nothing when disabled", async () => {
		const { service, options } = await setup("[]", []);
		await service.runIfDue();
		expect(options.complete).not.toHaveBeenCalled();
		expect((await service.getState()).lastRunAt).not.toBeNull();
		const second = await setup(JSON.stringify([idea]));
		await second.service.setEnabled(false);
		await second.service.runIfDue();
		expect(second.options.context).not.toHaveBeenCalled();
	});

	it("saves an idea as a note or dismisses it for good", async () => {
		const { service, options } = await setup(JSON.stringify([idea, { ...idea, title: "B" }]));
		const state = await service.run();
		const [first, second] = state.ideas;
		if (!first || !second) throw new Error("expected two ideas");
		const saved = await service.decide(first.id, "save");
		expect(options.saveIdea).toHaveBeenCalledOnce();
		expect(saved.ideas.find((item) => item.id === first.id)).toMatchObject({
			status: "saved",
			savedPath: "Library/Ideas/a.md",
		});
		const dismissed = await service.decide(second.id, "dismiss");
		expect(dismissed.ideas.some((item) => item.id === second.id)).toBe(false);
	});

	it("skips a run without counting it when no model is available", async () => {
		const { service, options } = await setup();
		options.complete.mockResolvedValueOnce(null as never);
		await service.runIfDue();
		expect((await service.getState()).lastRunAt).toBeNull();
		expect((await service.getState()).lastError).toMatch(/No usable model/);
	});

	it("keeps the day open and reports the error when the model call fails", async () => {
		const { service, options } = await setup();
		options.complete.mockRejectedValueOnce(
			new Error("The security token included in the request is invalid."),
		);
		const failed = await service.run();
		expect(failed.lastRunAt).toBeNull();
		expect(failed.lastError).toMatch(/security token/);
		const ok = await service.run();
		expect(ok.lastRunAt).not.toBeNull();
		expect(ok.lastError).toBeNull();
	});
});

describe("daily discovery outcome", () => {
	it("records why a run produced nothing", async () => {
		const none = await setup("[]", []);
		const quiet = await none.service.run();
		expect(quiet.lastOutcome).toMatchObject({ kind: "no-new-notes" });
		expect(quiet.lastRunAt).not.toBeNull();

		const read = await setup("[]");
		expect((await read.service.run()).lastOutcome).toMatchObject({ kind: "ran", notes: 1, added: 0 });

		const found = await setup(JSON.stringify([idea]));
		expect((await found.service.run()).lastOutcome).toMatchObject({ kind: "ran", added: 1 });
	});

	it("runs the literature radar without fresh notes and deduplicates recent hits", async () => {
		const { service, options } = await setup("[]", []);
		options.context.mockResolvedValue({
			bound: true,
			fresh: [],
			related: [],
			topics: [{ id: "topic-1", title: "cell atlas", entities: ["single cell"] }],
		});
		const radarSearch = vi.fn(async () => ({
			query: "cell atlas",
			hits: [
				{
					id: "openalex:1",
					title: "A Cell Atlas",
					summary: "",
					locator: "https://doi.org/10.1000/test",
					sourceType: "literature",
					doi: "10.1000/test",
					publishedAt: new Date(10 * DAY - DAY).toISOString(),
					sourceReceipt: {} as never,
				},
			],
			failures: [],
			connectors: ["openalex"],
			complete: true,
		}));
		Object.assign(options, { radarSearch });
		const state = await service.run();
		expect(radarSearch).toHaveBeenCalled();
		expect(state.radar).toHaveLength(1);
		expect(state.radar[0]).toMatchObject({ title: "A Cell Atlas", doi: "10.1000/test" });
		expect(state.lastOutcome).toMatchObject({ kind: "radar-ran", added: 1 });
	});

	it("skips papers already represented by Vault notes or Zotero seeds", async () => {
		const { service, options } = await setup("[]", []);
		options.context.mockResolvedValue({
			bound: true,
			fresh: [],
			related: [
				{
					path: "Library/existing.md",
					title: "Existing atlas",
					text: "DOI 10.1000/existing and arXiv:2401.12345",
					mtime: 1,
				},
			],
			topics: [{ id: "topic-1", title: "cell atlas" }],
			zoteroSeeds: ["10.1000/zotero"],
		});
		Object.assign(options, {
			radarSearch: vi.fn(async () => ({
				query: "cell atlas",
				hits: [
					{
						id: "openalex:existing",
						title: "Existing atlas",
						locator: "https://doi.org/10.1000/existing",
						sourceType: "literature",
						doi: "10.1000/existing",
						publishedAt: new Date(10 * DAY - DAY).toISOString(),
						sourceReceipt: {} as never,
					},
					{
						id: "openalex/zotero",
						title: "Zotero paper",
						locator: "https://doi.org/10.1000/zotero",
						sourceType: "literature",
						doi: "10.1000/zotero",
						publishedAt: new Date(10 * DAY - DAY).toISOString(),
						sourceReceipt: {} as never,
					},
					{
						id: "openalex/new",
						title: "A New Atlas",
						locator: "https://doi.org/10.1000/new",
						sourceType: "literature",
						doi: "10.1000/new",
						publishedAt: new Date(10 * DAY - DAY).toISOString(),
						sourceReceipt: {} as never,
					},
				],
				failures: [],
				connectors: ["openalex"],
				complete: true,
			})),
		});
		const state = await service.run();
		expect(state.radar.map((paper) => paper.doi)).toEqual(["10.1000/new"]);
	});

	it("uses the title fallback when a Vault source has no identifier", async () => {
		const { service, options } = await setup("[]", []);
		options.context.mockResolvedValue({
			bound: true,
			fresh: [],
			related: [{ path: "Library/existing.md", title: "Existing atlas", text: "Notes", mtime: 1 }],
			topics: [{ id: "topic-1", title: "cell atlas" }],
		});
		Object.assign(options, {
			radarSearch: vi.fn(async () => ({
				query: "cell atlas",
				hits: [
					{
						id: "openalex:existing",
						title: "Existing atlas",
						locator: "https://doi.org/10.1000/existing",
						sourceType: "literature",
						doi: "10.1000/existing",
						publishedAt: new Date(10 * DAY - DAY).toISOString(),
						sourceReceipt: {} as never,
					},
				],
				failures: [],
				connectors: ["openalex"],
				complete: true,
			})),
		});
		const state = await service.run();
		expect(state.radar).toHaveLength(0);
	});

	it("does not count a retryable radar failure as today's run", async () => {
		const { service, options } = await setup("[]", []);
		options.context.mockResolvedValue({
			bound: true,
			fresh: [],
			related: [],
			topics: [{ id: "topic-1", title: "cell atlas" }],
		});
		Object.assign(options, {
			radarSearch: vi.fn(async () => ({
				query: "cell atlas",
				hits: [],
				failures: [
					{ connectorId: "arxiv", message: "HTTP 429", retryable: true, at: new Date().toISOString() },
				],
				connectors: ["arxiv"],
				complete: false,
			})),
		});
		await expect(service.run()).rejects.toThrow(/temporarily unavailable/);
		expect((await service.getState()).lastRunAt).toBeNull();
	});
});

describe("completionText", () => {
	it("throws on model errors, returns null for empty replies", () => {
		expect(() => completionText({ stopReason: "error", errorMessage: "401", content: [] })).toThrow("401");
		expect(() => completionText({ stopReason: "aborted", content: [] })).toThrow(/aborted/);
		expect(completionText({ stopReason: "stop", content: [{ type: "text", text: "  " }] })).toBeNull();
		expect(
			completionText({ stopReason: "stop", content: [{ type: "thinking" }, { type: "text", text: "[]" }] }),
		).toBe("\n[]");
	});
});
