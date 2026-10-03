import { describe, expect, it } from "vitest";
import {
	authorizationRequestKey,
	authorizationTitle,
	buildAuthorizationDetails,
	isPendingAuthorizationAction,
	isTaskAuthorizationAction,
} from "../src/authorization-policy";

describe("task authorization policy", () => {
	it("accepts only the host authorization action vocabulary", () => {
		expect(isTaskAuthorizationAction("authorize-task")).toBe(true);
		expect(isTaskAuthorizationAction("confirm-outcome")).toBe(true);
		expect(isTaskAuthorizationAction("continue")).toBe(false);
		expect(isTaskAuthorizationAction(null)).toBe(false);
	});

	it("recognizes pending authorization and rebind actions", () => {
		const action = { id: "a1", kind: "authorization", state: "pending" } as const;
		expect(isPendingAuthorizationAction(action, "a1")).toBe(true);
		expect(isPendingAuthorizationAction({ ...action, state: "done" }, "a1")).toBe(false);
		expect(isPendingAuthorizationAction({ ...action, kind: "file" }, "a1")).toBe(false);
		expect(isPendingAuthorizationAction(action, "other")).toBe(false);
	});

	it("keeps duplicate prompts scoped to task, revision and operation", () => {
		const input = { action: "ask-authorization", actionId: "a1" };
		expect(authorizationRequestKey("project-a", "task-1", 3, input)).toBe(
			"project-a:task-1:3:ask-authorization:a1",
		);
		expect(authorizationRequestKey("project-a", "task-1", 4, input)).not.toBe(
			authorizationRequestKey("project-a", "task-1", 3, input),
		);
	});

	it("uses stable ask_user titles for stage, outcome and rebind prompts", () => {
		expect(authorizationTitle("next-stage")).toBe("ask_user · 继续下一阶段？");
		expect(authorizationTitle("confirm-outcome")).toBe("ask_user · 确认这一步的结果");
		expect(authorizationTitle("ask-authorization", true)).toBe("ask_user · 更换这一项对应的文献？");
		expect(authorizationTitle("authorize-task")).toBe("ask_user · 开始执行这个任务？");
	});

	it("renders an authorization card without leaking internal identifiers", () => {
		const details = buildAuthorizationDetails(
			{
				goal: "整理本周文献",
				writeRoots: ["/work/results"],
				milestones: [{ id: "paper", title: "文献笔记" }],
			},
			{ title: "按计划执行", reason: "已完成准备", kind: "authorization" },
			null,
			() => "文献进入 Zotero（doi）",
		);
		expect(details).toContain("要做的事：整理本周文献");
		expect(details).toContain("会写入这些文件夹（包括子文件夹）：\n- /work/results");
		expect(details).toContain("做完的标准：\n- 文献笔记：文献进入 Zotero（doi）");
		expect(details).not.toContain("task-1");
		expect(details).not.toContain("revision");
	});

	it("renders rebind details and its narrower scope note", () => {
		const details = buildAuthorizationDetails(
			{
				goal: "核对论文",
				milestones: [{ id: "paper", title: "目标论文" }],
			},
			{ title: "换文献", reason: "原 DOI 无效", kind: "rebind" },
			{
				kind: "rebind",
				milestoneId: "paper",
				title: "换文献",
				reason: "原 DOI 无效",
				previous: "10.1000/old",
				expected: { doi: "10.1000/new" },
			},
		);
		expect(details).toContain("要改的交付项：目标论文");
		expect(details).toContain("原来的 DOI：10.1000/old");
		expect(details).toContain("换成的 DOI：10.1000/new");
		expect(details).toContain("这只改变这一项按哪篇文献核对");
	});
});
