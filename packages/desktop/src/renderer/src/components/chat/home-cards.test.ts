// @vitest-environment jsdom
import type { DailyDiscoveryState, KnowledgeTopic, SessionMeta } from "@drone/shared";
import { describe, expect, it } from "vitest";
import {
	countWeeklyDeposits,
	pickActiveTopics,
	pickNewDailyIdeas,
	pickNewDailyRadar,
	pickUnfinishedSession,
	weekStart,
} from "./HomeCards";

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

	it("shows only the first three active topics and unread daily items", () => {
		const topic = (id: string, status: KnowledgeTopic["status"]): KnowledgeTopic => ({
			id,
			title: id,
			aliases: [],
			summary: "",
			entities: [],
			unresolvedQuestions: [],
			sources: [],
			artifacts: [],
			status,
			updatedAt: "2026-10-14T00:00:00.000Z",
		});
		const topics = [
			topic("stale", "stale"),
			topic("one", "active"),
			topic("two", "active"),
			topic("three", "active"),
			topic("four", "active"),
		];
		expect(pickActiveTopics(topics).map((item) => item.id)).toEqual(["one", "two", "three"]);

		const daily: Pick<DailyDiscoveryState, "ideas" | "radar"> = {
			ideas: [
				{
					id: "new-idea",
					title: "New",
					idea: "",
					basis: [],
					test: "",
					whyOverlooked: "",
					createdAt: 1,
					status: "new",
				},
				{
					id: "saved-idea",
					title: "Saved",
					idea: "",
					basis: [],
					test: "",
					whyOverlooked: "",
					createdAt: 1,
					status: "saved",
				},
			],
			radar: [
				{
					id: "new-paper",
					title: "New paper",
					authors: [],
					year: null,
					locator: "",
					sourceConnectors: [],
					matchedTopicIds: [],
					matchedTopicTitles: [],
					relatedVaultPaths: [],
					discoveredAt: 1,
					status: "new",
				},
			],
		};
		expect(pickNewDailyIdeas(daily).map((item) => item.id)).toEqual(["new-idea"]);
		expect(pickNewDailyRadar(daily).map((item) => item.id)).toEqual(["new-paper"]);
	});
});
