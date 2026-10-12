import type { AskRequest } from "@drone/shared";
import * as React from "react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AskDialog } from "./AskDialog";

vi.mock("../../i18n", () => ({
	useT: () => (key: string, params?: Record<string, string | number>) => {
		const labels: Record<string, string> = {
			"ask.proposal.benefits": "收益",
			"ask.proposal.costs": "代价",
			"ask.proposal.risks": "风险",
			"ask.proposal.resources": "资源",
			"ask.proposal.highRisk": "高风险，需单独授权",
		};
		return params ? `${labels[key] ?? key}:${Object.values(params).join(",")}` : (labels[key] ?? key);
	},
}));

vi.mock("../ui/Button", () => ({
	Button: ({ children }: { children?: ReactNode }) => createElement("button", { type: "button" }, children),
}));

vi.stubGlobal("React", React);

it("formats model recommendation lists inside the ask card", () => {
	const request: AskRequest = {
		id: "ask-1",
		sessionId: "session-1",
		toolCallId: "tool-1",
		title: "需要确认",
		questions: [
			{
				id: "choice",
				label: "选择",
				prompt: "请确认：1. 范围 2. 格式",
				type: "single",
				required: true,
				options: [{ value: "keep", label: "继续", description: "依据：• 证据完整 • 风险可控" }],
				recommendation: {
					value: "keep",
					confidence: "high",
					reason: "建议：1. 保留当前结果 2. 继续执行",
					basedOn: ["当前任务"],
				},
			},
		],
	};
	const html = renderToStaticMarkup(createElement(AskDialog, { requests: [request], onRespond: vi.fn() }));
	expect(html).toMatch(/建议：\s+1\. 保留当前结果\s+2\. 继续执行/);
	expect(html).not.toContain("建议：1. 保留当前结果 2. 继续执行");
	expect(html).toMatch(/依据：\s+• 证据完整\s+• 风险可控/);
});

it("renders the dynamic proposal projection without selecting its recommendation", () => {
	const request: AskRequest = {
		id: "ask-proposal",
		sessionId: "session-1",
		toolCallId: "tool-1",
		kind: "authorization",
		proposal: {
			proposalHash: "p-hash",
			recommendation: { value: "keep", reason: "Evidence is complete" },
			benefits: ["Reproducible result"],
			costs: ["Uses two core hours"],
			risks: ["Input quality"],
			resources: ["hpc-a"],
			authorizationActions: [{ id: "write", label: "Write output", risk: "high" }],
		},
		questions: [
			{
				id: "choice",
				label: "Choice",
				prompt: "Choose",
				type: "single",
				required: true,
				options: [
					{ value: "keep", label: "Keep" },
					{ value: "custom", label: "Custom" },
				],
				allowCustomText: true,
			},
		],
	};
	const html = renderToStaticMarkup(createElement(AskDialog, { requests: [request], onRespond: vi.fn() }));
	expect(html).toContain("收益");
	expect(html).toContain("高风险，需单独授权");
	expect(html).not.toContain('checked=""');
});

it("renders nothing when no ask is pending", () => {
	expect(renderToStaticMarkup(createElement(AskDialog, { requests: [], onRespond: vi.fn() }))).toBe("");
});

it("uses the warn tone for authorization asks", () => {
	const request: AskRequest = {
		id: "auth",
		sessionId: "s",
		toolCallId: "t",
		kind: "authorization",
		questions: [
			{
				id: "q",
				label: "授权",
				prompt: "允许写入 Zotero？",
				type: "single",
				required: true,
				options: [
					{ value: "yes", label: "允许" },
					{ value: "no", label: "拒绝" },
				],
			},
		],
	};
	const html = renderToStaticMarkup(
		createElement(AskDialog, { requests: [request, { ...request, id: "auth-2" }], onRespond: vi.fn() }),
	);
	expect(html).toContain('data-tone="warn"');
	expect(html).toContain("ask.queued:1");
});
