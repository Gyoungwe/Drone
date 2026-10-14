import { deriveRunState, planBarLabel, type RunState, stepGroupHeader, thinkingLabel } from "@drone/shared";
import { useEffect, useRef, useState } from "react";
import { useI18nStore } from "../../i18n";
import { runSnapshotOf } from "../../lib/run-snapshot";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";

/** 输入框上方的运行状态条（P14）：准备工作区 / 思考计时 / 计划条 / 步骤计数 / 等待输入。 */
export function RunStatusView({
	state,
	planLabel,
	runningSteps,
	thinking,
	zh,
}: {
	state: RunState;
	planLabel: string | null;
	runningSteps: number;
	thinking: { live: string | null; frozen: string | null };
	zh: boolean;
}) {
	let main: string | null = null;
	let shimmer = false;
	if (state === "HostInit") {
		main = zh ? "准备工作区…" : "Preparing workspace…";
		shimmer = true;
	} else if (state === "Thinking" && thinking.live) {
		main = thinking.live;
		shimmer = true;
	} else if (state === "AwaitingInput") main = zh ? "等待输入" : "Waiting for input";
	else if (state === "Running") main = stepGroupHeader(runningSteps, true, zh);
	if (!main && !planLabel && !thinking.frozen) return null;
	return (
		<div
			className={`run-status run-status--${state.toLowerCase()}`}
			data-testid="run-status"
			data-state={state}
		>
			<span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
				{state === "Thinking" ? (zh ? "思考中" : "Thinking") : main} {planLabel}
			</span>
			{main && <span className={shimmer ? "shimmer" : "run-status-main"}>{main}</span>}
			{thinking.frozen && state !== "Thinking" && <span className="run-status-tag">{thinking.frozen}</span>}
			{planLabel && <span className="run-status-plan">{planLabel}</span>}
		</div>
	);
}

export function RunStatusStrip({
	sessionId,
	pendingAsks,
}: {
	sessionId: string | null;
	pendingAsks: number;
}) {
	const entry = useTranscriptStore((s) => selectTranscript(s, sessionId));
	const zh = useI18nStore((s) => s.language) === "zh";
	const state = deriveRunState(runSnapshotOf(entry, pendingAsks));
	const thinkStart = useRef<number | null>(null);
	const [frozen, setFrozen] = useState<string | null>(null);
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (state === "Thinking") {
			if (thinkStart.current == null) {
				thinkStart.current = Date.now();
				setFrozen(null);
			}
			const id = setInterval(() => setNow(Date.now()), 1000);
			return () => clearInterval(id);
		}
		if (thinkStart.current != null) {
			setFrozen(thinkingLabel(thinkStart.current, Date.now(), Date.now(), zh));
			thinkStart.current = null;
		}
		return undefined;
	}, [state, zh]);
	useEffect(() => {
		if (!entry.agentActive) setFrozen(null);
	}, [entry.agentActive]);
	if (!sessionId || (!entry.agentActive && state !== "AwaitingInput")) return null;
	return (
		<RunStatusView
			state={state}
			planLabel={planBarLabel(entry.todos, zh)}
			runningSteps={entry.streaming?.tools.filter((t) => t.state === "running").length ?? 0}
			thinking={{
				live: thinkStart.current != null ? thinkingLabel(thinkStart.current, null, now, zh) : null,
				frozen,
			}}
			zh={zh}
		/>
	);
}
