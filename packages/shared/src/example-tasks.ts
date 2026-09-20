import examples from "./example-tasks.json";
import { WORKFLOW_DIRECTIONS, type WorkflowDirection, workflowStage } from "./workflow-catalog";

/**
 * Built-in example tasks: one per workflow direction. Data only — importing this module never
 * creates a task, writes a file or grants a permission. The desktop renders the examples and
 * sends one ordinary first message; `task_plan` and the authorization card still decide everything.
 */
export type ExampleTaskLanguage = "zh" | "en";
export type ExampleTaskText = Record<ExampleTaskLanguage, string>;
export type ExampleTaskInputKind = "text" | "path" | "doi" | "select";
export type ExampleTaskPathKind = "file" | "directory" | "any";
export type ExampleTaskAcceptanceKind = "file" | "human_review" | "zotero_item" | "wiki_review";
export type ExampleTaskAuthorization = "task" | "zotero-write" | "external-delivery";

export interface ExampleTaskInputOption {
	value: string;
	label: ExampleTaskText;
}
export interface ExampleTaskInput {
	key: string;
	label: ExampleTaskText;
	placeholder?: ExampleTaskText;
	required: boolean;
	kind: ExampleTaskInputKind;
	/** `path` only: which native picker to offer (default `any` = file or folder). */
	pathKind?: ExampleTaskPathKind;
	/** `select` only */
	options?: ExampleTaskInputOption[];
	/** Optional inputs only; required inputs must be typed by the user. */
	defaultValue?: string;
}
export interface ExampleTaskMilestone {
	title: ExampleTaskText;
	acceptance: { kind: ExampleTaskAcceptanceKind; hint?: string };
	/** Include this milestone only when the named input has the given value (e.g. optional Zotero filing). */
	when?: { input: string; equals: string };
}
export interface ExampleTask {
	id: string;
	direction: WorkflowDirection;
	/** Stage ids from WORKFLOW_STAGES, all in `direction`; the first one owns the opening command. */
	stages: string[];
	/** One of the first stage's commands; defaults to its first command. Stored without the leading `/`. */
	command?: string;
	title: ExampleTaskText;
	goal: ExampleTaskText;
	inputs: ExampleTaskInput[];
	milestones: ExampleTaskMilestone[];
	/** Confirmations the user should expect; informational only. */
	authorizations: ExampleTaskAuthorization[];
	/** Expected artifacts; informational only, never used for acceptance. */
	artifacts: ExampleTaskText[];
	/** Boundary reminder derived from the stage contract. */
	contractNotes?: ExampleTaskText;
}

export const EXAMPLE_TASK_ACCEPTANCE_KINDS: readonly ExampleTaskAcceptanceKind[] = [
	"file",
	"human_review",
	"zotero_item",
	"wiki_review",
];
export const EXAMPLE_TASK_INPUT_KINDS: readonly ExampleTaskInputKind[] = ["text", "path", "doi", "select"];

export const EXAMPLE_TASKS = examples as ExampleTask[];

export function exampleTask(id: string): ExampleTask | undefined {
	return EXAMPLE_TASKS.find((task) => task.id === id);
}
export function exampleTaskForDirection(direction: WorkflowDirection): ExampleTask | undefined {
	return EXAMPLE_TASKS.find((task) => task.direction === direction);
}
/** Opening command without the leading slash, e.g. `skill:hypothesis-generation`. */
export function exampleTaskCommand(task: ExampleTask): string {
	return task.command ?? workflowStage(task.stages[0] ?? "")?.commands[0] ?? "";
}
/** Default form values: optional inputs may pre-fill, required ones never do. */
export function exampleTaskDefaults(task: ExampleTask): Record<string, string> {
	const values: Record<string, string> = {};
	for (const input of task.inputs) values[input.key] = (!input.required && input.defaultValue) || "";
	return values;
}
/** Keys of required inputs that are still blank. */
export function missingExampleTaskInputs(task: ExampleTask, values: Record<string, string>): string[] {
	return task.inputs.filter((input) => input.required && !(values[input.key] ?? "").trim()).map((i) => i.key);
}
/** Milestones that apply to the given form values (conditional ones dropped when their input says so). */
export function activeExampleTaskMilestones(
	task: ExampleTask,
	values: Record<string, string>,
): ExampleTaskMilestone[] {
	return task.milestones.filter((m) => !m.when || (values[m.when.input] ?? "") === m.when.equals);
}

