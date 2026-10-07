/**
 * Drone 技能路由缺陷复现：按 Nature 期刊规范重绘图时应路由到 nature-figure。
 * 被测：packages/backend/src/capabilities/research-skill-router.ts（远端快照）
 * 标记 的用例用 it.fails 编写：今天"按预期失败"即通过；修复后需改回 it。
 */
import { describe, expect, it } from "vitest";
import {
	detectResearchIntent,
	type RoutableSkill,
	selectResearchSkills,
} from "../src/capabilities/research-skill-router";

const installed: RoutableSkill[] = [
	"nature-figure",
	"scientific-visualization",
	"scikit-bio",
	"waypoint-bio",
].map((name) => ({ name, description: `${name} skill`, filePath: `C:/x/skills/${name}/SKILL.md` }));
const caps = (...ids: string[]) => new Set(ids) as any;
const route = (text: string, ...c: string[]) =>
	selectResearchSkills(
		installed,
		caps(...(c.length ? c : ["visualization", "research"])),
		detectResearchIntent(text),
	);

const USER_PROMPT = "按 Nature 期刊规范重绘 DHX16 的结构域 + 比对图";

describe("基线（今天应通过）", () => {
	it("显式 /skill:nature-figure 选中 nature-figure", () => {
		expect(route("/skill:nature-figure 重绘 DHX16 图").names[0]).toBe("nature-figure");
	});
	it("任务里写出技能名 nature-figure 时被选中", () => {
		expect(route("用 nature-figure 重绘 DHX16 图").names).toContain("nature-figure");
	});
	it("'科研绘图/论文配图' 命中 figures 阶段 → nature-figure", () => {
		const r = route("帮我做一张论文配图，柱状图");
		expect(r.stage).toBe("figures");
		expect(r.primaryWorkflow).toBe("nature-figure");
	});
});

describe("缺陷修复回归（原 it.fails 用例）", () => {
	it("回归：用户原话同时命中 bioinformatics 与 figures，两类技能都可见", () => {
		const intent = detectResearchIntent(USER_PROMPT);
		expect(intent.topics).toEqual(expect.arrayContaining(["bioinformatics", "figures"]));
		expect(route(USER_PROMPT).names).toEqual(expect.arrayContaining(["scikit-bio", "nature-figure"]));
	});
	it("用户原话应选中 nature-figure", () => {
		expect(route(USER_PROMPT).names).toContain("nature-figure");
	});
	it("'Nature 期刊规范/风格' + 图 应命中 figures topic", () => {
		expect(detectResearchIntent("按 Nature 期刊风格重绘这张图").topics).toContain("figures");
	});
	it("'journal style figure' 英文请求应命中 figures topic", () => {
		expect(detectResearchIntent("redraw this figure in Nature journal style").topics).toContain("figures");
	});
	it("仅 visualization 能力 + 期刊绘图任务也应选中 nature-figure", () => {
		expect(route(USER_PROMPT, "visualization").names).toContain("nature-figure");
	});
	it("结构域分析 + 绘图混合任务：nature-figure 至少作为支撑技能出现", () => {
		const r = route("分析 DHX16 结构域并画论文配图");
		expect(r.names).toEqual(expect.arrayContaining(["scikit-bio", "nature-figure"]));
	});
});
