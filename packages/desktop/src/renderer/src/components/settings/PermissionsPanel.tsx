import {
	PERMISSION_KNOWN_TOOLS,
	type PermissionAuditTailEntry,
	type PermissionProbeInput,
	type PermissionProbeResult,
	type PermissionRuleAction,
	type PermissionSettingsIssue,
	type PermissionSettingsSnapshot,
} from "@drone/shared";
import { useEffect, useMemo, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { selectPermissionDirty, usePermissionSettingsStore } from "../../stores/permissions";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";
import { ActionSelect, PatternTable } from "./PatternTable";
import {
	draftToSettings,
	type PatternRow,
	type PermissionDraft,
	removeTool,
	replaceTool,
	rowNumber,
	type ToolRuleDraft,
	validateDraft,
} from "./permissions-model";
import { SettingsRow } from "./SettingsRow";

/**
 * 设置 → 权限：可视化编辑全局 ~/.pi/agent/permissions.json。
 * 三段：工作区边界 / 工具规则（含 bash 模式表 + 试算）/ 高级（审计、文件位置、恢复默认）。
 * 不编辑会话权限模式（输入框 PermissionPicker，内存态）与 enabled（只读横幅）。
 */
export function PermissionsPanel() {
	const t = useT();
	const snapshot = usePermissionSettingsStore((s) => s.snapshot);
	const draft = usePermissionSettingsStore((s) => s.draft);
	const loading = usePermissionSettingsStore((s) => s.loading);
	const error = usePermissionSettingsStore((s) => s.error);
	const saving = usePermissionSettingsStore((s) => s.saving);
	const conflict = usePermissionSettingsStore((s) => s.conflict);
	const serverIssues = usePermissionSettingsStore((s) => s.serverIssues);
	const savedAt = usePermissionSettingsStore((s) => s.savedAt);
	const audit = usePermissionSettingsStore((s) => s.audit);
	const auditLoaded = usePermissionSettingsStore((s) => s.auditLoaded);
	const dirty = usePermissionSettingsStore(selectPermissionDirty);
	const load = usePermissionSettingsStore((s) => s.load);
	const update = usePermissionSettingsStore((s) => s.update);
	const discard = usePermissionSettingsStore((s) => s.discard);
	const save = usePermissionSettingsStore((s) => s.save);
	const reset = usePermissionSettingsStore((s) => s.reset);
	const loadAudit = usePermissionSettingsStore((s) => s.loadAudit);
	const openLocation = usePermissionSettingsStore((s) => s.openLocation);

	// 每次打开面板都重读磁盘（文件可能被手改）；有未保存草稿时保留草稿
	// biome-ignore lint/correctness/useExhaustiveDependencies: 仅挂载时重读磁盘
	useEffect(() => {
		if (!dirty) void load();
	}, []);

	if (!snapshot || !draft) {
		return (
			<div className="py-6 text-[12px] text-ink-faint" data-testid="permissions-loading">
				{error ? (
					<div className="flex items-center gap-2">
						<span className="text-err">{t("settings.permissions.loadError", { error })}</span>
						<Button size="sm" onClick={() => void load()}>
							{t("settings.permissions.retry")}
						</Button>
					</div>
				) : (
					t("settings.permissions.loading")
				)}
			</div>
		);
	}

	return (
		<PermissionsEditor
			snapshot={snapshot}
			draft={draft}
			dirty={dirty}
			saving={saving || loading}
			error={error}
			conflict={conflict}
			serverIssues={serverIssues}
			savedAt={savedAt}
			audit={audit}
			auditLoaded={auditLoaded}
			onChange={(next) => update(() => next)}
			onDiscard={discard}
			onSave={(force) => void save(force)}
			onReload={() => void load()}
			onReset={() => void reset()}
			onLoadAudit={() => void loadAudit()}
			onOpenLocation={() => void openLocation()}
			probe={(input) => getPi().probePermission(input)}
		/>
	);
}

export interface PermissionsEditorProps {
	snapshot: PermissionSettingsSnapshot;
	draft: PermissionDraft;
	dirty: boolean;
	saving: boolean;
	error: string | null;
	conflict: PermissionSettingsSnapshot | null;
	serverIssues: PermissionSettingsIssue[];
	savedAt: number | null;
	audit: PermissionAuditTailEntry[];
	auditLoaded: boolean;
	onChange: (draft: PermissionDraft) => void;
	onDiscard: () => void;
	onSave: (force?: boolean) => void;
	onReload: () => void;
	onReset: () => void;
	onLoadAudit: () => void;
	onOpenLocation: () => void;
	probe: (input: PermissionProbeInput) => Promise<PermissionProbeResult>;
}

/** 纯展示编辑器：状态全部来自 props（PermissionsPanel 负责 store 接线；测试直接渲染它） */
export function PermissionsEditor(props: PermissionsEditorProps) {
	const { snapshot, draft, dirty, saving, conflict, serverIssues, savedAt, onChange } = props;
	const t = useT();
	const issues = useMemo(() => [...validateDraft(draft), ...serverIssues], [draft, serverIssues]);
	const invalidByTool = useMemo(() => {
		const map = new Map<string, Set<string>>();
		for (const issue of issues) {
			const match = /^rules\.([^.]+)\.(.*)$/.exec(issue.path);
			const tool = match?.[1];
			const pattern = match?.[2];
			if (tool === undefined || pattern === undefined) continue;
			const set = map.get(tool) ?? new Set<string>();
			set.add(pattern);
			map.set(tool, set);
		}
		return map;
	}, [issues]);
	const canSave = dirty && issues.length === 0 && !saving && !conflict;
	const bash = draft.tools.find((tool) => tool.tool === "bash" && tool.kind === "patterns");
	const setOutside = (key: "read" | "write" | "temporary", action: PermissionRuleAction) =>
		onChange({ ...draft, outside: { ...draft.outside, [key]: action } });

	return (
		<div data-testid="permissions-panel" className="space-y-4 pb-2">
			<header className="space-y-1.5">
				<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
					<h3 className="text-[13px] font-semibold text-ink">{t("settings.permissions.title")}</h3>
					<span className="text-[11px] text-ink-faint">{t("settings.permissions.effectHint")}</span>
				</div>
				<p className="flex flex-wrap items-center gap-x-2 text-[11px] text-ink-dim">
					<span>{t("settings.permissions.file")}</span>
					<code className="break-all font-mono text-[11px] text-ink-2" data-testid="permissions-path">
						{snapshot.path}
					</code>
				</p>
				{!snapshot.exists && (
					<p className="text-[11px] text-ink-faint">{t("settings.permissions.missingFile")}</p>
				)}
				{snapshot.parseError && (
					<p className="rounded-md border border-err/40 bg-err/5 px-2 py-1 text-[11px] text-err">
						{t("settings.permissions.parseError", { error: snapshot.parseError })}
					</p>
				)}
				{!snapshot.effective.enabled && (
					<p
						className="rounded-md border border-warn/40 bg-warn/10 px-2 py-1 text-[11px] text-ink"
						data-testid="permissions-disabled-banner"
					>
						⚠ {t("settings.permissions.disabledBanner")}
					</p>
				)}
			</header>

			<section className="space-y-1" data-testid="permissions-boundary">
				<h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
					{t("settings.permissions.boundary")}
				</h4>
				<div className="settings-rows">
					<SettingsRow
						title={t("settings.permissions.outsideRead")}
						hint={t("settings.permissions.outsideReadHint")}
					>
						<ActionSelect
							value={draft.outside.read}
							onChange={(action) => setOutside("read", action)}
							testId="outside-read"
						/>
					</SettingsRow>
					<SettingsRow
						title={t("settings.permissions.outsideWrite")}
						hint={t("settings.permissions.outsideWriteHint")}
					>
						<ActionSelect
							value={draft.outside.write}
							onChange={(action) => setOutside("write", action)}
							testId="outside-write"
						/>
					</SettingsRow>
					<SettingsRow
						title={t("settings.permissions.temporary")}
						hint={t("settings.permissions.temporaryHint")}
					>
						<ActionSelect
							value={draft.outside.temporary}
							onChange={(action) => setOutside("temporary", action)}
							testId="outside-temporary"
						/>
					</SettingsRow>
					<SettingsRow
						title={t("settings.permissions.autoApprove")}
						hint={t("settings.permissions.autoApproveHint")}
					>
						<Switch
							checked={draft.autoApproveProjectEdits}
							data-testid="auto-approve"
							onCheckedChange={(checked) => onChange({ ...draft, autoApproveProjectEdits: checked })}
						/>
					</SettingsRow>
				</div>
			</section>

			<section className="space-y-2" data-testid="permissions-rules">
				<h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
					{t("settings.permissions.rules")}
				</h4>
				<div className="settings-rows">
					<SettingsRow
						title={t("settings.permissions.fallback")}
						hint={t("settings.permissions.fallbackHint")}
					>
						<ActionSelect
							value={draft.fallback}
							onChange={(action) => onChange({ ...draft, fallback: action })}
							testId="rule-fallback"
						/>
					</SettingsRow>
					{draft.tools
						.filter((tool) => tool.kind === "action")
						.map((tool) => (
							<SettingsRow key={tool.tool} title={tool.tool}>
								<div className="flex items-center gap-1.5">
									<ActionSelect
										value={tool.kind === "action" ? tool.action : "ask"}
										onChange={(action) =>
											onChange(replaceTool(draft, { tool: tool.tool, kind: "action", action }))
										}
										testId={`rule-${tool.tool}`}
									/>
									<button
										type="button"
										className="rounded px-1 text-[11px] text-ink-faint transition-colors hover:bg-hover hover:text-ink"
										aria-label={t("settings.permissions.removeTool")}
										title={t("settings.permissions.removeTool")}
										onClick={() => onChange(removeTool(draft, tool.tool))}
									>
										✕
									</button>
								</div>
							</SettingsRow>
						))}
				</div>
				{draft.tools
					.filter((tool): tool is Extract<ToolRuleDraft, { kind: "patterns" }> => tool.kind === "patterns")
					.map((tool) => (
						<ToolPatternBlock
							key={tool.tool}
							tool={tool}
							invalid={invalidByTool.get(tool.tool)}
							onRows={(rows) => onChange(replaceTool(draft, { tool: tool.tool, kind: "patterns", rows }))}
							onRemove={tool.tool === "bash" ? undefined : () => onChange(removeTool(draft, tool.tool))}
							probe={
								tool.tool === "bash" && bash
									? (command) =>
											props.probe({
												tool: "bash",
												input: { command },
												settings: draftToSettings(draft, snapshot.effective.enabled),
											})
									: undefined
							}
						/>
					))}
				<AddToolRule draft={draft} onChange={onChange} />
			</section>

			<section className="space-y-2" data-testid="permissions-advanced">
				<h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
					{t("settings.permissions.advanced")}
				</h4>
				<AuditDisclosure
					path={snapshot.auditPath}
					entries={props.audit}
					loaded={props.auditLoaded}
					onOpen={props.onLoadAudit}
				/>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="flex items-center gap-1.5">
						<Button size="sm" onClick={props.onOpenLocation}>
							{t("settings.permissions.openLocation")}
						</Button>
						<ResetButton onReset={props.onReset} disabled={saving} />
					</div>
					<div className="flex items-center gap-1.5">
						<Button
							size="sm"
							disabled={!dirty || saving}
							onClick={props.onDiscard}
							data-testid="permissions-discard"
						>
							{t("settings.permissions.discard")}
						</Button>
						<Button
							size="sm"
							variant="primary"
							disabled={!canSave}
							onClick={() => props.onSave(false)}
							data-testid="permissions-save"
						>
							{saving ? t("settings.permissions.saving") : t("settings.permissions.save")}
						</Button>
					</div>
				</div>
				<StatusLine
					dirty={dirty}
					issues={issues}
					savedAt={savedAt}
					error={props.error}
					conflict={conflict}
					onReload={props.onReload}
					onOverwrite={() => props.onSave(true)}
				/>
			</section>
		</div>
	);
}

function ToolPatternBlock({
	tool,
	invalid,
	onRows,
	onRemove,
	probe,
}: {
	tool: Extract<ToolRuleDraft, { kind: "patterns" }>;
	invalid: Set<string> | undefined;
	onRows: (rows: PatternRow[]) => void;
	onRemove?: () => void;
	probe?: (command: string) => Promise<PermissionProbeResult>;
}) {
	const t = useT();
	const [command, setCommand] = useState("");
	const [result, setResult] = useState<PermissionProbeResult | null>(null);
	const [probing, setProbing] = useState(false);
	const run = async () => {
		if (!probe || !command.trim()) return;
		setProbing(true);
		try {
			setResult(await probe(command));
		} finally {
			setProbing(false);
		}
	};
	return (
		<div className="space-y-1.5" data-testid="tool-patterns" data-tool={tool.tool}>
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1.5">
					<span className="font-mono text-[12px] font-medium text-ink">{tool.tool}</span>
					<span className="text-[11px] text-ink-faint">{t("settings.permissions.patternTable")}</span>
				</div>
				{onRemove && (
					<button
						type="button"
						className="rounded px-1 text-[11px] text-ink-faint transition-colors hover:bg-hover hover:text-ink"
						aria-label={t("settings.permissions.removeTool")}
						title={t("settings.permissions.removeTool")}
						onClick={onRemove}
					>
						✕
					</button>
				)}
			</div>
			<PatternTable
				tool={tool.tool}
				rows={tool.rows}
				onChange={onRows}
				invalidPatterns={invalid}
				highlightPattern={result?.pattern ?? null}
			/>
			{probe && (
				<div className="space-y-1" data-testid="permissions-probe">
					<div className="flex items-center gap-1.5">
						<span className="shrink-0 text-[11px] text-ink-dim">{t("settings.permissions.probe")}</span>
						<input
							className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-0.5 font-mono text-[11px] text-ink outline-none focus:border-ink-faint"
							value={command}
							placeholder={t("settings.permissions.probePlaceholder")}
							data-testid="probe-input"
							onChange={(event) => setCommand(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									void run();
								}
							}}
						/>
						<Button
							size="sm"
							disabled={probing || !command.trim()}
							onClick={() => void run()}
							data-testid="probe-run"
						>
							{t("settings.permissions.probeRun")}
						</Button>
					</div>
					{result && <ProbeSummary rows={tool.rows} result={result} />}
					<p className="text-[10px] text-ink-faint">{t("settings.permissions.probeNote")}</p>
				</div>
			)}
		</div>
	);
}

