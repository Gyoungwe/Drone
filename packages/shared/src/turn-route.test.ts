import { describe, expect, it } from "vitest";
import { isDeferReviewPhrase, type TurnRoute, turnRouteLines } from "./turn-route";

function route(over: Partial<TurnRoute> = {}): TurnRoute {
	return {
		utterance: "检索灰飞虱性别决定论文",
		intake: "new-topic",
		capabilities: ["research"],
		topics: ["search"],
		direction: "evidence",
		stage: "search",
		contract: "Bounded search scope, provenance and failures; a search hit is not a source read.",
		primary: "nature-academic-search",
		reason: "topic:search",
		unavailableStage: null,
		comparison: false,
		academic: false,
		keptCheckpoint: false,
		deferPhrase: false,
		visiblePrimary: true,
		landing: "workflow",
		host: null,
		...over,
	};
}

describe("turn route lines", () => {
	it("explains a fresh search from the selected skill and the search contract", () => {
		const lines = turnRouteLines(route());
		expect(lines.summary).toContain("文献发现");
		expect(lines.summary).toContain("nature-academic-search");
		expect(lines.lines.join("\n")).toContain("是新话题");
		expect(lines.lines.join("\n")).toContain("科研");
		expect(lines.lines.join("\n")).toContain("搜到一条文献不算已经读过原文");
		expect(lines.lines.join("\n")).toContain("第一个已安装的候选");
		expect(lines.lines.join("\n")).toContain("写进本轮系统提示");
		expect(lines.lines.join("\n")).not.toContain("阶段配额不会放开");
	});

	it("explains continue and a status question differently when a review is waiting", () => {
		const host = {
			reason: "stage-budget",
			state: "waiting_user",
			stageCalls: 48,
			calls: 76,
			progressCount: 46,
			stageStartProgress: 16,
			stageLimited: true,
			hasProgress: true,
			pendingReview: true,
			reviewLinked: false,
			deferredReviews: 0,
			releasedStage: false,
		};
		const continued = turnRouteLines(
			route({
				utterance: "继续做完",
				intake: "continuation",
				topics: [],
				direction: null,
				stage: null,
				contract: null,
				primary: null,
				reason: null,
				keptCheckpoint: true,
				deferPhrase: true,
				visiblePrimary: false,
				landing: "host-gate",
				host,
			}),
		);
		const status = turnRouteLines(
			route({
				utterance: "进度如何",
				intake: "status",
				topics: [],
				direction: null,
				stage: null,
				contract: null,
				primary: null,
				reason: null,
				keptCheckpoint: true,
				deferPhrase: false,
				visiblePrimary: false,
				landing: "host-gate",
				host,
			}),
		);
		expect(continued.lines.join("\n")).toContain("沿用检查点");
		expect(continued.lines.join("\n")).toContain("不会替你勾完成");
		expect(continued.lines.join("\n")).toContain("阶段步数会放开");
		expect(status.lines.join("\n")).toContain("阶段配额不会放开");
		expect(status.lines.join("\n")).not.toContain("阶段步数会放开");
		expect(continued.lines).not.toEqual(status.lines);
		expect(continued.summary).not.toBe(turnRouteLines(route()).summary);
	});

	it("says the stage was already released after the host cleared the review", () => {
		const lines = turnRouteLines(
			route({
				utterance: "继续",
				intake: "continuation",
				topics: [],
				stage: null,
				direction: null,
				contract: null,
				primary: null,
				reason: null,
				keptCheckpoint: true,
				deferPhrase: true,
				visiblePrimary: false,
				landing: "host-gate",
				host: {
					reason: "automatic-stage-checkpoint",
					state: "running",
					stageCalls: 0,
					calls: 76,
					progressCount: 46,
					stageStartProgress: 46,
					stageLimited: false,
					hasProgress: false,
					pendingReview: false,
					reviewLinked: false,
					deferredReviews: 1,
					releasedStage: true,
				},
			}),
		);
		expect(lines.lines.join("\n")).toContain("放下了 1 张审阅");
		expect(lines.lines.join("\n")).toContain("阶段步数已放开");
	});

	it("matches the host continue phrase and ignores status questions", () => {
		expect(isDeferReviewPhrase("继续")).toBe(true);
		expect(isDeferReviewPhrase("继续做完")).toBe(true);
		expect(isDeferReviewPhrase("continue")).toBe(true);
		expect(isDeferReviewPhrase("进度如何")).toBe(false);
		expect(isDeferReviewPhrase("检索灰飞虱性别决定论文")).toBe(false);
		expect(isDeferReviewPhrase("继续做剩下的")).toBe(false);
	});
});