const PROMPT_TEXT = {
	zh: {
		header: "示例任务",
		goal: "目标",
		inputs: "输入",
		notProvided: "（未提供）",
		plan: "请先用 task_plan 建立任务并等待我的授权；授权一次后请自主完成全部里程碑，不要中途再询问或等待，需要我判断的内容写进交付文件：",
		acceptance: "验收",
		boundary: "边界",
		contract: "阶段契约",
	},
	en: {
		header: "Example task",
		goal: "Goal",
		inputs: "Inputs",
		notProvided: "(not provided)",
		plan: "Please create the task with task_plan first and wait for my authorization; after that one authorization, complete every milestone on your own without asking or waiting again, and put anything that needs my judgement into the deliverable files:",
		acceptance: "acceptance",
		boundary: "Boundary",
		contract: "stage contract",
	},
} as const;

function directionLabel(direction: WorkflowDirection, language: ExampleTaskLanguage): string {
	return WORKFLOW_DIRECTIONS.find((d) => d.id === direction)?.label[language] ?? direction;
}
function inputDisplayValue(input: ExampleTaskInput, raw: string, language: ExampleTaskLanguage): string {
	const value = raw.trim();
	if (!value) return "";
	if (input.kind === "select")
		return input.options?.find((option) => option.value === value)?.label[language] ?? value;
	return value;
}

/**
 * The single structured first message. Pure: same task + values + language → same text.
 * Line 1 is `/<command> <header>` so the SDK's `/skill:name args` expansion (name ends at the
 * first space) sees the real skill name; everything after that space is passed as arguments.
 */
export function composeExampleTaskPrompt(
	task: ExampleTask,
	values: Record<string, string>,
	language: ExampleTaskLanguage,
): string {
	const text = PROMPT_TEXT[language];
	const sep = language === "zh" ? "；" : "; ";
	const colon = language === "zh" ? "：" : ": ";
	const stage = workflowStage(task.stages[0] ?? "");
	const title = `${text.header} · ${directionLabel(task.direction, language)} · ${task.title[language]}`;
	const header = language === "zh" ? `【${title}】` : `[${title}]`;
	const inputs = task.inputs
		.map((input) => {
			const value = inputDisplayValue(input, values[input.key] ?? "", language);
			return `${input.label[language]}=${value || text.notProvided}`;
		})
		.join(sep);
	const milestones = activeExampleTaskMilestones(task, values).map((milestone, index) => {
		const target = milestone.acceptance.hint ? ` → ${milestone.acceptance.hint}` : "";
		const acceptance = `${text.acceptance}${colon}${milestone.acceptance.kind}`;
		return `  ${index + 1}. ${milestone.title[language]}${target}${language === "zh" ? `（${acceptance}）` : ` (${acceptance})`}`;
	});
	const boundary = [
		task.contractNotes ? `${text.boundary}${colon}${task.contractNotes[language]}` : "",
		stage ? `${text.contract}${colon}${stage.contract}` : "",
	]
		.filter(Boolean)
		.join(sep);
	return [
		`/${exampleTaskCommand(task)} ${header}`,
		`${text.goal}${colon}${task.goal[language]}`,
		`${text.inputs}${colon}${inputs}`,
		text.plan,
		...milestones,
		boundary,
	]
		.filter(Boolean)
		.join("\n");
}