/** 试算结果一行：命中 #n 模式 → 动作（无模式命中则说明走了工具级/全局兜底），命令链另标最严段 */
export function ProbeSummary({ rows, result }: { rows: PatternRow[]; result: PermissionProbeResult }) {
	const t = useT();
	const hitIndex = rowNumber(rows, result.pattern);
	return (
		<p className="text-[11px] text-ink-dim" data-testid="probe-result" data-action={result.action}>
			{result.pattern && hitIndex !== null
				? t("settings.permissions.probeHit", {
						index: hitIndex,
						pattern: result.pattern,
						action: result.action,
					})
				: t("settings.permissions.probeFallback", { action: result.action })}
			{result.segment && result.segment !== result.matchText && (
				<>
					{" · "}
					{t("settings.permissions.probeSegment", { segment: result.segment })}
				</>
			)}
		</p>
	);
}

function AddToolRule({
	draft,
	onChange,
}: {
	draft: PermissionDraft;
	onChange: (draft: PermissionDraft) => void;
}) {
	const t = useT();
	const present = new Set(draft.tools.map((tool) => tool.tool));
	const candidates = PERMISSION_KNOWN_TOOLS.filter((tool) => !present.has(tool));
	const [choice, setChoice] = useState<string>(candidates[0] ?? "__custom");
	const [custom, setCustom] = useState("");
	const name = (choice === "__custom" ? custom : choice).trim();
	const valid = name.length > 0 && name !== "*" && !present.has(name) && !/^\d+$/.test(name);
	const add = () => {
		if (!valid) return;
		onChange(replaceTool(draft, { tool: name, kind: "action", action: "ask" }));
		setCustom("");
		const rest = candidates.filter((tool) => tool !== name);
		setChoice(rest[0] ?? "__custom");
	};
	return (
		<div className="flex flex-wrap items-center gap-1.5" data-testid="add-tool-rule">
			<span className="text-[11px] text-ink-dim">{t("settings.permissions.addTool")}</span>
			<select
				className="rounded-md border border-border bg-bg px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-ink-faint"
				value={candidates.includes(choice) || choice === "__custom" ? choice : "__custom"}
				onChange={(event) => setChoice(event.target.value)}
			>
				{candidates.map((tool) => (
					<option key={tool} value={tool}>
						{tool}
					</option>
				))}
				<option value="__custom">{t("settings.permissions.addToolCustom")}</option>
			</select>
			{choice === "__custom" && (
				<input
					className="w-40 rounded-md border border-border bg-bg px-2 py-0.5 font-mono text-[11px] text-ink outline-none focus:border-ink-faint"
					value={custom}
					placeholder={t("settings.permissions.customToolPlaceholder")}
					onChange={(event) => setCustom(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							add();
						}
					}}
				/>
			)}
			<Button size="sm" disabled={!valid} onClick={add}>
				{t("settings.permissions.add")}
			</Button>
		</div>
	);
}

