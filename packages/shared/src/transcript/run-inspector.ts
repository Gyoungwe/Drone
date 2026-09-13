import type { ProgressDisplay } from "../progress-display";
import type { ReportedUsage } from "../usage-display";
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
export interface RunInspectorRetrieval {
	toolId: string;
	query: string;
	mode: string;
	lexicalCandidates?: number;
	semanticCandidates?: number;
	mergedCandidates?: number;
	elapsedMs?: number;
	fallbackReason: string | null;
	indexCoverage?: string;
}
export interface RunInspectorDiagnostic {
	id?: string;
	tool: string;
	status: string;
	reason: string;
	nextAction?: string;
}
export interface RunInspectorTurn {
	turnIndex: number;
	publicStages: (ProgressDisplay & { id?: string })[];
	tools: UIToolCall[];
	models: RunInspectorModel[];
	subagents: SubagentRunUi[];
	artifacts: string[];
	sourcePaths: string[];
	publication: RunInspectorPublication;
	retrievals: RunInspectorRetrieval[];
	diagnostics: RunInspectorDiagnostic[];
	errors: number;
	skill?: string;
}

function modelKey(usage: ReportedUsage): string {
	return `${usage.provider ?? ""}\0${usage.model ?? ""}`;
}
function object(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
function outputObject(text: string): Record<string, unknown> | null {
	if (!text || text.length > 1_000_000) return null;
	const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
	try {
		return object(JSON.parse(trimmed));
	} catch {
		return null;
	}
}
const textField = (value: unknown, max = 400) =>
	typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
const countField = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

/** A link in returned Markdown is NOT an actual read. Only the successful target qualifies. */
function pathFromRead(tool: UIToolCall): string[] {
	if (tool.state !== "done") return [];
	let path: unknown;
	if (tool.name === "research_read_knowledge") {
		const page = outputObject(tool.output);
		if (!page || page.missing || !textField(page.text, 1)) return [];
		path = page.path;
	} else if (tool.name === "read") {
		const args = outputObject(tool.args);
		path = args?.path ?? args?.file_path;
	} else return [];
	const target = textField(path, 600);
	return target ? [target] : [];
}
function publicationFrom(tool: UIToolCall): RunInspectorPublication | null {
	if (tool.name !== "research_check_answer") return null;
	if (tool.state === "error")
		return { status: "blocked", reason: textField(tool.output, 300) || "tool error" };
	const parsed = outputObject(tool.output);
	if (parsed?.ok === true) return { status: "passed" };
	if (parsed?.ok === false)
		return { status: "blocked", reason: textField(parsed.reason) ?? textField(parsed.code) };
	return { status: "checked" };
}
function retrievalFrom(tool: UIToolCall): RunInspectorRetrieval | null {
	if (!["research_search_knowledge", "research_search_explainers"].includes(tool.name)) return null;
	const parsed = outputObject(tool.output);
	const metrics = object(parsed?.retrieval);
	if (!metrics) return null;
	const index = object(metrics.index);
	return {
		toolId: tool.id || tool.key,
		query: textField(metrics.query ?? parsed?.query, 2000) || "",
		mode: textField(metrics.mode, 40) || "unknown",
		lexicalCandidates: countField(metrics.lexicalCandidates),
		semanticCandidates: countField(metrics.semanticCandidates),
		mergedCandidates: countField(metrics.mergedCandidates),
		elapsedMs: countField(metrics.elapsedMs),
		fallbackReason: textField(metrics.fallbackReason, 240) ?? null,
		indexCoverage: textField(index?.coverage ?? metrics.indexCoverage, 80),
	};
}
function taskStatusDiagnostics(tool: UIToolCall): RunInspectorDiagnostic[] {
	if (tool.name !== "research_task_status") return [];
	const parsed = outputObject(tool.output);
	const specialists = object(parsed?.specialists);
	const decisions = Array.isArray(specialists?.decisions) ? specialists.decisions : [];
	return decisions.slice(-16).flatMap((entry, index) => {
		const item = object(entry);
		const decision = textField(item?.decision, 40);
		const reason = textField(item?.reasonCode, 240);
		const role = textField(item?.role, 60) || "specialist";
		if (!decision || !reason || !["skip", "wait", "ask-user"].includes(decision)) return [];
		return [
			{
				id: `task-status:${tool.id || tool.key}:${index}`,
				tool: `knowledge-${role}`,
				status: decision === "ask-user" ? "needs-user" : decision === "wait" ? "blocked" : "skipped",
				reason,
			},
		];
	});
}
function diagnosticFrom(tool: UIToolCall): RunInspectorDiagnostic | null {
	const parsed = outputObject(tool.output);
	const status = tool.state === "error" ? "error" : textField(parsed?.status, 60);
	if (
		!status ||
		![
			"error",
			"skipped",
			"failed",
			"blocked",
			"cancelled",
			"timeout",
			"budget-exhausted",
			"needs-user",
			"ambiguous",
			"partial",
			"stale",
		].includes(status)
	)
		return null;
	const error = object(parsed?.error);
	return {
		id: `tool:${tool.id || tool.key}`,
		tool: tool.name,
		status,
		reason:
			textField(parsed?.reasonCode ?? parsed?.reason ?? error?.message ?? parsed?.error) ||
			(tool.state === "error" ? textField(tool.output, 300) : undefined) ||
			status,
		nextAction: textField(parsed?.nextAction),
	};
}

/** Derive only observable data; never interpret private thinking or create evidence. */
export function deriveRunInspectors(messages: readonly UIMessage[]): RunInspectorTurn[] {
	const turns: RunInspectorTurn[] = [];
	let current: RunInspectorTurn | undefined;
	let models = new Map<string, RunInspectorModel>();
	let responseIds = new Set<string>();
	let toolIndexes = new Map<string, number>();
	for (const message of messages) {
		if (message.kind === "user") {
			current = {
				turnIndex: turns.length,
				publicStages: [],
				tools: [],
				models: [],
				subagents: [],
				artifacts: [],
				sourcePaths: [],
				publication: { status: "not-run" },
				retrievals: [],
				diagnostics: [],
				errors: 0,
				...(message.skill ? { skill: message.skill.name } : {}),
			};
			turns.push(current);
			models = new Map();
			responseIds = new Set();
			toolIndexes = new Map();
			continue;
		}
		if (!current) continue;
		if (message.kind === "assistant") {
			if (message.progress) current.publicStages.push({ ...message.progress, id: message.id });
			for (const tool of message.tools) {
				const id = tool.id || tool.key;
				const index = toolIndexes.get(id);
				if (index === undefined) {
					toolIndexes.set(id, current.tools.length);
					current.tools.push(tool);
				} else current.tools[index] = tool;
			}
			if (message.usage) {
				const key = modelKey(message.usage);
				const id = `${key}\0${message.usage.id || message.id}`;
				if (!responseIds.has(id)) {
					responseIds.add(id);
					models.set(key, {
						provider: message.usage.provider,
						model: message.usage.model,
						responses: (models.get(key)?.responses ?? 0) + 1,
					});
					current.models = [...models.values()];
				}
			}
		} else if (message.kind === "subagent") {
			for (const run of message.runs) {
				const index = current.subagents.findIndex((item) => item.key === run.key);
				if (index < 0) current.subagents.push(run);
				else current.subagents[index] = run;
			}
		} else if (message.kind === "image") {
			for (const path of message.paths) if (!current.artifacts.includes(path)) current.artifacts.push(path);
		} else if (message.kind === "error") {
			current.errors++;
			if (current.diagnostics.length < 24)
				current.diagnostics.push({
					id: `error:${message.id}`,
					tool: message.error.source,
					status: "error",
					reason: textField(message.error.detail ?? message.text) || message.error.titleKey,
				});
		}
	}
	for (const turn of turns) {
		for (const tool of turn.tools) {
			for (const path of pathFromRead(tool))
				if (!turn.sourcePaths.includes(path)) turn.sourcePaths.push(path);
			const publication = publicationFrom(tool);
			if (publication) turn.publication = publication;
			const retrieval = retrievalFrom(tool);
			if (retrieval && turn.retrievals.length < 48) turn.retrievals.push(retrieval);
			for (const diagnostic of taskStatusDiagnostics(tool))
				if (turn.diagnostics.length < 24) turn.diagnostics.push(diagnostic);
			const diagnostic = diagnosticFrom(tool);
			if (diagnostic && turn.diagnostics.length < 24) turn.diagnostics.push(diagnostic);
		}
	}
	return turns;
}
