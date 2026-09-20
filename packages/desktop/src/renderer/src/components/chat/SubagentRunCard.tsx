import { useEffect, useState } from "react";
import { getPi } from "../../api";
import { type MessageKey, useT } from "../../i18n";
import type { SubagentRunUi } from "../../stores/transcript";
import { ChevronDownIcon } from "../icons";
import { InlineSubagentTranscript } from "./InlineSubagentTranscript";
import { SubagentAvatar } from "./SubagentAvatar";
import { SubagentResultCard } from "./SubagentResultCard";
import { avatarStateForPanelStatus, avatarStateForRunUi } from "./subagent-avatar";

/** 面板运行状态胶囊文案（模型调用的运行沿用 running / done / failed 三态） */
const PANEL_STATUS_KEYS: Record<NonNullable<SubagentRunUi["panel"]>["status"], MessageKey> = {
	queued: "message.subagent.queued",
	running: "message.subagent.running",
	needs_reply: "message.subagent.running",
	waiting_approval: "message.subagent.running",
	done: "message.subagent.done",
	error: "message.subagent.failed",
	aborted: "message.subagent.aborted",
};

function displayName(name: string): string {
	return name.charAt(0).toUpperCase() + name.slice(1);
}

function formatTokens(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
	return String(value);
}

const PHASE_KEYS = {
	planning: "message.subagent.phase.planning",
	"literature-search": "message.subagent.phase.literature-search",
	"knowledge-search": "message.subagent.phase.knowledge-search",
	"web-search": "message.subagent.phase.web-search",
	reading: "message.subagent.phase.reading",
	verification: "message.subagent.phase.verification",
	synthesis: "message.subagent.phase.synthesis",
	deposit: "message.subagent.phase.deposit",
	archive: "message.subagent.phase.archive",
	"skill-evolution": "message.subagent.phase.skill-evolution",
	other: "message.subagent.phase.other",
} as const;

function phaseLabel(t: ReturnType<typeof useT>, phase?: string): string | null {
	if (!phase) return null;
	const key = PHASE_KEYS[phase as keyof typeof PHASE_KEYS];
	return key ? t(key) : phase;
}

