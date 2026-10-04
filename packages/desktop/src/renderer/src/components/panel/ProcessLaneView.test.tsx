import { processDemoState } from "@drone/shared";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
	language.current = "zh";
});

const language = vi.hoisted(() => ({ current: "zh" as "zh" | "en" }));
vi.mock("../../i18n", async () => {
	const { zh } = await import("../../i18n/zh");
	const { en } = await import("../../i18n/en");
	return {
		useT: () => (key: string) => {
			let value: unknown = language.current === "zh" ? zh : en;
			for (const part of key.split(".")) value = (value as Record<string, unknown>)[part];
			return value;
		},
		useI18nStore: (selector: (state: { language: "zh" | "en" }) => unknown) =>
			selector({ language: language.current }),
	};
});
vi.mock("../../stores/ui", () => ({
	useUiStore: (selector: (state: { openPanel: () => void }) => unknown) => selector({ openPanel: () => {} }),
}));
vi.mock("../chat/RunInspector", () => ({ RunInspector: () => <div data-testid="run-inspector" /> }));

import { ProcessLaneView } from "./ProcessLaneView";

describe("ProcessLaneView", () => {
	it("localizes empty lanes and navigation in English while preserving reason codes", () => {
		language.current = "en";
		const html = renderToStaticMarkup(
			createElement(ProcessLaneView, {
				state: processDemoState(6),
				inspectors: [],
				timings: [],
				usages: [],
				onOpenReconcile: () => {},
			}),
		);
		expect(html).toContain('aria-label="Evidence"');
		expect(html).toContain("No literature search this turn");
		expect(html).toContain("View reconciliation");
		expect(html).toContain("reconcile-before-retry");
		expect(html).not.toContain("宿主门");
	});
	it("renders six lanes, gray empty evidence, and the step 7 host gate", () => {
		const html = renderToStaticMarkup(
			createElement(ProcessLaneView, {
				state: processDemoState(6),
				inspectors: [],
				timings: [],
				usages: [],
			}),
		);
		for (const lane of ["entry", "gate", "execution", "evidence", "deposit", "answer"])
			expect(html).toContain(`data-process-lane="${lane}"`);
		expect(html).toContain("这一轮没查文献");
		expect(html).toContain('data-process-node="doing"');
		expect(html).toContain('data-process-node="hostGate"');
		expect(html).toContain("reconcile-before-retry");
	});

	it("keeps the rule demonstration on the open task gate and exposes navigation actions", () => {
		const html = renderToStaticMarkup(
			createElement(ProcessLaneView, {
				state: processDemoState(5),
				inspectors: [],
				timings: [],
				usages: [],
				onOpenTask: () => {},
			}),
		);
		expect(html).toContain("规则演示");
		expect(html).toContain("planApproved");
		expect(html).not.toContain('data-process-node="hostGate"');
		const waiting = renderToStaticMarkup(
			createElement(ProcessLaneView, {
				state: processDemoState(4),
				inspectors: [],
				timings: [],
				usages: [],
				onOpenTask: () => {},
			}),
		);
		expect(waiting).toContain("打开任务");
	});
});
