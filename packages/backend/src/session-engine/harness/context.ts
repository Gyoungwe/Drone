import {
	checkpointFingerprint,
	decodeTaskView,
	HARNESS_CHECKPOINT_CUSTOM_TYPE,
	HARNESS_CONTRACT,
	type HarnessCheckpoint,
	type HarnessPosture,
	renderHarnessCheckpoint,
	renderHarnessPosture,
} from "@drone/shared";
import { createLogger } from "../../log";
import type { ExtensionContext, InlineExtension } from "../sdk";

const log = createLogger("session-harness");

const DEFAULT_POSTURE: HarnessPosture = {
	effort: "normal",
	delegation: "standard",
	autonomy: "balanced",
	mode: "execute",
};

export interface HarnessContextExtensionOptions {
	report?: (sessionId: string, checkpoint: HarnessCheckpoint) => void;
	getPosture?: (ctx: ExtensionContext) => HarnessPosture;
}

interface RawCustomMessage {
	role?: unknown;
	customType?: unknown;
	content?: unknown;
	details?: unknown;
}

interface RawBranchEntry {
	type?: unknown;
	message?: unknown;
}

type HarnessTask = NonNullable<ReturnType<typeof decodeTaskView>>["tasks"][number];

function customMessages(branch: readonly unknown[]): RawCustomMessage[] {
	return branch.flatMap((entry): RawCustomMessage[] => {
		if (!entry || typeof entry !== "object") return [];
		const candidate = entry as RawBranchEntry;
		if (candidate.type !== "message" || !candidate.message || typeof candidate.message !== "object")
			return [];
		const message = candidate.message as RawCustomMessage;
		return message.role === "custom" && typeof message.customType === "string" ? [message] : [];
	});
}

function latest(messages: readonly RawCustomMessage[], customType: string): RawCustomMessage | undefined {
	return [...messages].reverse().find((message) => message.customType === customType);
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function taskViewFromMessage(message: RawCustomMessage | undefined) {
	if (!message?.details || typeof message.details !== "object") return undefined;
	return decodeTaskView((message.details as { taskView?: unknown }).taskView);
}

function pathValues(task: HarnessTask): string[] {
	const values: string[] = [];
	if (Array.isArray(task.writeRoots))
		values.push(...task.writeRoots.filter((value): value is string => typeof value === "string"));
	for (const milestone of task.milestones) {
		if (typeof milestone.acceptance.path === "string") values.push(milestone.acceptance.path);
	}
	for (const operation of task.operations) {
		if (typeof operation.artifact?.path === "string") values.push(operation.artifact.path);
	}
	for (const action of task.actions) {
		if (typeof action.file?.path === "string") values.push(action.file.path);
	}
	return [...new Set(values)].filter((value) => value.length > 0 && value.length <= 512).slice(0, 8);
}

function deliverableValues(task: HarnessTask): string[] {
	return task.milestones
		.filter((milestone) => milestone.state !== "completed")
		.map((milestone) => {
			const path = typeof milestone.acceptance.path === "string" ? `: ${milestone.acceptance.path}` : "";
			return `${milestone.title}${path}`;
		})
		.slice(0, 8);
}

function sourceSummary(messages: readonly RawCustomMessage[]): string[] {
	const findings: string[] = [];
	for (const customType of ["drone-task-status", "todo-reminder", "drone-subagent-result"] as const) {
		const content = text(latest(messages, customType)?.content);
		if (content) findings.push(`${customType}: ${content}`);
	}
	return findings.slice(0, 8);
}

/** Project existing durable host entries into the bounded model-facing checkpoint. */
export function checkpointFromBranch(
	objective: string,
	epoch: number,
	branch: readonly unknown[],
): HarnessCheckpoint {
	const messages = customMessages(branch);
	const taskMessage = [...messages].reverse().find((message) => !!taskViewFromMessage(message));
	const taskView = taskViewFromMessage(taskMessage);
	const activeTask = taskView?.tasks.find((task) => task.id === taskView.activeTaskId) ?? taskView?.tasks[0];
	const safeObjective = text(objective) ?? activeTask?.goal ?? "Continue the current user request.";
	const findings = sourceSummary(messages);
	if (activeTask?.reason) findings.unshift(`task reason: ${activeTask.reason}`);
	return {
		version: 1,
		epoch: Math.max(0, Math.floor(epoch)),
		objective: safeObjective,
		deliverables: activeTask ? deliverableValues(activeTask) : [],
		findings: findings.slice(0, 8),
		workState: activeTask?.state ?? "in_progress",
		nextMove:
			text(activeTask?.remainingSummary) ??
			"Continue the current request and verify the next observable result.",
		relevantFiles: activeTask ? pathValues(activeTask) : [],
	};
}

function sessionId(ctx: ExtensionContext): string {
	return ctx.sessionManager.getSessionId();
}

export function makeHarnessContextExtension(options: HarnessContextExtensionOptions = {}): InlineExtension {
	return {
		name: "harness-context",
		factory: (pi) => {
			let currentSessionId = "";
			let objective = "";
			let epoch = 0;
			let needsCheckpoint = true;
			let lastFingerprint = "";

			const reset = (ctx: ExtensionContext) => {
				currentSessionId = sessionId(ctx);
				objective = "";
				epoch = 0;
				needsCheckpoint = true;
				lastFingerprint = "";
			};

			pi.on("session_start", (_event, ctx) => {
				try {
					reset(ctx);
				} catch (error) {
					log.warn("harness session_start failed", { error: String(error) });
				}
			});

			pi.on("before_agent_start", async (event, ctx) => {
				try {
					currentSessionId = sessionId(ctx);
					const prompt = text(event.prompt);
					if (prompt && prompt !== objective) {
						objective = prompt;
						needsCheckpoint = true;
					}
					const posture = options.getPosture?.(ctx) ?? DEFAULT_POSTURE;
					return {
						systemPrompt: [event.systemPrompt, HARNESS_CONTRACT, renderHarnessPosture(posture)]
							.filter(Boolean)
							.join("\n\n"),
					};
				} catch (error) {
					log.warn("harness before_agent_start failed", { error: String(error) });
					return undefined;
				}
			});

			pi.on("session_compact", (_event, ctx) => {
				try {
					currentSessionId = sessionId(ctx);
					epoch += 1;
					needsCheckpoint = true;
				} catch (error) {
					log.warn("harness session_compact failed", { error: String(error) });
				}
			});

			pi.on("context", async (event, ctx) => {
				try {
					currentSessionId = sessionId(ctx);
					const checkpoint = checkpointFromBranch(objective, epoch, ctx.sessionManager.getBranch());
					const fingerprint = checkpointFingerprint(checkpoint);
					if (!needsCheckpoint && fingerprint === lastFingerprint) return undefined;
					lastFingerprint = fingerprint;
					needsCheckpoint = false;
					const message = {
						role: "custom" as const,
						customType: HARNESS_CHECKPOINT_CUSTOM_TYPE,
						display: false,
						content: renderHarnessCheckpoint(checkpoint),
						details: { version: 1, epoch: checkpoint.epoch, fingerprint },
						timestamp: Date.now(),
					};
					try {
						options.report?.(currentSessionId, checkpoint);
					} catch (error) {
						log.warn("harness checkpoint report failed", { error: String(error) });
					}
					return { messages: [...event.messages, message] };
				} catch (error) {
					log.warn("harness context projection failed", { error: String(error) });
					return undefined;
				}
			});
		},
	};
}
