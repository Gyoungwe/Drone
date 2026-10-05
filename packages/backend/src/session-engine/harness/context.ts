import {
	checkpointFingerprint,
	contractFingerprint,
	HARNESS_CHECKPOINT_CUSTOM_TYPE,
	HARNESS_STATUS_CUSTOM_TYPE,
	type HarnessCheckpoint,
	type HarnessContractFingerprint,
	type HarnessPosture,
	type HarnessSourceRef,
	type HarnessUnit,
	renderHarnessCheckpoint,
	renderHarnessPromptLayer,
	resolveHarnessModelFamily,
} from "@drone/shared";
import { createLogger } from "../../log";
import type { ExtensionContext, InlineExtension } from "../sdk";
import {
	boundedText,
	contentText,
	customRecords,
	type HarnessCustomRecord,
	latestUserObjective,
	record,
	taskViewFromBranch,
} from "./branch";
import { assessTaskDelivery, renderDeliveryStatus } from "./delivery";

const log = createLogger("session-harness");
const DEFAULT_POSTURE: HarnessPosture = {
	effort: "normal",
	delegation: "standard",
	autonomy: "balanced",
	mode: "execute",
};
export interface HarnessContextExtensionOptions {
	report?: (sessionId: string, checkpoint: HarnessCheckpoint) => void;
	reportStatus?: (sessionId: string, status: HarnessContractFingerprint) => void;
	getPosture?: (ctx: ExtensionContext) => HarnessPosture;
	getSkills?: (ctx: ExtensionContext) => readonly string[];
	familyPrompt?: boolean;
	recordUnit?: (sessionId: string, unit: HarnessUnit, action: string, details?: { family?: string }) => void;
}
type HarnessTask = import("@drone/shared").WorkbenchTask;
function pathValues(task: HarnessTask): string[] {
	const paths = [
		...(task.writeRoots ?? []),
		...task.milestones.map((milestone) => milestone.acceptance.path),
		...task.operations.map((operation) => operation.artifact?.path),
		...task.actions.map((action) => action.file?.path),
	];
	return [...new Set(paths)]
		.filter((path): path is string => typeof path === "string" && path.length > 0 && path.length <= 512)
		.slice(0, 8);
}
function sourceRef(message: HarnessCustomRecord, kind: HarnessSourceRef["kind"]): HarnessSourceRef {
	return {
		kind,
		id: boundedText(message.id, 120),
		label: message.customType,
		timestamp: boundedText(message.timestamp, 80),
	};
}
/** Existing durable records are facts; this projection is navigation, never evidence. */
export function checkpointFromBranch(
	objective: string,
	epoch: number,
	branch: readonly unknown[],
): HarnessCheckpoint {
	const messages = customRecords(branch);
	const view = taskViewFromBranch(branch);
	const task = view?.tasks.find((task) => task.id === view.activeTaskId);
	const findings: string[] = [];
	const sources: HarnessSourceRef[] = [];
	for (const [customType, kind] of [
		["drone-task-status", "task"],
		["todo-reminder", "todo"],
		["drone-subagent-result", "subagent"],
	] as const) {
		const message = [...messages].reverse().find((message) => message.customType === customType);
		if (!message) continue;
		const content = contentText(message.content);
		if (content) findings.push(`${customType}: ${content}`);
		sources.push(sourceRef(message, kind));
	}
	for (const value of [...branch].reverse()) {
		const entry = record(value);
		if (entry?.type === "compaction" || entry?.type === "branch_summary") {
			sources.push({
				kind: "compaction",
				id: boundedText(entry.id, 120),
				label: String(entry.type),
				timestamp: boundedText(entry.timestamp, 80),
			});
			break;
		}
	}
	if (task?.reason) findings.unshift(`task reason: ${task.reason}`);
	if (view && task) findings.push(renderDeliveryStatus(assessTaskDelivery(view)));
	return {
		version: 1,
		epoch: Math.max(0, Math.floor(epoch)),
		objective:
			boundedText(objective) ??
			task?.goal ??
			latestUserObjective(branch) ??
			"Continue the current user request.",
		deliverables:
			task?.milestones
				.filter((milestone) => milestone.state !== "completed")
				.map(
					(milestone) =>
						`${milestone.title}${milestone.acceptance.path ? `: ${milestone.acceptance.path}` : ""}`,
				)
				.slice(0, 8) ?? [],
		findings: findings.slice(0, 8),
		workState: task?.state ?? "in_progress",
		nextMove:
			boundedText(task?.remainingSummary) ??
			"Continue the current request and verify the next observable result.",
		relevantFiles: task ? pathValues(task) : [],
		sources,
	};
}
export function makeHarnessContextExtension(options: HarnessContextExtensionOptions = {}): InlineExtension {
	return {
		name: "harness-context",
		factory: (pi) => {
			let objective = "",
				epoch = 0,
				needsCheckpoint = true,
				lastCheckpoint = "",
				lastContract = "";
			let cachedMessage:
				| {
						role: "custom";
						customType: string;
						display: boolean;
						content: string;
						details: unknown;
						timestamp: number;
				  }
				| undefined;
			let activeSessionId = "";
			let shutDown = false;
			const sessionId = (ctx: ExtensionContext): string | undefined => {
				try {
					const id = ctx.sessionManager.getSessionId();
					if (!activeSessionId && !shutDown) activeSessionId = id;
					return id === activeSessionId ? id : undefined;
				} catch {
					return undefined;
				}
			};
			const reset = (ctx: ExtensionContext) => {
				shutDown = false;
				activeSessionId = ctx.sessionManager.getSessionId();
				const branch = ctx.sessionManager.getBranch();
				objective = latestUserObjective(branch) ?? "";
				epoch = branch.filter((entry) => entry.type === "compaction").length;
				needsCheckpoint = true;
				lastCheckpoint = "";
				cachedMessage = undefined;
				const saved = customRecords(branch)
					.reverse()
					.find((entry) => entry.customType === HARNESS_STATUS_CUSTOM_TYPE);
				lastContract =
					boundedText((saved?.data as { fingerprint?: unknown } | undefined)?.fingerprint, 64) ?? "";
			};
			pi.on("session_start", (_event, ctx) => {
				try {
					reset(ctx);
				} catch (error) {
					log.warn("harness restore failed", { error: String(error) });
				}
			});
			pi.on("session_tree", (_event, ctx) => {
				try {
					reset(ctx);
				} catch (error) {
					log.warn("harness tree restore failed", { error: String(error) });
				}
			});
			pi.on("session_shutdown", () => {
				shutDown = true;
				activeSessionId = "";
				cachedMessage = undefined;
				needsCheckpoint = true;
			});
			pi.on("before_agent_start", (event, ctx) => {
				if (!sessionId(ctx)) return;
				try {
					const prompt = boundedText(event.prompt);
					if (prompt && prompt !== objective) {
						objective = prompt;
						needsCheckpoint = true;
					}
					const posture = options.getPosture?.(ctx) ?? DEFAULT_POSTURE;
					const skills = options.getSkills?.(ctx) ?? [];
					const family =
						options.familyPrompt === false
							? null
							: resolveHarnessModelFamily(ctx.model?.provider, ctx.model?.id);
					const systemPrompt = [
						event.systemPrompt,
						renderHarnessPromptLayer(family, posture, undefined, skills),
					]
						.filter(Boolean)
						.join("\n\n");
					// Persist hashes and names, never the complete prompt or tool schemas.
					const contract: HarnessContractFingerprint = {
						version: 1,
						provider: ctx.model?.provider ?? "unknown",
						model: ctx.model?.id ?? "unknown",
						system: contractFingerprint({
							version: 1,
							provider: "",
							model: "",
							system: systemPrompt,
							tools: [],
							capabilities: [],
							skills: [],
						}),
						tools: (pi.getAllTools?.() ?? [])
							.map(
								(tool) =>
									`${tool.name}:${contractFingerprint({ version: 1, provider: "", model: "", system: JSON.stringify({ description: tool.description, parameters: tool.parameters, exposure: tool.exposure }), tools: [], capabilities: [], skills: [] })}`,
							)
							.sort(),
						capabilities: (pi.getCommands?.() ?? []).map((command) => command.name).sort(),
						skills: [...skills].sort(),
						fingerprint: "",
					};
					contract.fingerprint = contractFingerprint(contract);
					if (contract.fingerprint !== lastContract) {
						lastContract = contract.fingerprint;
						try {
							options.reportStatus?.(sessionId(ctx) ?? "", contract);
							pi.appendEntry?.(HARNESS_STATUS_CUSTOM_TYPE, contract);
						} catch (error) {
							log.warn("harness contract report failed", { error: String(error) });
						}
					}
					if (family) {
						options.recordUnit?.(sessionId(ctx) ?? "", "familyPrompt", "inject", { family });
					}
					return { systemPrompt };
				} catch (error) {
					log.warn("harness prompt failed", { error: String(error) });
					return undefined;
				}
			});
			pi.on("session_compact", () => {
				epoch += 1;
				needsCheckpoint = true;
			});
			pi.on("context", (event, ctx) => {
				const id = sessionId(ctx);
				if (!id) return undefined;
				try {
					const checkpoint = checkpointFromBranch(objective, epoch, ctx.sessionManager.getBranch());
					const fingerprint = checkpointFingerprint(checkpoint);
					if (!needsCheckpoint && fingerprint === lastCheckpoint && cachedMessage) {
						return event.messages.some(
							(message) =>
								message.role === "custom" &&
								message.customType === HARNESS_CHECKPOINT_CUSTOM_TYPE &&
								(message.details as { fingerprint?: string } | undefined)?.fingerprint === fingerprint,
						)
							? undefined
							: { messages: [...event.messages, cachedMessage] };
					}
					lastCheckpoint = fingerprint;
					needsCheckpoint = false;
					const message = {
						role: "custom" as const,
						customType: HARNESS_CHECKPOINT_CUSTOM_TYPE,
						display: false,
						content: renderHarnessCheckpoint(checkpoint),
						details: { version: 1, epoch, fingerprint, sources: checkpoint.sources },
						timestamp: Date.now(),
					};
					cachedMessage = message;
					try {
						options.report?.(id, checkpoint);
						options.recordUnit?.(id, "context", "checkpoint");
					} catch (error) {
						log.warn("harness checkpoint report failed", { error: String(error) });
					}
					return { messages: [...event.messages, message] };
				} catch (error) {
					log.warn("harness projection failed", { error: String(error) });
					return undefined;
				}
			});
		},
	};
}
