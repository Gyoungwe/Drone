import {
	isSubagentRunSettled,
	SUBAGENT_PANEL_MAX_TASKS,
	type SubagentPanelAgent,
	type SubagentPanelRun,
	type SubagentPanelSnapshot,
	workflowStage,
} from "@drone/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPi } from "../../api";
import { type MessageKey, useI18nStore, useT } from "../../i18n";
import { COMPOSER_FOCUS_EVENT, useDraftStore } from "../../stores/drafts";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { APPROVAL_FOCUS_EVENT, summarizeRuns, useSubagentsStore } from "../../stores/subagents";
import { useTranscriptStore } from "../../stores/transcript";
import { InlineSubagentTranscript } from "../chat/InlineSubagentTranscript";
import { SubagentAvatar } from "../chat/SubagentAvatar";
import { avatarStateForPanelStatus } from "../chat/subagent-avatar";
import { ChevronDownIcon } from "../icons";
import { Button } from "../ui/Button";
import {
	buildDispatchInput,
	canAddTask,
	citeRunText,
	type DispatchFormDraft,
	type DispatchTaskError,
	dispatchSlotPlan,
	emptyDispatchForm,
	formNeedsProjectTrust,
	newTaskDraft,
	promptDispatchText,
	stageOptions,
	validateDispatchForm,
} from "./subagents-form";

const SELECT_CLASS =
	"min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-50";
const INPUT_CLASS =
	"min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-accent";

function formatTokens(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
	return String(value);
}

