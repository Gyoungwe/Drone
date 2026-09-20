import type { SubagentPanelAgent } from "@drone/shared";
import { describe, expect, it } from "vitest";
import {
	atAgentAvailability,
	atMenuItems,
	filterSubagents,
	restoreSubagentText,
	subagentsOfferable,
	subagentTaskText,
} from "./at-subagents";

const AGENTS: SubagentPanelAgent[] = [
	{
		name: "scout",
		description: "只读侦察",
		source: "builtin",
		tools: ["read"],
		mcpAccess: "read-local",
		trusted: true,
	},
	{
		name: "lit-reviewer",
		description: "文献精读",
		source: "user",
		tools: ["read"],
		mcpAccess: "none",
		trusted: true,
	},
	{
		name: "data-checker",
		description: "数据检查",
		source: "project",
		tools: ["read"],
		mcpAccess: "none",
		trusted: false,
	},
	{
		name: "wiki-curator",
		description: "wiki",
		source: "project",
		tools: ["read"],
		mcpAccess: "none",
		trusted: true,
	},
];

describe("subagentsOfferable", () => {
	const base = { tokenStart: 0, slashCommand: null, subagent: null, dispatchable: true };
	it("消息开头 + 可派发会话 → 提供", () => {
		expect(subagentsOfferable(base)).toBe(true);
	});
	it("@ 不在开头（正文里的提及 / 邮箱）不提供", () => {
		expect(subagentsOfferable({ ...base, tokenStart: 3 })).toBe(false);
	});
	it("与 / 菜单互斥：有 slash 胶囊不提供", () => {
		expect(subagentsOfferable({ ...base, slashCommand: "compact" })).toBe(false);
	});
	it("已选过子智能体（单任务）不再提供", () => {
		expect(subagentsOfferable({ ...base, subagent: "scout" })).toBe(false);
	});
	it("草稿 / 只读会话不提供", () => {
		expect(subagentsOfferable({ ...base, dispatchable: false })).toBe(false);
	});
});

describe("filterSubagents", () => {
	it("空 query 保持发现顺序并受 limit 约束", () => {
		expect(filterSubagents(AGENTS, "").map((a) => a.name)).toEqual([
			"scout",
			"lit-reviewer",
			"data-checker",
			"wiki-curator",
		]);
		expect(filterSubagents(AGENTS, "", 2).map((a) => a.name)).toEqual(["scout", "lit-reviewer"]);
	});
	it("前缀 / 子序列匹配，大小写不敏感，连续命中靠前", () => {
		expect(filterSubagents(AGENTS, "sc").map((a) => a.name)).toEqual(["scout"]);
		expect(filterSubagents(AGENTS, "LIT").map((a) => a.name)).toEqual(["lit-reviewer"]);
		// wiki-curator 没有 e → 不命中；同分保持发现顺序
		expect(filterSubagents(AGENTS, "er").map((a) => a.name)).toEqual(["lit-reviewer", "data-checker"]);
	});
	it("无匹配返回空（菜单退回纯文件列表）", () => {
		expect(filterSubagents(AGENTS, "xyz")).toEqual([]);
	});
});

describe("atMenuItems", () => {
	it("子智能体在前、文件在后，key 带类型前缀", () => {
		const items = atMenuItems({ agents: AGENTS.slice(0, 1), files: ["docs/a.md", "src/"] });
		expect(items.map((item) => item.key)).toEqual(["agent:scout", "file:docs/a.md", "file:src/"]);
		expect(items[0]?.kind).toBe("agent");
		expect(items[1]?.kind).toBe("file");
	});
	it("没有子智能体时与旧的纯文件列表等价", () => {
		const items = atMenuItems({ agents: [], files: ["a", "b"] });
		expect(items.map((item) => (item.kind === "file" ? item.path : ""))).toEqual(["a", "b"]);
	});
});

describe("atAgentAvailability", () => {
	it("内置 / 用户级 → ready", () => {
		expect(atAgentAvailability(AGENTS[0] as SubagentPanelAgent)).toBe("ready");
		expect(atAgentAvailability(AGENTS[1] as SubagentPanelAgent)).toBe("ready");
	});
	it("未信任项目里的项目级 → untrusted（任何路径都不可派发）", () => {
		expect(atAgentAvailability(AGENTS[2] as SubagentPanelAgent)).toBe("untrusted");
	});
	it("受信任项目的项目级 → needs_panel（每次派发都要勾选信任，转面板）", () => {
		expect(atAgentAvailability(AGENTS[3] as SubagentPanelAgent)).toBe("needs_panel");
	});
});

describe("subagentTaskText", () => {
	it("空正文返回空串（任务必填，调用方拦截）", () => {
		expect(subagentTaskText({ text: "   ", attachments: ["a.md"], quotes: ["q"] })).toBe("");
	});
	it("拼装序与普通发送一致：引用块 → @ 文件 → 正文", () => {
		expect(
			subagentTaskText({
				text: " 列出字段 ",
				attachments: ["docs/a.md", "src/b.ts"],
				quotes: ["第一段", "第二段"],
			}),
		).toBe("> 第一段\n\n> 第二段\n\n@docs/a.md @src/b.ts\n列出字段");
	});
	it("只有正文时不产生多余空行", () => {
		expect(subagentTaskText({ text: "梳理权限", attachments: [], quotes: [] })).toBe("梳理权限");
	});
});

describe("restoreSubagentText", () => {
	it("空文本 → `@name `；有文本 → 拼回开头", () => {
		expect(restoreSubagentText("scout", "")).toBe("@scout ");
		expect(restoreSubagentText("scout", "列出字段")).toBe("@scout 列出字段");
	});
});
