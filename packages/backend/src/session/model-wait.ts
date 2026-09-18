import { type ModelWaitEvent, type SessionEvent, sanitizeProviderError } from "@drone/shared";

export const MODEL_WAIT_WARNING_MS = 60_000;
export const MODEL_WAIT_TIMEOUT_MS = 300_000;

interface Waiting {
	lastActivityAt: number;
	warned: boolean;
	timer: ReturnType<typeof setTimeout>;
}

/** Watches provider silence, before publication hides deltas. Tool/approval/retry time is excluded. */
export class ModelWaitMonitor {
	private readonly sessions = new Map<string, Waiting>();
	constructor(
		private readonly notify: (sessionId: string, event: ModelWaitEvent) => void,
		private readonly abort: (sessionId: string) => Promise<void>,
	) {}

	inspect(sessionId: string, event: SessionEvent): void {
		if (
			event.type === "turn_start" ||
			(event.type === "message_start" && event.message.role === "assistant") ||
			(event.type === "message_update" && this.sessions.has(sessionId))
		) {
			this.cleanup(sessionId);
			const state: Waiting = {
				lastActivityAt: Date.now(),
				warned: false,
				timer: setTimeout(() => this.warn(sessionId, state), MODEL_WAIT_WARNING_MS),
			};
			state.timer.unref?.();
			this.sessions.set(sessionId, state);
		} else if (
			(event.type === "message_end" && event.message.role === "assistant") ||
			event.type === "turn_end" ||
			event.type === "tool_execution_start" ||
			event.type === "compaction_start" ||
			event.type === "auto_retry_start" ||
			event.type === "agent_end" ||
			event.type === "agent_settled"
		)
			this.cleanup(sessionId);
	}

	private warn(sessionId: string, state: Waiting): void {
		if (this.sessions.get(sessionId) !== state) return;
		state.warned = true;
		state.timer = setTimeout(() => {
			if (this.sessions.get(sessionId) !== state) return;
			this.sessions.delete(sessionId);
			this.notify(sessionId, {
				type: "model_wait",
				status: "stopping",
				lastActivityAt: state.lastActivityAt,
				timeoutMs: MODEL_WAIT_TIMEOUT_MS,
			});
			void this.abort(sessionId).then(
				() =>
					this.notify(sessionId, {
						type: "model_wait",
						status: "timed-out",
						lastActivityAt: state.lastActivityAt,
						timeoutMs: MODEL_WAIT_TIMEOUT_MS,
					}),
				(cause: unknown) =>
					this.notify(sessionId, {
						type: "model_wait",
						status: "stop-failed",
						lastActivityAt: state.lastActivityAt,
						timeoutMs: MODEL_WAIT_TIMEOUT_MS,
						errorMessage: sanitizeProviderError(cause instanceof Error ? cause.message : String(cause)),
					}),
			);
		}, MODEL_WAIT_TIMEOUT_MS - MODEL_WAIT_WARNING_MS);
		state.timer.unref?.();
		this.notify(sessionId, {
			type: "model_wait",
			status: "waiting",
			lastActivityAt: state.lastActivityAt,
			timeoutMs: MODEL_WAIT_TIMEOUT_MS,
		});
	}

	cleanup(sessionId: string): void {
		const state = this.sessions.get(sessionId);
		if (!state) return;
		clearTimeout(state.timer);
		this.sessions.delete(sessionId);
		if (state.warned)
			this.notify(sessionId, {
				type: "model_wait",
				status: "resumed",
				lastActivityAt: state.lastActivityAt,
				timeoutMs: MODEL_WAIT_TIMEOUT_MS,
			});
	}

	dispose(): void {
		for (const sessionId of this.sessions.keys()) this.cleanup(sessionId);
	}
}