function AuditDisclosure({
	path,
	entries,
	loaded,
	onOpen,
}: {
	path: string;
	entries: PermissionAuditTailEntry[];
	loaded: boolean;
	onOpen: () => void;
}) {
	const t = useT();
	return (
		<details
			className="settings-disclosure"
			data-testid="permissions-audit"
			onToggle={(event) => {
				if ((event.currentTarget as HTMLDetailsElement).open) onOpen();
			}}
		>
			<summary className="settings-disclosure-summary">
				<div className="min-w-0">
					<h3 className="settings-row-title">{t("settings.permissions.audit")}</h3>
					<p className="settings-row-hint" title={path}>
						{t("settings.permissions.auditHint")}
					</p>
				</div>
				<span className="settings-disclosure-chevron" aria-hidden="true">
					⌄
				</span>
			</summary>
			<div className="settings-disclosure-body">
				{!loaded ? (
					<p className="text-[11px] text-ink-faint">{t("settings.permissions.loading")}</p>
				) : entries.length === 0 ? (
					<p className="text-[11px] text-ink-faint">{t("settings.permissions.auditEmpty")}</p>
				) : (
					<ol className="max-h-56 space-y-1 overflow-y-auto font-mono text-[10.5px] text-ink-dim">
						{entries.map((entry) => (
							<li key={`${entry.t}|${entry.tool}|${entry.text}|${entry.cwd ?? ""}`} className="flex gap-2">
								<span className="shrink-0 text-ink-faint">{entry.t.replace("T", " ").slice(0, 19)}</span>
								<span className="shrink-0">{entry.tool}</span>
								<span className={`shrink-0 ${entry.action === "deny" ? "text-err" : "text-warn"}`}>
									{entry.action}
								</span>
								{entry.boundary && <span className="shrink-0 text-ink-faint">{entry.boundary}</span>}
								<span className="truncate" title={entry.text}>
									{entry.text}
								</span>
							</li>
						))}
					</ol>
				)}
			</div>
		</details>
	);
}

