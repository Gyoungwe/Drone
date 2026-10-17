// @vitest-environment jsdom
import type { SessionMeta } from "@drone/shared";
import { describe, expect, it } from "vitest";
import { countWeeklyDeposits, pickUnfinishedSession, weekStart } from "./HomeCards";

const session = (sessionId: string, modifiedAt = 1): SessionMeta => ({
	sessionId,
	sessionFile: `/tmp/${sessionId}.jsonl`,
	cwd: "/work/project",
	active: false,
	messageCount: 2,
	createdAt: modifiedAt,
	modifiedAt,
});

describe("home workspace summaries", () => {
	it("counts only wiki entries reviewed since Monday", () => {
		const now = new Date("2026-10-14T12:00:00.000Z");
		const monday = weekStart(now);
		expect(
			countWeeklyDeposits(
				[
					{
						id: "current",
						path: "Library/current.md",
						afterHash: "a",
						reviewedAt: monday,
						reviewMethod: "auto",
					},
					{ id: "old", path: "Library/old.md", afterHash: "b", reviewedAt: monday - 1, reviewMethod: "auto" },
				],
				now,
			),
		).toBe(1);
	});

	it("returns unknown when no history has been read", () => {
		expect(countWeeklyDeposits(undefined)).toBeUndefined();
	});

	it("selects a running session without inventing an unfinished task", () => {
		const running = session("running");
		const done = session("done", 2);
		expect(pickUnfinishedSession([done, running], ["running"])).toBe(running);
		expect(pickUnfinishedSession([done], [])).toBeUndefined();
	});
});
