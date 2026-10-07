import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RoadmapLane, roadmapStatus } from "./Roadmap";
import { layoutMindMap } from "./RouteMindMap";

vi.stubGlobal("React", React);

const nodes = [
	{ key: "request", label: "请求", value: "新话题", status: "ok" as const, detail: "「画联配图」是新话题。" },
	{ key: "skill", label: "主技能", value: "nature-figure", status: "warn" as const, detail: "主技能不可见" },
	{ key: "result", label: "结果", value: "宿主门", status: "blocked" as const, detail: "停在宿主门。" },
];

describe("roadmap", () => {
	it("renders a compact lane: short labels, status per node, details only as hover titles", () => {
		const html = renderToStaticMarkup(createElement(RoadmapLane, { nodes }));
		expect(html).toContain('data-testid="roadmap-node-skill"');
		expect(html).toContain('data-status="blocked"');
		expect(html).toContain('title="停在宿主门。"');
		expect(html.match(/→/g)).toHaveLength(2);
		expect(html).not.toContain('data-testid="roadmap-detail"');
	});
	it("maps research run states to roadmap statuses", () => {
		expect(roadmapStatus("complete")).toBe("ok");
		expect(roadmapStatus("active")).toBe("active");
		expect(roadmapStatus("blocked")).toBe("blocked");
		expect(roadmapStatus("pending")).toBe("skip");
	});
	it("lays the mind map out left to right with one edge per step", () => {
		const flow = layoutMindMap(nodes);
		expect(flow.nodes).toHaveLength(3);
		expect(flow.edges.map((e) => `${e.source}>${e.target}`)).toEqual(["request>skill", "skill>result"]);
		const xs = flow.nodes.map((n) => n.position.x);
		expect(xs[0]).toBeLessThan(xs[1] ?? 0);
		expect(xs[1]).toBeLessThan(xs[2] ?? 0);
	});
});
