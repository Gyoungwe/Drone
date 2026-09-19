import { EXAMPLE_TASKS, type ExampleTask, exampleTaskForDirection } from "@drone/shared";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, expect, it, vi } from "vitest";

const pi = vi.hoisted(() => ({ prompt: vi.fn(), pickPath: vi.fn() }));
vi.mock("../../api", () => ({ getPi: () => pi }));
vi.mock("../../i18n", () => ({
	useT: () => (key: string, params?: Record<string, string | number>) =>
		params ? `${key}:${Object.values(params).join(",")}` : key,
	useI18nStore: (selector: (s: { language: string }) => unknown) => selector({ language: "zh" }),
	translateOptional: () => null,
	translate: (_language: string, key: string) => key,
}));
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

import { ExampleTaskCards } from "./ExampleTaskCards";
import { ExampleTaskDialog, ExampleTaskForm, type ExampleTaskSessionContext } from "./ExampleTaskDialog";

const noSession: ExampleTaskSessionContext = {
	activeSessionId: null,
	hasCwd: true,
	readOnly: false,
	compacting: false,
};
function example(direction: ExampleTask["direction"]): ExampleTask {
	const task = exampleTaskForDirection(direction);
	if (!task) throw new Error(`${direction} example missing`);
	return task;
}
function renderForm(task: ExampleTask, session: ExampleTaskSessionContext = noSession): string {
	return renderToStaticMarkup(createElement(ExampleTaskForm, { task, session, onClose: () => {} }));
}

it("the 任务 empty state offers exactly one card per direction and no task exists yet", () => {
	const html = renderToStaticMarkup(createElement(ExampleTaskCards));
	expect(html.match(/data-testid="example-task-card"/g)).toHaveLength(EXAMPLE_TASKS.length);
	for (const task of EXAMPLE_TASKS) {
		expect(html).toContain(`data-example-task="${task.id}"`);
		expect(html).toContain(task.title.zh);
	}
	expect(html).toContain("examples.emptyTitle");
	expect(pi.prompt).not.toHaveBeenCalled();
});

it("the dialog renders nothing until an example is opened", () => {
	expect(renderToStaticMarkup(createElement(ExampleTaskDialog))).toBe("");
});

it("the form shows inputs, the applicable milestones and the confirmations to expect", () => {
	const evidence = example("evidence");
	const html = renderForm(evidence);
	expect(html).toContain('data-testid="example-task-dialog"');
	expect(html.match(/data-testid="example-task-input"/g)).toHaveLength(evidence.inputs.length);
	// Optional Zotero filing defaults to "no", so only two milestones apply and zotero_item is not promised.
	expect(html.match(/data-testid="example-task-milestone"/g)).toHaveLength(2);
	expect(html).not.toContain("zotero_item");
	expect(html).toContain("examples.auth.task");
	expect(html).toContain("examples.auth.zotero-write");
	expect(html).toContain("/skill:nature-academic-search");
	// Required inputs start empty; no user path is ever pre-filled.
	expect(html).not.toMatch(/value="[A-Za-z]:\\/);
	expect(html).not.toMatch(/value="\/(home|Users)\//);
});

it("path inputs get the picker their kind allows", () => {
	const analysis = renderForm(example("analysis"));
	expect(analysis).toContain("examples.pickFile");
	expect(analysis).not.toContain("examples.pickFolder");
	const engineering = renderForm(example("engineering"));
	expect(engineering).toContain("examples.pickFolder");
	expect(engineering).not.toContain("examples.pickFile");
	const planning = renderForm(example("planning"));
	expect(planning).toContain("examples.pickFile");
	expect(planning).toContain("examples.pickFolder");
});

it("without an active session the primary action creates one; a real session sends in place", () => {
	const planning = example("planning");
	expect(renderForm(planning)).toContain("examples.launchNew");
	expect(renderForm(planning, { ...noSession, activeSessionId: "draft:1" })).toContain("examples.launchNew");
	const live = renderForm(planning, { ...noSession, activeSessionId: "session-1" });
	expect(live).toContain("examples.launch<");
	expect(live).not.toContain("examples.launchNew");
	// Rendering never sends anything; only the user's click does.
	expect(pi.prompt).not.toHaveBeenCalled();
});

it("a read-only (subagent inspection) session cannot launch or insert an example", () => {
	const html = renderForm(example("writing"), { ...noSession, activeSessionId: "ro", readOnly: true });
	expect(html).toMatch(/data-testid="example-task-launch"[^>]*disabled=""/);
});

it("no project folder means a new session cannot be created, so launching is disabled", () => {
	const html = renderForm(example("presentation"), { ...noSession, hasCwd: false });
	expect(html).toMatch(/data-testid="example-task-launch"[^>]*disabled=""/);
});
