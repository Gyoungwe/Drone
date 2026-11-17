import type { zhExamples } from "./examples.zh";

export const enExamples: typeof zhExamples = {
	emptyTitle: "No tasks yet — start from an example",
	emptyHint:
		"One example per direction: fill in the inputs and a single first message is sent. The agent creates the task with task_plan and starts only after your authorization.",
	menuItem: "Example: {title}",
	eyebrow: "Example task",
	stages: "Stages",
	inputs: "Inputs",
	required: "Required",
	optional: "optional",
	missing: "Please fill in this field",
	pickFile: "Choose file",
	pickFolder: "Choose folder",
	milestones: "Milestones (proposed to task_plan)",
	confirmations: "Confirmations you will see",
	auth: {
		task: "Task authorization card: after task_plan creates the task, nothing runs until you approve",
		"zotero-write":
			"Zotero write: papers listed on the task authorization card need no separate consent; only writes outside the plan ask again",
		"external-delivery": "Outbound delivery / push: needs separate authorization",
	},
	artifacts: "Expected outputs",
	boundary: "Boundary",
	launch: "Start in this session",
	launchNew: "New session and start",
	launching: "Sending…",
	insert: "Insert into composer",
	copy: "Copy message",
	copied: "Copied",
	readOnly: "Read-only sessions cannot start an example task",
	noSession: "Pick a project folder first",
	compacting: "Context is compacting; try again in a moment",
	sendFailed: "Failed to send the example task",
	disclaimer:
		"An example sends one message only: it never pre-creates a task, writes a file or runs a command by itself.",
	tag: {
		planning: "Plan",
		evidence: "Evidence",
		analysis: "Analysis",
		writing: "Writing",
		presentation: "Delivery",
		engineering: "Engineering",
	},
};