function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	if (minutes < 60) return `${minutes}m ${rest}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatClock(ts: number): string {
	const d = new Date(ts);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const STATUS_KEYS: Record<SubagentPanelRun["status"], MessageKey> = {
	queued: "panel.subagents.status.queued",
	running: "panel.subagents.status.running",
	needs_reply: "panel.subagents.status.needs_reply",
	waiting_approval: "panel.subagents.status.waiting_approval",
	done: "panel.subagents.status.done",
	error: "panel.subagents.status.error",
	aborted: "panel.subagents.status.aborted",
};

const SOURCE_KEYS: Record<SubagentPanelAgent["source"], MessageKey> = {
	builtin: "panel.subagents.source.builtin",
	user: "panel.subagents.source.user",
	project: "panel.subagents.source.project",
};

/** 把文本追加进当前会话草稿并聚焦输入框（引用 / 插入到输入框共用；不自动发送） */
function appendToComposer(sessionId: string, text: string): void {
	useDraftStore.getState().updateDraft(sessionId, (entry) => ({
		...entry,
		text: entry.text ? `${entry.text.replace(/\s+$/, "")}\n\n${text}\n` : `${text}\n`,
	}));
	window.dispatchEvent(new Event(COMPOSER_FOCUS_EVENT));
}

/**
 * 「子智能体」页签：可用列表 → 派发表单 → 本会话运行。派发走后端 dispatchSubagents（与模型自己调用
 * subagent 工具同一条运行时路径），面板只做校验、登记展示与操作；审批仍在输入框位置的审批坞决策。
 */
export function SubagentsPane({ sessionId }: { sessionId: string | null }) {
	const t = useT();
	const session = useSessionsStore((s) => s.sessions.find((x) => x.sessionId === sessionId));
	const entry = useSubagentsStore((s) => (sessionId ? s.agentsBySession[sessionId] : undefined));
	const loadAgents = useSubagentsStore((s) => s.loadAgents);
	const hydrateRuns = useSubagentsStore((s) => s.hydrateRuns);
	const runsRecord = useSubagentsStore((s) => (sessionId ? s.runsBySession[sessionId] : undefined));
	const runs = useMemo(
		() => (runsRecord ? Object.values(runsRecord).sort((a, b) => b.createdAt - a.createdAt) : []),
		[runsRecord],
	);
	const summary = useMemo(() => summarizeRuns(runs), [runs]);

	const readOnly = session?.readOnly === true;
	const known = session !== undefined;
	useEffect(() => {
		if (!sessionId || !known || readOnly) return;
		void loadAgents(sessionId);
		void hydrateRuns(sessionId);
	}, [sessionId, known, readOnly, loadAgents, hydrateRuns]);

	if (!sessionId || !session) {
		return (
			<div className="context-pane">
				<p className="panel-empty" data-testid="subagents-empty-session">
					{t("panel.subagents.noSession")}
				</p>
			</div>
		);
	}
	if (session.readOnly) {
		return (
			<div className="context-pane">
				<p className="panel-empty">{t("panel.subagents.readOnly")}</p>
			</div>
		);
	}
	const snapshot = entry?.snapshot ?? null;
	return (
		<div className="context-pane" data-testid="subagents-pane">
			<AvailableSection
				sessionId={sessionId}
				snapshot={snapshot}
				loading={entry?.loading === true}
				error={entry?.error ?? null}
			/>
			{snapshot && snapshot.agents.length > 0 && (
				<DispatchSection sessionId={sessionId} snapshot={snapshot} active={summary.active + summary.queued} />
			)}
			<RunsSection sessionId={sessionId} runs={runs} snapshot={snapshot} />
		</div>
	);
}

/* ───────────────────────────── 可用列表 ───────────────────────────── */

function AvailableSection({
	sessionId,
	snapshot,
	loading,
	error,
}: {
	sessionId: string;
	snapshot: SubagentPanelSnapshot | null;
	loading: boolean;
	error: string | null;
}) {
	const t = useT();
	const loadAgents = useSubagentsStore((s) => s.loadAgents);
	const setDraftAgent = useSubagentsStore((s) => s.setDraftAgent);
	const [expanded, setExpanded] = useState<string | null>(null);
	const agents = snapshot?.agents ?? [];
	const untrustedCount = agents.filter((agent) => !agent.trusted).length;
	const openDir = (dir: string) =>
		void getPi()
			.openResourceExternal(dir)
			.catch(() => {});
	return (
		<section className="panel-card" data-testid="subagents-available">
			<header className="flex items-center gap-2">
				<span className="text-[12px] font-medium text-ink">{t("panel.subagents.available")}</span>
				<span className="text-[11px] tabular-nums text-ink-faint">{agents.length}</span>
				<span className="ml-auto flex items-center gap-2">
					<button
						type="button"
						className="text-[11px] text-ink-dim hover:text-ink disabled:opacity-50"
						disabled={loading}
						onClick={() => void loadAgents(sessionId, true)}
					>
						{t("panel.subagents.refresh")}
					</button>
					{snapshot && (
						<button
							type="button"
							className="text-[11px] text-ink-dim hover:text-ink"
							onClick={() => openDir(snapshot.userAgentsDir)}
							title={snapshot.userAgentsDir}
						>
							{t("panel.subagents.openDir")}
						</button>
					)}
				</span>
			</header>
			{error && <p className="mt-2 text-[11px] text-err">{t("panel.subagents.loadError", { error })}</p>}
			{loading && !snapshot && <p className="mt-2 text-[11px] text-ink-faint">{t("settings.loading")}</p>}
			{snapshot && agents.length === 0 && (
				<div className="mt-2 text-[12px] text-ink-faint" data-testid="subagents-empty-agents">
					<p>
						{t("panel.subagents.empty", {
							user: snapshot.userAgentsDir,
							project: snapshot.projectAgentsDir,
						})}
					</p>
					<div className="mt-2 flex gap-2">
						<Button size="sm" onClick={() => openDir(snapshot.userAgentsDir)}>
							{t("panel.subagents.openDir")}
						</Button>
					</div>
				</div>
			)}
			{untrustedCount > 0 && (
				<p className="mt-2 rounded-lg border border-warn/40 bg-warn/5 px-2 py-1.5 text-[11px] text-warn">
					{t("panel.subagents.untrustedHint", { n: untrustedCount })}
				</p>
			)}
			{agents.length > 0 && (
				<ul className="mt-1.5 flex flex-col">
					{agents.map((agent) => (
						<AgentRow
							key={agent.name}
							agent={agent}
							expanded={expanded === agent.name}
							onToggle={() => setExpanded((current) => (current === agent.name ? null : agent.name))}
							onPick={() => setDraftAgent(agent.name)}
						/>
					))}
				</ul>
			)}
		</section>
	);
}

function AgentRow({
	agent,
	expanded,
	onToggle,
	onPick,
}: {
	agent: SubagentPanelAgent;
	expanded: boolean;
	onToggle: () => void;
	onPick: () => void;
}) {
	const t = useT();
	const disabled = !agent.trusted;
	return (
		<li className="rounded-lg hover:bg-hover" data-testid="subagent-agent-row" data-agent={agent.name}>
			<div className="flex items-start gap-2 px-1.5 py-1.5">
				<button type="button" className="flex min-w-0 flex-1 items-start gap-2 text-left" onClick={onToggle}>
					<SubagentAvatar name={agent.name} source={agent.source} size="md" state="idle" className="mt-0.5" />
					<span className="min-w-0 flex-1">
						<span className="flex flex-wrap items-center gap-1.5">
							<span className="text-[13px] font-semibold text-ink">{agent.name}</span>
							<span
								className={`rounded-full border px-1.5 text-[10px] leading-4 ${
									disabled ? "border-warn/50 text-warn" : "border-border text-ink-dim"
								}`}
							>
								{disabled ? t("panel.subagents.untrusted") : t(SOURCE_KEYS[agent.source])}
							</span>
						</span>
						<span className="mt-0.5 line-clamp-2 block text-[11px] text-ink-dim">{agent.description}</span>
					</span>
					<ChevronDownIcon
						className={`mt-1 shrink-0 text-ink-faint transition-transform ${expanded ? "rotate-180" : ""}`}
					/>
				</button>
				<Button
					size="sm"
					disabled={disabled}
					onClick={onPick}
					data-testid="subagent-agent-pick"
					title={disabled ? t("panel.subagents.errors.untrusted", { agent: agent.name }) : undefined}
				>
					{t("panel.subagents.dispatch")}
				</Button>
			</div>
			{expanded && (
				<dl className="mx-1.5 mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-surface-2/40 px-2 py-1.5 text-[11px]">
					<dt className="text-ink-faint">{t("panel.subagents.tools")}</dt>
					<dd className="flex flex-wrap gap-1">
						{agent.tools.map((tool) => (
							<span key={tool} className="sa-chip">
								{tool}
							</span>
						))}
					</dd>
					<dt className="text-ink-faint">{t("panel.subagents.mcp")}</dt>
					<dd className="text-ink-2">
						{agent.mcpAccess === "read-local"
							? t("panel.subagents.mcpReadLocal")
							: t("panel.subagents.mcpNone")}
					</dd>
					<dt className="text-ink-faint">{t("panel.subagents.model")}</dt>
					<dd className="truncate font-mono text-ink-2">
						{agent.model ?? t("panel.subagents.modelInherit")}
					</dd>
					<dt className="text-ink-faint">{t("panel.subagents.definition")}</dt>
					<dd className="truncate text-ink-2" title={agent.path}>
						{agent.path ?? t("panel.subagents.builtinDefinition")}
					</dd>
				</dl>
			)}
		</li>
	);
}

/* ───────────────────────────── 派发表单 ───────────────────────────── */

function DispatchSection({
	sessionId,
	snapshot,
	active,
}: {
	sessionId: string;
	snapshot: SubagentPanelSnapshot;
	active: number;
}) {
	const t = useT();
	const language = useI18nStore((s) => s.language);
	const dispatch = useSubagentsStore((s) => s.dispatch);
	const draftAgent = useSubagentsStore((s) => s.draftAgent);
	const setDraftAgent = useSubagentsStore((s) => s.setDraftAgent);
	const openSettings = useSettingsStore((s) => s.openWith);
	// fullAccess 会话：子智能体同样不再逐项确认（S8 边界提示）
	const fullAccess = useSessionsStore((s) => s.permissionModes[sessionId] === "fullAccess");
	const [form, setForm] = useState<DispatchFormDraft>(() => emptyDispatchForm());
	const [cwd, setCwd] = useState(snapshot.cwd);
	const [sending, setSending] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const [touched, setTouched] = useState(false);

	// 可用列表「派发」→ 填进第一行空任务，否则追加一行
	useEffect(() => {
		if (!draftAgent) return;
		setForm((current) => {
			const empty = current.tasks.findIndex((task) => !task.agent && !task.task.trim());
			if (empty >= 0) {
				const tasks = current.tasks.map((task, index) =>
					index === empty ? { ...task, agent: draftAgent } : task,
				);
				return { ...current, tasks };
			}
			return canAddTask(current)
				? { ...current, tasks: [...current.tasks, newTaskDraft(draftAgent)] }
				: current;
		});
		setDraftAgent(null);
	}, [draftAgent, setDraftAgent]);

	const agents = snapshot.agents;
	const errors = useMemo(() => validateDispatchForm(form, agents), [form, agents]);
	const errorByKey = useMemo(() => new Map(errors.map((error) => [error.key, error])), [errors]);
	const needsTrust = formNeedsProjectTrust(form, agents);
	const plan = dispatchSlotPlan(form.tasks.length, active, snapshot.maxConcurrent);
	const stage = form.stageId ? workflowStage(form.stageId) : undefined;
	const stages = useMemo(() => stageOptions(language), [language]);
	const valid = errors.length === 0;

	const updateTask = (key: string, patch: Partial<DispatchFormDraft["tasks"][number]>) =>
		setForm((current) => ({
			...current,
			tasks: current.tasks.map((task) => (task.key === key ? { ...task, ...patch } : task)),
		}));

	const submit = async () => {
		setTouched(true);
		if (!valid || sending) return;
		setSending(true);
		setFailure(null);
		try {
			await dispatch(sessionId, buildDispatchInput(form, { cwd: cwd.trim() || undefined, language }));
			setForm(emptyDispatchForm());
			setTouched(false);
		} catch (error) {
			setFailure(error instanceof Error ? error.message : String(error));
		} finally {
			setSending(false);
		}
	};

	const insertPrompt = () => {
		appendToComposer(
			sessionId,
			promptDispatchText(
				form,
				{
					header: (agent, task) => t("panel.subagents.promptDispatch", { agent, task }),
					required: (tools) => t("panel.subagents.promptRequired", { tools }),
				},
				language,
			),
		);
	};

	const pickCwd = async () => {
		const picked = await getPi().pickDirectory();
		if (picked) setCwd(picked);
	};

	const dispatchLabel =
		form.tasks.length > 1
			? t("panel.subagents.dispatchN", { n: form.tasks.length })
			: plan.free === 0
				? t("panel.subagents.dispatchQueue")
				: t("panel.subagents.dispatch");

	return (
		<section className="panel-card" data-testid="subagents-dispatch">
			<header className="flex items-center gap-2">
				<span className="text-[12px] font-medium text-ink">{t("panel.subagents.dispatchHere")}</span>
				{form.tasks.length > 1 && (
					<span className="text-[11px] tabular-nums text-ink-faint">
						{form.tasks.length} / {SUBAGENT_PANEL_MAX_TASKS}
					</span>
				)}
				<span
					className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-faint"
					title={t("panel.subagents.slots")}
				>
					<span className="sa-slots" aria-hidden="true">
						{Array.from({ length: snapshot.maxConcurrent }, (_, index) => `s${index}`).map(
							(slotKey, index) => (
								<span key={slotKey} className={`sa-slot${index < active ? " on" : ""}`} />
							),
						)}
					</span>
					<span className="tabular-nums">
						{Math.min(active, snapshot.maxConcurrent)}/{snapshot.maxConcurrent}
					</span>
				</span>
			</header>
			<div className="mt-2 flex flex-col gap-2">
				{fullAccess && (
					<p
						className="rounded-lg border border-warn/40 bg-warn/5 px-2 py-1.5 text-[11px] text-warn"
						data-testid="subagents-full-access"
					>
						{t("panel.subagents.fullAccessHint")}
					</p>
				)}
				{form.tasks.map((task, index) => (
					<TaskRow
						key={task.key}
						index={index}
						task={task}
						agents={agents}
						error={touched ? errorByKey.get(task.key) : undefined}
						removable={form.tasks.length > 1}
						onChange={(patch) => updateTask(task.key, patch)}
						onRemove={() =>
							setForm((current) => ({
								...current,
								tasks: current.tasks.filter((item) => item.key !== task.key),
							}))
						}
					/>
				))}
				<div className="flex items-center gap-2 text-[11px]">
					<label htmlFor="subagent-stage" className="w-16 shrink-0 text-ink-faint">
						{t("panel.subagents.stage")}
					</label>
					<select
						id="subagent-stage"
						className={SELECT_CLASS}
						value={form.stageId}
						onChange={(e) => setForm((current) => ({ ...current, stageId: e.target.value }))}
					>
						<option value="">{t("panel.subagents.stageNone")}</option>
						{stages.map((option) => (
							<option key={option.id} value={option.id}>
								{option.label}
							</option>
						))}
					</select>
				</div>
				{stage && (
					<p className="pl-[72px] text-[11px] text-ink-faint">
						{t("panel.subagents.stageHint", { contract: stage.contract })}
					</p>
				)}
				<div className="flex items-center gap-2 text-[11px]">
					<label htmlFor="subagent-cwd" className="w-16 shrink-0 text-ink-faint">
						{t("panel.subagents.cwd")}
					</label>
					<input
						id="subagent-cwd"
						className={INPUT_CLASS}
						value={cwd}
						onChange={(e) => setCwd(e.target.value)}
						title={cwd === snapshot.cwd ? t("panel.subagents.cwdCurrent") : undefined}
					/>
					<Button size="sm" onClick={() => void pickCwd()}>
						…
					</Button>
				</div>
				<label className="flex items-start gap-2 text-[11px] text-ink-2">
					<input
						type="checkbox"
						className="mt-0.5"
						checked={form.followUp}
						onChange={(e) => setForm((current) => ({ ...current, followUp: e.target.checked }))}
						data-testid="subagent-followup"
					/>
					<span>{t("panel.subagents.followUp")}</span>
				</label>
				{needsTrust && (
					<label className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/5 px-2 py-1.5 text-[11px] text-ink-2">
						<input
							type="checkbox"
							className="mt-0.5"
							checked={form.trustProjectAgents}
							onChange={(e) => setForm((current) => ({ ...current, trustProjectAgents: e.target.checked }))}
							data-testid="subagent-trust-project"
						/>
						<span>{t("panel.subagents.trustProject")}</span>
					</label>
				)}
				{failure && (
					<div
						className="rounded-lg border border-err/40 bg-err/5 px-2 py-1.5 text-[11px] text-err"
						data-testid="subagent-dispatch-error"
					>
						<p>{t("panel.subagents.dispatchFailed", { error: failure })}</p>
						<button
							type="button"
							className="mt-1 underline decoration-err/40 underline-offset-2"
							onClick={() => openSettings("permissions")}
						>
							{t("panel.subagents.openPermissions")}
						</button>
					</div>
				)}
				<div className="flex flex-wrap items-center gap-1.5">
					<Button
						variant="primary"
						size="sm"
						disabled={sending || (touched && !valid)}
						onClick={() => void submit()}
						data-testid="subagent-dispatch-submit"
					>
						{dispatchLabel}
					</Button>
					<Button
						size="sm"
						disabled={!canAddTask(form)}
						onClick={() => setForm((current) => ({ ...current, tasks: [...current.tasks, newTaskDraft()] }))}
					>
						{t("panel.subagents.addTask")}
					</Button>
					<Button size="sm" onClick={insertPrompt} title={t("panel.subagents.insertHint")}>
						{t("panel.subagents.insertToComposer")}
					</Button>
				</div>
				<p className="text-[11px] text-ink-faint">
					{plan.free === 0
						? t("panel.subagents.slotsFull", { limit: snapshot.maxConcurrent })
						: form.tasks.length > 1
							? t("panel.subagents.slotsQueued", { now: plan.now, queued: plan.queued })
							: t("panel.subagents.footnote")}
				</p>
			</div>
		</section>
	);
}

function TaskRow({
	index,
	task,
	agents,
	error,
	removable,
	onChange,
	onRemove,
}: {
	index: number;
	task: DispatchFormDraft["tasks"][number];
	agents: readonly SubagentPanelAgent[];
	error: DispatchTaskError | undefined;
	removable: boolean;
	onChange: (patch: Partial<DispatchFormDraft["tasks"][number]>) => void;
	onRemove: () => void;
}) {
	const t = useT();
	const agent = agents.find((item) => item.name === task.agent);
	const toggleTool = (tool: string) =>
		onChange({
			requiredTools: task.requiredTools.includes(tool)
				? task.requiredTools.filter((item) => item !== tool)
				: [...task.requiredTools, tool],
		});
	const errorText = error
		? error.code === "tools"
			? t("panel.subagents.errors.tools", { agent: error.agent, tools: error.tools.join(", ") })
			: error.code === "untrusted"
				? t("panel.subagents.errors.untrusted", { agent: error.agent })
				: error.code === "trust"
					? t("panel.subagents.errors.trust")
					: error.code === "task"
						? t("panel.subagents.errors.task")
						: t("panel.subagents.errors.agent")
		: null;
	return (
		<div
			className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2/40 p-2"
			data-testid="subagent-task-row"
		>
			<div className="flex items-center gap-2 text-[11px] text-ink-dim">
				{agent ? (
					<SubagentAvatar name={agent.name} source={agent.source} size="sm" state="idle" />
				) : (
					<span className="text-ink-faint">{t("panel.subagents.taskN", { n: index + 1 })}</span>
				)}
				<select
					className={SELECT_CLASS}
					value={task.agent}
					onChange={(e) => onChange({ agent: e.target.value, requiredTools: [] })}
					aria-label={t("panel.subagents.agent")}
					data-testid="subagent-task-agent"
				>
					<option value="">{t("panel.subagents.agent")}…</option>
					{agents.map((item) => (
						<option key={item.name} value={item.name} disabled={!item.trusted}>
							{item.name} · {item.trusted ? t(SOURCE_KEYS[item.source]) : t("panel.subagents.untrusted")}
						</option>
					))}
				</select>
				{removable && (
					<button
						type="button"
						className="shrink-0 text-ink-faint hover:text-ink"
						onClick={onRemove}
						aria-label={t("panel.subagents.removeTask")}
					>
						✕
					</button>
				)}
			</div>
			<textarea
				className="min-h-[64px] w-full resize-y rounded-lg border border-border bg-surface px-2 py-1.5 text-[12px] leading-relaxed text-ink outline-none focus:border-accent"
				value={task.task}
				onChange={(e) => onChange({ task: e.target.value })}
				placeholder={t("panel.subagents.taskPlaceholder")}
				aria-label={t("panel.subagents.task")}
				data-testid="subagent-task-text"
			/>
			{agent && agent.tools.length > 0 && (
				<div className="flex flex-wrap items-center gap-1">
					<span className="mr-1 text-[11px] text-ink-faint">{t("panel.subagents.requiredTools")}</span>
					{agent.tools.map((tool) => (
						<button
							type="button"
							key={tool}
							className={`sa-chip${task.requiredTools.includes(tool) ? " on" : ""}`}
							onClick={() => toggleTool(tool)}
							aria-pressed={task.requiredTools.includes(tool)}
						>
							{tool}
						</button>
					))}
				</div>
			)}
			{errorText && (
				<p className="text-[11px] text-err" data-testid="subagent-task-error">
					{errorText}
				</p>
			)}
		</div>
	);
}

/* ───────────────────────────── 本会话运行 ───────────────────────────── */

function RunsSection({
	sessionId,
	runs,
	snapshot,
}: {
	sessionId: string;
	runs: SubagentPanelRun[];
	snapshot: SubagentPanelSnapshot | null;
}) {
	const t = useT();
	const [filter, setFilter] = useState<"active" | "all">("all");
	const summary = useMemo(() => summarizeRuns(runs), [runs]);
	const shown = filter === "active" ? runs.filter((run) => !isSubagentRunSettled(run.status)) : runs;
	return (
		<section className="panel-card" data-testid="subagents-runs">
			<header className="flex items-center gap-2">
				<span className="text-[12px] font-medium text-ink">{t("panel.subagents.runs")}</span>
				<span className="text-[11px] tabular-nums text-ink-faint">{runs.length}</span>
				{runs.length > 0 && (
					<span className="ml-auto flex items-center gap-1 text-[11px]">
						<button
							type="button"
							className={`rounded-md px-1.5 py-0.5 ${filter === "active" ? "bg-hover text-ink" : "text-ink-faint hover:text-ink"}`}
							onClick={() => setFilter("active")}
						>
							{t("panel.subagents.filterActive")}
							{summary.active + summary.queued > 0 && (
								<span className="ml-1 tabular-nums">{summary.active + summary.queued}</span>
							)}
						</button>
						<button
							type="button"
							className={`rounded-md px-1.5 py-0.5 ${filter === "all" ? "bg-hover text-ink" : "text-ink-faint hover:text-ink"}`}
							onClick={() => setFilter("all")}
						>
							{t("panel.subagents.filterAll")}
						</button>
					</span>
				)}
			</header>
			{runs.length === 0 ? (
				<p className="mt-2 text-[12px] text-ink-faint" data-testid="subagents-runs-empty">
					{t("panel.subagents.runsEmpty")}
				</p>
			) : (
				<div className="mt-2 flex flex-col gap-2">
					{shown.map((run) => (
						<RunCard key={run.runId} run={run} sessionId={sessionId} snapshot={snapshot} />
					))}
				</div>
			)}
		</section>
	);
}

function RunCard({
	run,
	sessionId,
	snapshot,
}: {
	run: SubagentPanelRun;
	sessionId: string;
	snapshot: SubagentPanelSnapshot | null;
}) {
	const t = useT();
	const abort = useSubagentsStore((s) => s.abort);
	const dispatch = useSubagentsStore((s) => s.dispatch);
	const focusRunId = useSubagentsStore((s) => s.focusRunId);
	const focusRun = useSubagentsStore((s) => s.focusRun);
	const pending = useTranscriptStore((s) => s.bySession[sessionId]?.pendingPermissions);
	const [expanded, setExpanded] = useState(false);
	const [reply, setReply] = useState("");
	const [guide, setGuide] = useState("");
	const [busy, setBusy] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [now, setNow] = useState(Date.now());
	const [focused, setFocused] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const settled = isSubagentRunSettled(run.status);
	const live = !settled && run.status !== "queued";
	const request = run.supervisorRequest ?? null;
	const approvalPending = pending?.some((item) => run.pendingApprovalIds.includes(item.id)) === true;

	useEffect(() => {
		if (focusRunId !== run.runId) return;
		focusRun(null);
		setFocused(true);
		ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
		const timer = setTimeout(() => setFocused(false), 1800);
		return () => clearTimeout(timer);
	}, [focusRunId, run.runId, focusRun]);

	useEffect(() => {
		if (settled || !run.startedAt) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [settled, run.startedAt]);

	const act = useCallback(async (work: () => Promise<unknown>) => {
		setBusy(true);
		setActionError(null);
		try {
			await work();
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	}, []);

	const redispatch = () =>
		act(() =>
			dispatch(sessionId, {
				tasks: [{ agent: run.agent, task: run.task, requiredTools: run.requiredTools }],
				cwd: run.cwd,
				followUp: run.followUp,
				trustProjectAgents: run.source === "project",
			}),
		);
	const cite = () => {
		appendToComposer(
			sessionId,
			citeRunText(
				run,
				t("panel.subagents.citeHeader", {
					agent: run.agent,
					time: formatClock(run.endedAt ?? run.createdAt),
				}),
			),
		);
	};
	const viewApproval = () => {
		window.dispatchEvent(new Event(APPROVAL_FOCUS_EVENT));
	};

	const current =
		run.status === "queued"
			? t("panel.subagents.queueReason", { n: run.queuePosition ?? 1 })
			: run.status === "waiting_approval"
				? `${run.currentAction ?? run.statusText ?? ""}${run.currentAction || run.statusText ? " · " : ""}${t("panel.subagents.waitingApprovalReason")}`
				: run.status === "needs_reply"
					? t("message.subagent.replyNeeded")
					: (run.currentAction ?? run.statusText ?? "");
	const duration =
		run.startedAt != null ? formatDuration((settled ? (run.endedAt ?? now) : now) - run.startedAt) : null;

	return (
		<div
			ref={ref}
			className={`overflow-hidden rounded-xl border border-border/70 bg-surface/40${run.status === "aborted" ? " sa-run-aborted" : ""}${focused ? " sa-run-focus" : ""}`}
			data-testid="subagent-run-card"
			data-run-id={run.runId}
			data-status={run.status}
		>
			<div className="px-3 py-2.5">
				<div className="flex min-w-0 items-center gap-2">
					<SubagentAvatar
						name={run.agent}
						source={run.source}
						size="md"
						state={avatarStateForPanelStatus(run.status)}
					/>
					<span className="truncate text-[13px] font-semibold text-ink">{run.agent}</span>
					<StatusPill status={run.status} />
					{run.status === "done" && run.followUp && run.contextState !== "none" && (
						<span
							className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] ${
								run.contextState === "delivered" ? "bg-ok/10 text-ok" : "bg-surface-2 text-ink-faint"
							}`}
						>
							{run.contextState === "delivered"
								? t("panel.subagents.context.delivered")
								: t("panel.subagents.context.pending")}
						</span>
					)}
					{run.sessionFile && (
						<button
							type="button"
							className="ml-auto shrink-0 text-ink-faint hover:text-ink"
							onClick={() => setExpanded((value) => !value)}
							aria-expanded={expanded}
							aria-label={expanded ? t("message.subagent.collapse") : t("message.subagent.expand")}
						>
							<ChevronDownIcon className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
						</button>
					)}
				</div>
				<div className="mt-2 grid gap-1 text-[11px]">
					<div className="flex min-w-0 gap-2">
						<span className="shrink-0 text-ink-faint">{t("message.subagent.goal")}</span>
						<span className="truncate text-ink-2" title={run.task}>
							{run.task}
						</span>
					</div>
					{!settled && current && (
						<div className="flex min-w-0 gap-2">
							<span className="shrink-0 text-ink-faint">{t("message.subagent.current")}</span>
							<span className="truncate font-medium text-ink-2" title={current}>
								{current}
							</span>
						</div>
					)}
					{!settled && run.currentTool && (
						<div className="flex min-w-0 gap-2">
							<span className="shrink-0 text-ink-faint">{t("message.subagent.tool")}</span>
							<span className="truncate font-mono text-ink-dim">{run.currentTool}</span>
						</div>
					)}
					{run.status === "error" && run.error && (
						<div className="flex min-w-0 gap-2">
							<span className="shrink-0 text-ink-faint">{t("panel.subagents.error")}</span>
							<span className="break-words text-err">{run.error}</span>
						</div>
					)}
					{run.status === "done" && run.content && (
						<div className="line-clamp-3 whitespace-pre-wrap text-ink-2" title={run.content}>
							{run.content}
						</div>
					)}
				</div>
				<div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
					{run.model && <span className="min-w-0 truncate font-mono">{run.model}</span>}
					{run.tokens != null && run.tokens > 0 && (
						<span className="shrink-0">{t("message.subagent.tokens", { n: formatTokens(run.tokens) })}</span>
					)}
					{duration && (
						<span className="shrink-0">
							{settled ? duration : t("message.subagent.runtime", { n: duration })}
							{run.status === "aborted" ? ` · ${t("panel.subagents.abortedBy")}` : ""}
						</span>
					)}
				</div>
				{request && (
					<div
						className={`mt-2 rounded-lg border px-2.5 py-2 text-[11px] ${request.expectsReply ? "border-warn/30 bg-warn/5" : "border-border/60 bg-surface-2/40"}`}
					>
						<div className="font-medium text-ink-2">
							{request.reason === "need_decision"
								? t("message.subagent.needDecision")
								: request.reason === "interview_request"
									? t("message.subagent.interviewRequest")
									: t("message.subagent.progressUpdate")}
						</div>
						<div className="mt-1 whitespace-pre-wrap text-ink-dim">{request.message}</div>
						{request.expectsReply && live && run.childSessionId && (
							<div className="mt-2 flex gap-1.5">
								<input
									value={reply}
									onChange={(e) => setReply(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter" && !e.shiftKey && reply.trim())
											void act(async () => {
												await getPi().replySubagentSupervisor(
													run.childSessionId ?? "",
													request.id,
													reply.trim(),
												);
												setReply("");
											});
									}}
									placeholder={t("message.subagent.replyPlaceholder")}
									className={INPUT_CLASS}
								/>
								<Button
									variant="primary"
									size="sm"
									disabled={busy || !reply.trim()}
									onClick={() =>
										void act(async () => {
											await getPi().replySubagentSupervisor(
												run.childSessionId ?? "",
												request.id,
												reply.trim(),
											);
											setReply("");
										})
									}
								>
									{t("message.subagent.reply")}
								</Button>
							</div>
						)}
					</div>
				)}
				{live && run.childSessionId && (
					<div className="mt-2 flex gap-1.5">
						<input
							value={guide}
							onChange={(e) => setGuide(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey && guide.trim())
									void act(async () => {
										await getPi().steerSubagent(run.childSessionId ?? "", guide.trim(), "steer");
										setGuide("");
									});
							}}
							placeholder={t("message.subagent.guidePlaceholder")}
							className={INPUT_CLASS}
						/>
						<Button
							size="sm"
							disabled={busy || !guide.trim()}
							onClick={() =>
								void act(async () => {
									await getPi().steerSubagent(run.childSessionId ?? "", guide.trim(), "steer");
									setGuide("");
								})
							}
						>
							{t("message.subagent.send")}
						</Button>
					</div>
				)}
				<div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="subagent-run-actions">
					{!settled && (
						<Button
							size="sm"
							tone="danger"
							disabled={busy}
							onClick={() => void act(() => abort(run.runId))}
							data-testid="subagent-run-abort"
						>
							{run.status === "queued"
								? t("panel.subagents.actions.cancel")
								: t("panel.subagents.actions.abort")}
						</Button>
					)}
					{run.status === "waiting_approval" && approvalPending && (
						<Button size="sm" onClick={viewApproval}>
							{t("panel.subagents.actions.viewApproval")}
						</Button>
					)}
					{run.status === "done" && (
						<Button size="sm" onClick={cite} data-testid="subagent-run-cite">
							{t("panel.subagents.actions.cite")}
						</Button>
					)}
					{run.sessionFile && (
						<Button size="sm" onClick={() => setExpanded((value) => !value)}>
							{expanded ? t("panel.subagents.actions.collapse") : t("panel.subagents.actions.replay")}
						</Button>
					)}
					{run.status === "error" && snapshot && !snapshot.readOnly && (
						<Button
							size="sm"
							disabled={busy}
							onClick={() => void redispatch()}
							data-testid="subagent-run-retry"
						>
							{t("panel.subagents.actions.retry")}
						</Button>
					)}
					{run.status === "done" && snapshot && !snapshot.readOnly && (
						<Button size="sm" disabled={busy} onClick={() => void redispatch()}>
							{t("panel.subagents.actions.redispatch")}
						</Button>
					)}
				</div>
				{actionError && <p className="mt-1 text-[11px] text-err">{actionError}</p>}
			</div>
			{expanded && run.sessionFile && (
				<InlineSubagentTranscript
					run={{
						key: run.runId,
						agent: run.agent,
						sessionId: run.childSessionId,
						sessionFile: run.sessionFile,
						status: settled ? (run.status === "error" ? "error" : "done") : "running",
					}}
				/>
			)}
		</div>
	);
}

function StatusPill({ status }: { status: SubagentPanelRun["status"] }) {
	const t = useT();
	const tone =
		status === "error"
			? "bg-err/10 text-err"
			: status === "done"
				? "bg-ok/10 text-ok"
				: status === "needs_reply" || status === "waiting_approval"
					? "bg-warn/10 text-warn"
					: status === "aborted" || status === "queued"
						? "bg-surface-2 text-ink-faint"
						: "bg-accent/10 text-accent";
	return (
		<span
			className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${tone}`}
			data-testid="subagent-run-status"
		>
			{t(STATUS_KEYS[status])}
		</span>
	);
}
