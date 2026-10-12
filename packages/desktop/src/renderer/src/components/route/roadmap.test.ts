import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RoadmapLane, roadmapStatus, summarizeRoadmap } from "./Roadmap";

vi.stubGlobal("React", React);

const nodes = [
	{ key: "request", label: "请求", value: "新话题", status: "ok" as const, detail: "「画联配图」是新话题。" },
	{ key: "skill", label: "主技能", value: "nature-figure", status: "warn" as const, detail: "主技能不可见" },
	{
		key: "result",
		label: "结果",
		value: "需要处理",
		status: "blocked" as const,
		detail: "需要先处理一项请求。",
	},
];

describe("roadmap", () => {
	it("renders a compact lane: short labels, status per node, details only as hover titles", () => {
		const html = renderToStaticMarkup(createElement(RoadmapLane, { nodes }));
		expect(html).toContain('data-testid="roadmap-node-skill"');
		expect(html).toContain('data-status="blocked"');
		expect(html).toContain('title="需要先处理一项请求。"');
		expect(html.match(/→/g)).toHaveLength(2);
		expect(html).not.toContain('data-testid="roadmap-detail"');
	});
	it("maps research run states to roadmap statuses", () => {
		expect(roadmapStatus("complete")).toBe("ok");
		expect(roadmapStatus("active")).toBe("active");
		expect(roadmapStatus("blocked")).toBe("blocked");
		expect(roadmapStatus("pending")).toBe("skip");
	});
	it("summarises the most urgent route state and settled steps", () => {
		expect(summarizeRoadmap(nodes)).toEqual({ status: "blocked", settled: 1, total: 3 });
		expect(summarizeRoadmap(nodes.map((node) => ({ ...node, status: "ok" as const })))).toEqual({
			status: "ok",
			settled: 3,
			total: 3,
		});
	});
});
