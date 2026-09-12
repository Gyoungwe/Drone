import type { ReportedUsage } from "../usage-display";
import type { ProgressDisplay } from "../progress-display";
import type { SubagentRunUi, UIMessage, UIToolCall } from "./types";

export interface RunInspectorModel {
	provider?: string;
	model?: string;
	responses: number;
}
export interface RunInspectorPublication {
	status: "not-run" | "passed" | "blocked" | "checked";
	reason?: string;
}
export interface RunInspectorTurn {
	turnIndex: number;
	publicStages: ProgressDisplay[];
	tools: UIToolCall[];
	models: RunInspectorModel[];
	subagents: SubagentRunUi[];
	artifacts: string[];
	sourcePaths: string[];
	publication: RunInspectorPublication;
	errors: number;
	skill?: string;
}

function modelKey(usage: ReportedUsage): string {
	return `${usage.provider ?? ""}\0${usage.model ?? ""}`;
}
function outputObject(text: string): Record<string, unknown> | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	try {
		const parsed = JSON.parse(trimmed);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
	} catch {
		const start = trimmed.indexOf("{");
		const end = trimmed.lastIndexOf("}");
		if (start < 0 || end <= start) return null;
		try {
			const parsed = JSON.parse(trimmed.slice(start, end + 1));
			return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
		} catch { return null; }
	}
}
function pathFromRead(tool: UIToolCall): string[] {
	if (tool.state !== "done") return [];
	if (tool.name !== "read" && tool.name !== "research_read_knowledge") return [];
	const values = new Set<string>();
	for (const text of [tool.output, tool.name === "read" ? tool.args : ""]) {
		for (const match of text.matchAll(/(?:"(?:path|file)"\s*:\s*"|\[\[)([^"\]\n]{2,600})/g)) values.add(match[1]!.trim());
	}
	return [...values].slice(0, 12);
}
function publicationFrom(tool: UIToolCall): RunInspectorPublication | null {
	if (tool.name !== "research_check_answer") return null;
	if (tool.state === "error") return { status: "blocked", reason: tool.output.slice(0, 300) || "tool error" };
	if (tool.state === "running") return { status: "checked" };
	const parsed = outputObject(tool.output);
	if (parsed?.ok === true) return { status: "passed" };
	if (parsed?.ok === false) return { status: "blocked", reason: typeof parsed.reason === "string" ? parsed.reason : typeof parsed.code === "string" ? parsed.code : undefined };
	return { status: "checked" };
}

export function deriveRunInspectors(messages: readonly UIMessage[]): RunInspectorTurn[] {
	const turns: RunInspectorTurn[] = [];
	let current: RunInspectorTurn | undefined;
	const modelCounts = new Map<number, Map<string, RunInspectorModel>>();
	for (const message of messages) {
		if (message.kind === "user") {
			current = { turnIndex: turns.length, publicStages: [], tools: [], models: [], subagents: [], artifacts: [], sourcePaths: [], publication: { status: "not-run" }, errors: 0, ...(message.skill ? { skill: message.skill.name } : {}) };
			turns.push(current);
			modelCounts.set(current.turnIndex, new Map());
			continue;
		}
		if (!current) continue;
		if (message.kind === "assistant") {
			if (message.progress) current.publicStages.push(message.progress);
			for (const tool of message.tools) {
				current.tools.push(tool);
				for (const path of pathFromRead(tool)) if (!current.sourcePaths.includes(path)) current.sourcePaths.push(path);
				const publication = publicationFrom(tool);
				if (publication) current.publication = publication;
			}
			if (message.usage) {
				const models = modelCounts.get(current.turnIndex)!;
				const key = modelKey(message.usage);
				const previous = models.get(key);
				models.set(key, { provider: message.usage.provider, model: message.usage.model, responses: (previous?.responses ?? 0) + 1 });
				current.models = [...models.values()];
			}
		} else if (message.kind === "subagent") current.subagents.push(...message.runs);
		else if (message.kind === "image") {
			for (const path of message.paths) if (!current.artifacts.includes(path)) current.artifacts.push(path);
		} else if (message.kind === "error") current.errors++;
	}
	return turns;
}