function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	if (minutes < 60) return `${minutes}m ${rest}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}

function supervisorReasonLabel(t: ReturnType<typeof useT>, reason: string): string {
	if (reason === "need_decision") return t("message.subagent.needDecision");
	if (reason === "interview_request") return t("message.subagent.interviewRequest");
	return t("message.subagent.progressUpdate");
}

function SubagentRunRow({ run }: { run: SubagentRunUi }) {
	const t = useT();
	const [expanded, setExpanded] = useState(false);
	const [guide, setGuide] = useState("");
	const [reply, setReply] = useState("");
	const [sending, setSending] = useState(false);
	const [controlError, setControlError] = useState<string | null>(null);
	const [now, setNow] = useState(Date.now());
	const panel = run.panel;
	const expandable = run.sessionFile != null;
	const canControl = run.status === "running" && run.sessionId != null;
	const request = run.supervisorRequest ?? null;
	const stateLabel = panel
		? t(PANEL_STATUS_KEYS[panel.status])
		: run.status === "running"
			? t("message.subagent.running")
			: run.status === "error"
				? t("message.subagent.failed")
				: t("message.subagent.done");
	const phase = phaseLabel(t, run.statusPhase);
	const current =
		panel?.status === "queued"
			? t("message.subagent.queuedReason", { n: panel.queuePosition ?? 1 })
			: panel?.status === "waiting_approval"
				? `${run.currentAction ?? run.statusText ?? ""}${run.currentAction || run.statusText ? " · " : ""}${t("message.subagent.waitingApproval")}`
				: (run.currentAction ?? run.statusText ?? stateLabel);
	const avatarState = panel
		? avatarStateForPanelStatus(panel.status)
		: avatarStateForRunUi(run.status, { expectsReply: request?.expectsReply === true });

	useEffect(() => {
		if (run.status !== "running" || !run.startedAt) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [run.status, run.startedAt]);

	const sendGuide = async () => {
		if (!run.sessionId || !guide.trim()) return;
		setSending(true);
		setControlError(null);
		try {
			await getPi().steerSubagent(run.sessionId, guide.trim(), "steer");
			setGuide("");
		} catch (error) {
			setControlError(error instanceof Error ? error.message : String(error));
		} finally {
			setSending(false);
		}
	};

	// 面板派发且已完成：同一张卡换成结果卡（摘要 / 引用 / 展开记录 / followUp 状态）
	if (panel && panel.status === "done") return <SubagentResultCard run={run} panel={panel} />;

	const sendReply = async () => {
		if (!run.sessionId || !request?.expectsReply || !reply.trim()) return;
		setSending(true);
		setControlError(null);
		try {
			await getPi().replySubagentSupervisor(run.sessionId, request.id, reply.trim());
			setReply("");
		} catch (error) {
			setControlError(error instanceof Error ? error.message : String(error));
		} finally {
			setSending(false);
		}
	};

	const aborted = panel?.status === "aborted";
	const failed = panel ? panel.status === "error" : run.status === "error";
	return (
		<div
			className={`overflow-hidden rounded-xl border border-border/70 bg-surface/40${aborted ? " sa-run-aborted" : ""}`}
			data-testid="subagent-run-row"
			data-panel-status={panel?.status}
		>
			<button
				type="button"
				disabled={!expandable}
				onClick={() => expandable && setExpanded((value) => !value)}
				aria-expanded={expanded}
				title={
					expandable ? (expanded ? t("message.subagent.collapse") : t("message.subagent.expand")) : undefined
				}
				className={`w-full px-3 py-2.5 text-left transition-colors ${expandable ? "cursor-pointer hover:bg-hover" : "cursor-default"}`}
			>
				<div className="flex min-w-0 items-center gap-2">
					<SubagentAvatar name={run.agent} source={panel?.source} size="lg" state={avatarState} />
					{run.status === "running" && !aborted ? (
						<span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
					) : failed ? (
						<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
					) : aborted ? (
						<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-faint" />
					) : (
						<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
					)}
					<span className="truncate text-[13px] font-semibold text-ink">{displayName(run.agent)}</span>
					<span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-faint">
						{stateLabel}
					</span>
					{phase && (
						<span className="shrink-0 rounded-full border border-border/60 px-1.5 py-0.5 text-[11px] text-ink-dim">
							{phase}
						</span>
					)}
					{panel?.status === "waiting_approval" && (
						<span className="shrink-0 rounded-full bg-warn/10 px-1.5 py-0.5 text-[11px] font-medium text-warn">
							{t("message.subagent.waitingApproval")}
						</span>
					)}
					{request?.expectsReply && (
						<span className="shrink-0 rounded-full bg-warn/10 px-1.5 py-0.5 text-[11px] font-medium text-warn">
							{t("message.subagent.replyNeeded")}
						</span>
					)}
					{expandable && (
						<ChevronDownIcon
							className={`ml-auto shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
						/>
					)}
				</div>

				<div className="mt-2 grid gap-1.5 text-[11px]">
					{run.task && (
						<div className="flex min-w-0 gap-2">
							<span className="shrink-0 text-ink-faint">{t("message.subagent.goal")}</span>
							<span className="truncate text-ink-2" title={run.task}>
								{run.task}
							</span>
						</div>
					)}
					{!(panel && (panel.status === "error" || panel.status === "aborted")) && (
						<div className="flex min-w-0 gap-2">
							<span className="shrink-0 text-ink-faint">{t("message.subagent.current")}</span>
							<span className="truncate font-medium text-ink-2" title={current}>
								{current}
							</span>
						</div>
					)}
					{run.currentTool && (
						<div className="flex min-w-0 gap-2">
							<span className="shrink-0 text-ink-faint">{t("message.subagent.tool")}</span>
							<span className="truncate font-mono text-[11px] text-ink-dim">{run.currentTool}</span>
						</div>
					)}
					{panel?.status === "error" && panel.error && (
						<div className="flex min-w-0 gap-2">
							<span className="shrink-0 text-ink-faint">{t("message.subagent.error")}</span>
							<span className="break-words text-err">{panel.error}</span>
						</div>
					)}
				</div>

				<div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-ink-faint">
					{run.model && <span className="min-w-0 truncate font-mono">{run.model}</span>}
					{run.tokens != null && run.tokens > 0 && (
						<span className="shrink-0">{t("message.subagent.tokens", { n: formatTokens(run.tokens) })}</span>
					)}
					{run.startedAt != null && (
						<span className="shrink-0">
							{t("message.subagent.runtime", { n: formatDuration(now - run.startedAt) })}
						</span>
					)}
					{expandable && (
						<span className="ml-auto shrink-0">
							{expanded ? t("message.subagent.collapse") : t("message.subagent.expand")}
						</span>
					)}
				</div>
			</button>

			{request && (
				<div
					className={`mx-3 mb-2 rounded-lg border px-2.5 py-2 text-[11px] ${request.expectsReply ? "border-warn/30 bg-warn/5" : "border-border/60 bg-surface-2/40"}`}
				>
					<div className="font-medium text-ink-2">{supervisorReasonLabel(t, request.reason)}</div>
					<div className="mt-1 whitespace-pre-wrap text-ink-dim">{request.message}</div>
					{request.expectsReply && canControl && (
						<div className="mt-2 flex gap-1.5">
							<input
								value={reply}
								onChange={(e) => setReply(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) void sendReply();
								}}
								placeholder={t("message.subagent.replyPlaceholder")}
								className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-[11px] text-ink outline-none focus:border-accent"
							/>
							<button
								type="button"
								disabled={sending || !reply.trim()}
								onClick={() => void sendReply()}
								className="rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
							>
								{t("message.subagent.reply")}
							</button>
						</div>
					)}
				</div>
			)}

			{canControl && (
				<div className="mx-3 mb-2 flex gap-1.5">
					<input
						value={guide}
						onChange={(e) => setGuide(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) void sendGuide();
						}}
						placeholder={t("message.subagent.guidePlaceholder")}
						className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-[11px] text-ink outline-none focus:border-accent"
					/>
					<button
						type="button"
						disabled={sending || !guide.trim()}
						onClick={() => void sendGuide()}
						className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[11px] font-medium text-ink-2 hover:bg-hover disabled:opacity-40"
					>
						{t("message.subagent.send")}
					</button>
				</div>
			)}
			{controlError && <div className="mx-3 mb-2 text-[11px] text-err">{controlError}</div>}
			{expanded && expandable && <InlineSubagentTranscript run={run} />}
		</div>
	);
}

