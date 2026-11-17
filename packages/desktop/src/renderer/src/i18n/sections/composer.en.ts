import type { zhComposer } from "./composer.zh";

export const enComposer: typeof zhComposer = {
	config: {
		mode: "Mode",
		model: "Model",
		effort: "Effort",
		permission: "Permissions",
		runConfig: "Run config",
		modeHint: "Decides available tools and subagent concurrency",
		modelHint: "Model used by this session",
		effortHint: "Reasoning depth; higher is slower and costlier",
		permissionHint: "When tool calls need your confirmation",
	},
	mode: {
		title: "Mode (decides available tools)",
		single: "Solo",
		singleHint: "Own tools only, no subagents",
		lead: "Lead",
		leadHint: "Dispatch one subagent at a time",
		swarm: "Swarm",
		swarmHint: "Dispatch up to 4 subagents in parallel",
		changed: "Switched to {mode}",
		cacheReset: "tool changes reset the prompt cache",
	},
	status: { extension: "Extension status", local: "Local", memoryLoaded: "{count} memories loaded" },
	placeholder:
		"Describe your task — / for commands or skills, @ to reference files, tasks, software and databases",
	placeholderQueued: "Queue a message — sent when the current task finishes",
	placeholderCompacting: "Compacting context…",
	placeholderReadOnly: "Subagent transcript is read-only — continue in the parent session",
	compacting: "Compacting context — send when it finishes",
	stop: "Stop",
	send: "Send",
	modelDefault: "Select model",
	modelGroupHint: "Model · thinking depth",
	noModelHint: "No model is configured. Open Settings to add a model service, then send.",
	addImage: "Add image",
	imageUnsupported:
		"The current model doesn't support image input — remove the image or switch to a multimodal model",
	removeImage: "Remove image",
	removeAttachment: "Remove reference",
	previewImage: "View image",
	queueTitle: "Queued",
	queueRestore: "Take back to editor",
	queueFull: "A message is already queued — take it back first",
	removeQuote: "Remove quote",
	permissionMode: "Permission mode",
	permissionFullAccess: "Full access",
	permissionFullAccessTitle: "Full access",
	permissionFullAccessDesc:
		"Nothing is blocked; high-risk command runs are written to an audit log — current session only",
	permissionStrict: "Strict confirmation",
	permissionAuto: "Auto-run",
	permissionAutoTitle: "Auto-run (recommended)",
	permissionStrictDesc: "Ordinary file writes also need confirmation; task authorization still applies.",
	permissionAutoDesc:
		"Ordinary edits inside the project run automatically; sensitive files, writes outside the project, deletions and publishing still need confirmation.",
	permissionGateOff: "The built-in permission checks are disabled in permissions.json",
	dispatch: "Dispatch",
	dispatchHint:
		"Enter dispatches to this session · Shift+Enter for a new line · results land in the Subagents tab",
	subagentTaskPlaceholder: "Task for {agent}: goal, scope, where to put the output…",
	subagentChipTitle: "Dispatch to subagent {agent} (Esc to undo)",
	removeSubagent: "Remove subagent",
	dropRegion: "File drop area",
	dropTarget:
		"Drop to add files; project files become references and outside files are saved to this session",
	subagentTaskRequired: "Write the task you want {agent} to do",
	subagentNoImages:
		"Subagent dispatch cannot carry images: remove them, or drop the @ chip to send to the main model",
	subagentNoSession: "Send a message to create the session first, then dispatch subagents with @",
	subagentDispatched:
		"Dispatched {agent}; its result will land in this session (track it in the Subagents tab)",
	subagentNeedsPanel:
		"{agent} is a project-level definition and must be trusted in the panel for each dispatch — preselected for you",
};
