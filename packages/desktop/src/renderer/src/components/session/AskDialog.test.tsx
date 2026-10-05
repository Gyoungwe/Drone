import type { AskRequest } from "@drone/shared";
import * as React from "react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AskDialog } from "./AskDialog";

vi.mock("../../i18n", () => ({
	useT: () => (key: string, params?: Record<string, string | number>) =>
		params ? `${key}:${Object.values(params).join(",")}` : key,
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