function formatClock(ts: number): string {
	const d = new Date(ts);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function SubagentRunCard({ runs }: { runs: SubagentRunUi[] }) {
	const t = useT();
	const dispatched = runs.filter((run) => run.panel);
	const first = dispatched[0]?.panel;
	return (
		<div className="mt-1 space-y-1.5">
			{first ? (
				// 面板派发的系统条目：解释「这个子智能体是谁派发的」（custom entry 持久化，模型不可见）
				<div
					className="flex items-center gap-1.5 border-l-2 border-border px-2 text-[11px] text-ink-dim"
					data-testid="subagent-dispatch-line"
				>
					<SubagentAvatar name={first.agent} source={first.source} size="sm" state="idle" />
					<span className="truncate">
						{t("message.subagent.panelDispatched", {
							agents: [...new Set(dispatched.map((run) => run.agent))].join(", "),
							n: dispatched.length,
						})}
						{` · ${formatClock(first.createdAt)}`}
					</span>
				</div>
			) : (
				runs.length > 1 && (
					<div className="px-1 text-[11px] font-medium text-ink-faint">
						{t("message.summarySubagents", { n: runs.length })}
					</div>
				)
			)}
			{runs.map((run) => (
				<SubagentRunRow key={run.key} run={run} />
			))}
		</div>
	);
}
