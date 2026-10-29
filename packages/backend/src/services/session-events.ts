import type { DroneRuntime, SessionEvent } from "@drone/shared";
import { sanitizeProviderError } from "@drone/shared";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { CapabilityRuntime } from "../capabilities/runtime";
import { slimBulkyEvent, slimMessageUpdate } from "../session/event-slim";
import type { ModelWaitMonitor } from "../session/model-wait";
import type { EventRateTracker } from "../session/rates";
import type { StreamGuard } from "../session/stream-guard";
import type { SessionTraces } from "../session/traces";
import { createEventPipeline, type Stage } from "../session-engine/event-pipeline";
import { globalToolManifest } from "../tools/manifest";
import type { SubagentPanelService } from "../tools/subagent";
import type { ApprovalService } from "./approvals";

type EventHandler = (sessionId: string, event: SessionEvent) => void;

export interface SessionEventServiceDeps {
	runtime: DroneRuntime;
	projectDelivery?: (sessionId: string, event: SessionEvent) => SessionEvent | null;
	streamGuard: StreamGuard;
	eventRates: EventRateTracker;
	modelWait: ModelWaitMonitor;
	traces: SessionTraces;
	approvals: ApprovalService;
	capabilityRuntimes: Map<string, CapabilityRuntime>;
	subagentPanel: SubagentPanelService;
	hasSession: (sessionId: string) => boolean;
	abort: (sessionId: string) => Promise<void>;
	log: {
		info: (message: string, ...args: unknown[]) => void;
		error: (message: string, ...args: unknown[]) => void;
	};
}

/** Owns the event publication pipeline and its cleanup-sensitive state. */
export class SessionEventService {
	private readonly handlers = new Set<EventHandler>();

	constructor(private readonly deps: SessionEventServiceDeps) {}

	emit(sessionId: string, input: SessionEvent): void {
		// Activity is host metadata; hidden provider deltas must still prevent a false silence timeout.
		this.deps.modelWait.inspect(sessionId, input);
		const projected = this.deps.projectDelivery ? this.deps.projectDelivery(sessionId, input) : input;
		if (!projected) return;
		let event = projected;
		this.deps.runtime.knowledge.reviewer?.observe?.(sessionId, event);
		if (event.type === "auto_retry_start")
			event = {
				...event,
				errorMessage: sanitizeProviderError(event.errorMessage || ""),
			};
		this.deps.eventRates.tick(sessionId);
		if (event.type === "session_info_changed")
			this.deps.log.info("session renamed", sessionId, { name: event.name });
		if (event.type === "message_update") event = slimMessageUpdate(event);
		if (event.type === "tool_execution_start" && !event.hostActivity) {
			const activity = (this.deps.capabilityRuntimes.get(sessionId)?.tools ?? globalToolManifest).activity(
				event.toolName,
				event.args,
			);
			if (activity)
				event = {
					...event,
					hostActivity: { text: activity.text, phase: activity.phase },
				};
		}
		event = slimBulkyEvent(event);
		const stages: Stage<SessionEvent, string>[] = [
			{
				name: "stream-guard",
				failMode: "closed",
				run: (current, sid) => {
					const verdict = this.deps.streamGuard.inspect(sid, current);
					if (current.type === "agent_end") this.deps.approvals.getGate(sid)?.endRun();
					if (verdict === "pass") return current;
					if (verdict !== "suppress") {
						this.deps.log.error("stream guard tripped, aborting session", sid, {
							verdict,
						});
						void this.deps.abort(sid).catch(() => {});
						for (const handler of this.handlers) {
							try {
								handler(sid, { type: "stream_guard_tripped", verdict });
							} catch {
								/* isolated */
							}
						}
					}
					return null;
				},
			},
			{
				name: "trace",
				failMode: "open",
				run: (current, sid) => {
					if (
						![
							"subagent_mutex",
							"stream_guard_tripped",
							"model_wait",
							"subagent_run",
							"reviewer_finding",
							"extension_notification",
							"extension_status",
						].includes(current.type)
					)
						this.deps.traces.record(sid, current as AgentSessionEvent);
					return current;
				},
			},
			{
				name: "fanout",
				failMode: "open",
				run: (current, sid) => {
					this.deps.subagentPanel.observe(sid, current);
					for (const handler of this.handlers) {
						try {
							handler(sid, current);
						} catch {
							/* isolated */
						}
					}
					return current;
				},
			},
		];
		createEventPipeline(stages, {
			onError: ({ stage, error }) =>
				this.deps.log.error("event pipeline stage failed", sessionId, {
					stage: stage.name,
					error,
				}),
		}).run(event, sessionId);
	}

	onEvent(handler: EventHandler): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}
	clear(): void {
		this.handlers.clear();
	}
}

export type { EventHandler };
