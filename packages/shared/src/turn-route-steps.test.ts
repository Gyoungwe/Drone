import { describe, expect, it } from "vitest";
import { type TurnRoute, turnRouteSteps } from "./turn-route";

function route(over: Partial<TurnRoute> = {}): TurnRoute {
	return {
		utterance: "检索灰飞虱性别决定论文",
		intake: "new-topic",
		capabilities: ["research"],
		topics: ["search"],
		direction: "evidence",
		stage: "search",
		contract: null,
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
const host = {
	reason: "stage-budget",
	state: null,
	stageCalls: 6,
	calls: 9,
	progressCount: 1,
	stageStartProgress: 1,
	stageLimited: true,
	hasProgress: false,
	pendingReview: true,
	reviewLinked: true,
	deferredReviews: 0,
	releasedStage: false,
};

describe("turn route roadmap steps", () => {
	it("always yields the six roadmap steps in order with short values", () => {
		const steps = turnRouteSteps(route());
		expect(steps.map((s) => s.key)).toEqual(["request", "capabilities", "skill", "stage", "tools", "result"]);
		for (const s of steps) expect(s.value.length).toBeLessThanOrEqual(18);
		expect(steps[2]?.value).toBe("nature-academic-s…");
		expect(steps[2]?.detail).toContain("nature-academic-search");
		expect(steps.find((s) => s.key === "result")?.status).toBe("ok");
		expect(steps.find((s) => s.key === "tools")?.status).toBe("skip");
	});
	it("marks a host gate and its tools step as blocked", () => {
		const steps = turnRouteSteps(route({ landing: "host-gate", intake: "status", host }));
		expect(steps.find((s) => s.key === "result")?.status).toBe("blocked");
		expect(steps.find((s) => s.key === "tools")?.status).toBe("blocked");
		expect(steps.find((s) => s.key === "tools")?.value).toBe("6/9 步");
		expect(steps.find((s) => s.key === "request")?.value).toBe("问进度");
	});
	it("warns when the primary skill is selected but not visible, and skips empty steps", () => {
		const steps = turnRouteSteps(
			route({ visiblePrimary: false, capabilities: [], direction: null, stage: null }),
		);
		expect(steps.find((s) => s.key === "skill")?.status).toBe("warn");
		expect(steps.find((s) => s.key === "result")?.status).toBe("warn");
		expect(steps.find((s) => s.key === "capabilities")?.status).toBe("skip");
		expect(steps.find((s) => s.key === "stage")?.status).toBe("skip");
	});
	it("speaks English", () => {
		const steps = turnRouteSteps(route({ landing: "ordinary", primary: null }), "en");
		expect(steps[0]?.label).toBe("Request");
		expect(steps.find((s) => s.key === "result")?.value).toBe("Ordinary");
		expect(steps.find((s) => s.key === "skill")?.status).toBe("skip");
	});
});
