import {
	SUBAGENT_PANEL_MAX_TASKS,
	type SubagentDispatchInput,
	type SubagentPanelAgent,
	type SubagentPanelRun,
	WORKFLOW_STAGES,
	workflowStage,
} from "@drone/shared";

/** 派发表单的一行任务（UI 态） */
export interface DispatchTaskDraft {
	key: string;
	agent: string;
	task: string;
	requiredTools: string[];
}

export interface DispatchFormDraft {
	tasks: DispatchTaskDraft[];
	stageId: string;
	followUp: boolean;
	trustProjectAgents: boolean;
}

export type DispatchTaskErrorCode = "agent" | "task" | "tools" | "trust" | "untrusted";

export interface DispatchTaskError {
	key: string;
	code: DispatchTaskErrorCode;
	agent: string;
	/** tools：不在工具集里的必需工具 */
	tools: string[];
}

let draftSeq = 0;
export function newTaskDraft(agent = ""): DispatchTaskDraft {
	draftSeq += 1;
	return { key: `t${draftSeq}`, agent, task: "", requiredTools: [] };
}

export function emptyDispatchForm(agent = ""): DispatchFormDraft {
	return { tasks: [newTaskDraft(agent)], stageId: "", followUp: true, trustProjectAgents: false };
}

/**
 * 表单校验（与后端一致，前端先拦）：agent 必选、任务必填、必需工具 ⊆ 工具集、
 * 项目级定义要勾选信任、未信任项目的项目级定义不可派发。返回逐行错误。
 */
export function validateDispatchForm(
	form: DispatchFormDraft,
	agents: readonly SubagentPanelAgent[],
): DispatchTaskError[] {
	const errors: DispatchTaskError[] = [];
	for (const task of form.tasks) {
		const agent = agents.find((item) => item.name === task.agent);
		if (!task.agent || !agent) {
			errors.push({ key: task.key, code: "agent", agent: task.agent, tools: [] });
			continue;
		}
		if (agent.source === "project" && !agent.trusted) {
			errors.push({ key: task.key, code: "untrusted", agent: agent.name, tools: [] });
			continue;
		}
		if (!task.task.trim()) {
			errors.push({ key: task.key, code: "task", agent: agent.name, tools: [] });
			continue;
		}
		const missing = task.requiredTools.filter((tool) => !agent.tools.includes(tool));
		if (missing.length > 0) {
			errors.push({ key: task.key, code: "tools", agent: agent.name, tools: missing });
			continue;
		}
		if (agent.source === "project" && !form.trustProjectAgents) {
			errors.push({ key: task.key, code: "trust", agent: agent.name, tools: [] });
		}
	}
	return errors;
}

/** 表单是否含项目级定义（决定信任勾选框是否出现） */
export function formNeedsProjectTrust(
	form: DispatchFormDraft,
	agents: readonly SubagentPanelAgent[],
): boolean {
	return form.tasks.some((task) => agents.find((item) => item.name === task.agent)?.source === "project");
}

/** 阶段契约追加到任务末尾（不改变 agent 定义；与示例任务共用 WORKFLOW_STAGES） */
export function taskWithStageContract(task: string, stageId: string, language: "zh" | "en"): string {
	const stage = stageId ? workflowStage(stageId) : undefined;
	const body = task.trim();
	if (!stage) return body;
	const label = language === "zh" ? stage.label.zh : stage.label.en;
	return `${body}\n\n[Stage contract · ${label}] ${stage.contract}`;
}

/** 表单 → 派发输入（校验通过后调用） */
export function buildDispatchInput(
	form: DispatchFormDraft,
	options: { cwd?: string; language: "zh" | "en" },
): SubagentDispatchInput {
	return {
		tasks: form.tasks.map((task) => ({
			agent: task.agent,
			task: taskWithStageContract(task.task, form.stageId, options.language),
			...(task.requiredTools.length > 0 ? { requiredTools: [...task.requiredTools] } : {}),
		})),
		...(options.cwd ? { cwd: options.cwd } : {}),
		followUp: form.followUp,
		trustProjectAgents: form.trustProjectAgents,
	};
}

/** 阶段提示下拉项：按方向分组 */
export function stageOptions(language: "zh" | "en"): Array<{ id: string; label: string; direction: string }> {
	return WORKFLOW_STAGES.map((stage) => ({
		id: stage.id,
		direction: stage.direction,
		label: language === "zh" ? stage.label.zh : stage.label.en,
	}));
}

/** 本批立即运行 / 排队数（运行槽 = 项目并发上限 − 本会话已在跑的数量） */
export function dispatchSlotPlan(
	taskCount: number,
	active: number,
	limit: number,
): { now: number; queued: number; free: number } {
	const free = Math.max(0, limit - active);
	const now = Math.min(taskCount, free);
	return { now, queued: Math.max(0, taskCount - now), free };
}

export function canAddTask(form: DispatchFormDraft): boolean {
	return form.tasks.length < SUBAGENT_PANEL_MAX_TASKS;
}

/** 「插入到输入框」保底路径：结构化提示词交给主模型自行编排（不派发） */
export function promptDispatchText(
	form: DispatchFormDraft,
	labels: { header: (agent: string, task: string) => string; required: (tools: string) => string },
	language: "zh" | "en",
): string {
	return form.tasks
		.map((task) => {
			const lines = [labels.header(task.agent, taskWithStageContract(task.task, form.stageId, language))];
			if (task.requiredTools.length > 0) lines.push(labels.required(task.requiredTools.join(", ")));
			return lines.join("\n");
		})
		.join("\n\n");
}

/** 「引用」：结果摘要（≤ maxLines 行）+ 子会话文件，作为 blockquote 插入输入框，用户编辑后再发 */
export function citeRunText(run: SubagentPanelRun, header: string, maxLines = 20): string {
	const body = (run.content ?? run.error ?? "").trim();
	const lines = body ? body.split(/\r?\n/) : [];
	const kept = lines.slice(0, maxLines);
	if (lines.length > maxLines) kept.push("…");
	const quoted = [header, ...kept].map((line) => `> ${line}`).join("\n");
	return run.sessionFile ? `${quoted}\n> ${run.sessionFile}` : quoted;
}
