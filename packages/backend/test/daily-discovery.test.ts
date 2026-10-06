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