function ResetButton({ onReset, disabled }: { onReset: () => void; disabled: boolean }) {
	const t = useT();
	const [confirming, setConfirming] = useState(false);
	if (!confirming) {
		return (
			<Button
				size="sm"
				disabled={disabled}
				onClick={() => setConfirming(true)}
				data-testid="permissions-reset"
			>
				{t("settings.permissions.restoreDefaults")}
			</Button>
		);
	}
	return (
		<span
			className="flex items-center gap-1.5 text-[11px] text-ink-dim"
			data-testid="permissions-reset-confirm"
		>
			{t("settings.permissions.restoreConfirm")}
			<Button
				size="sm"
				tone="danger"
				variant="primary"
				onClick={() => {
					setConfirming(false);
					onReset();
				}}
			>
				{t("settings.permissions.restoreDefaults")}
			</Button>
			<Button size="sm" onClick={() => setConfirming(false)}>
				{t("common.cancel")}
			</Button>
		</span>
	);
}

function StatusLine({
	dirty,
	issues,
	savedAt,
	error,
	conflict,
	onReload,
	onOverwrite,
}: {
	dirty: boolean;
	issues: PermissionSettingsIssue[];
	savedAt: number | null;
	error: string | null;
	conflict: PermissionSettingsSnapshot | null;
	onReload: () => void;
	onOverwrite: () => void;
}) {
	const t = useT();
	if (conflict) {
		return (
			<div
				className="space-y-1 rounded-md border border-warn/40 bg-warn/10 px-2 py-1.5 text-[11px] text-ink"
				data-testid="permissions-conflict"
			>
				<p className="font-medium">{t("settings.permissions.conflictTitle")}</p>
				<p className="text-ink-dim">{t("settings.permissions.conflictHint")}</p>
				<div className="flex gap-1.5">
					<Button size="sm" onClick={onReload}>
						{t("settings.permissions.conflictReload")}
					</Button>
					<Button size="sm" tone="danger" variant="primary" onClick={onOverwrite}>
						{t("settings.permissions.conflictOverwrite")}
					</Button>
				</div>
			</div>
		);
	}
	if (error) {
		return (
			<p className="text-[11px] text-err" data-testid="permissions-status">
				{error}
			</p>
		);
	}
	if (issues.length > 0) {
		const codes = Array.from(new Set(issues.map((issue) => issue.code)));
		return (
			<div className="text-[11px] text-err" data-testid="permissions-status" data-state="invalid">
				<p>{t("settings.permissions.invalid", { count: issues.length })}</p>
				<ul className="mt-0.5 list-disc pl-4 text-ink-dim">
					{codes.map((code) => (
						<li key={code}>{t(`settings.permissions.issue.${code}`)}</li>
					))}
				</ul>
			</div>
		);
	}
	if (dirty) {
		return (
			<p className="text-[11px] text-ink-dim" data-testid="permissions-status" data-state="dirty">
				{t("settings.permissions.unsaved")}
			</p>
		);
	}
	if (savedAt) {
		return (
			<p className="text-[11px] text-ok" data-testid="permissions-status" data-state="saved">
				{t("settings.permissions.saved")}
			</p>
		);
	}
	return null;
}
