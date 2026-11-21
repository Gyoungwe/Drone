import type { P5BackgroundStatus } from "@drone/shared";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { en } from "../../i18n/en";
import { zh } from "../../i18n/zh";
import { BackgroundJobsSettingsView, parseDailyLimitInput } from "./BackgroundJobsSettingsRow";

vi.mock("../../i18n", () => ({
	useT: () => (key: string, params?: Record<string, string | number>) =>
		params ? `${key}:${params.used} / ${params.limit}` : key,
}));
vi.stubGlobal("React", React);

const defaultStatus: P5BackgroundStatus = {
	enabled: false,
	dailyTokenLimit: 10_000_000,
	usedTokens: 0,
	exhausted: false,
	unknownUsage: false,
};

const view = (status: P5BackgroundStatus | null) =>
	renderToStaticMarkup(
		createElement(BackgroundJobsSettingsView, { status, onToggle: vi.fn(), onSetLimit: vi.fn() }),
	);

it.each([
	["2000000", 2_000_000],
	[" 42 ", 42],
	["0", null],
	["-1", null],
	["1.5", null],
	["1e6", null],
	["", null],
	["abc", null],
	["9007199254740993", null],
])("parses a daily budget of %j as %s", (text, expected) => {
	expect(parseDailyLimitInput(text)).toBe(expected);
});

it("disables the unchecked switch and the budget input while status is unavailable", () => {
	const html = view(null);
	expect(html).toMatch(/<button[^>]*role="switch"[^>]*aria-checked="false"[^>]*disabled=""/);
	expect(html).toMatch(/<input[^>]*type="number"[^>]*disabled=""/);
});

it("shows workspace settings and formatted usage without a warning by default", () => {
	const html = view(defaultStatus);
	expect(html).toContain("settings.backgroundJobs.toggle");
	expect(html).toContain("settings.backgroundJobs.budget");
	expect(html).toContain(
		`settings.backgroundJobs.usage:${defaultStatus.usedTokens.toLocaleString()} / ${defaultStatus.dailyTokenLimit.toLocaleString()}`,
	);
	expect(html).not.toContain("settings.backgroundJobs.exhausted");
	expect(html).not.toContain("settings.backgroundJobs.unknownUsage");
});

it("shows the exhausted budget warning when usage is known", () => {
	const html = view({ ...defaultStatus, exhausted: true });
	expect(html).toContain("settings.backgroundJobs.exhausted");
	expect(html).not.toContain("settings.backgroundJobs.unknownUsage");
});

it("shows only the unknown usage warning when both warnings apply", () => {
	const html = view({ ...defaultStatus, exhausted: true, unknownUsage: true });
	expect(html).toContain("settings.backgroundJobs.unknownUsage");
	expect(html).not.toContain("settings.backgroundJobs.exhausted");
});

it("uses the approved background jobs copy in both languages", () => {
	expect(zh.settings.backgroundJobs).toEqual({
		section: "后台任务",
		toggle: "允许此工作区运行后台模型任务",
		toggleHint:
			"开启后，插件的后台任务（如审稿、批量模型处理）会排队运行，关闭窗口后仍会继续。你手动发起的任务不受影响。",
		budget: "每日后台额度（tokens）",
		budgetHint: "按输入加输出 token 计算，不含缓存读取；每天本地零点重置。额度用完后，当前任务做完即停止。",
		usage: "今日已用 {used} / {limit}",
		exhausted: "今日后台额度已用完，零点后恢复。",
		unknownUsage: "有任务没有报告用量，今天的后台任务已停止。",
	});
	expect(en.settings.backgroundJobs).toEqual({
		section: "Background jobs",
		toggle: "Allow background model jobs in this workspace",
		toggleHint:
			"When on, plugins' background jobs (such as review and model batches) run in a queue and keep running after you close the window. Jobs you start yourself are not affected.",
		budget: "Daily background budget (tokens)",
		budgetHint:
			"Counts input plus output tokens, excluding cache reads. Resets at local midnight. When it runs out, the current job finishes and the queue stops.",
		usage: "Used today: {used} / {limit}",
		exhausted: "Today's background budget is used up. Jobs resume after midnight.",
		unknownUsage: "A job did not report its usage, so background jobs are stopped for today.",
	});
});
