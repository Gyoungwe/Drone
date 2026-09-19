import { PERMISSION_RULE_ACTIONS, type PermissionRuleAction } from "@drone/shared";
import { useT } from "../../i18n";
import { appendRow, moveRow, type PatternRow, removeRow, updateRow } from "./permissions-model";

const SELECT_CLASS =
	"rounded-md border border-border bg-bg px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-ink-faint disabled:cursor-not-allowed disabled:opacity-60";
const INPUT_CLASS =
	"w-full rounded-md border border-border bg-bg px-2 py-0.5 font-mono text-[11px] text-ink outline-none focus:border-ink-faint disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-70";
const ICON_BUTTON =
	"rounded px-1 text-[11px] leading-5 text-ink-faint transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent";

/** allow/ask/deny 选择器（锁定行不提供 allow） */
export function ActionSelect({
	value,
	onChange,
	locked = false,
	disabled = false,
	testId,
}: {
	value: PermissionRuleAction;
	onChange: (action: PermissionRuleAction) => void;
	locked?: boolean;
	disabled?: boolean;
	testId?: string;
}) {
	const t = useT();
	const options = locked ? PERMISSION_RULE_ACTIONS.filter((a) => a !== "allow") : PERMISSION_RULE_ACTIONS;
	return (
		<select
			className={SELECT_CLASS}
			value={value}
			disabled={disabled}
			data-testid={testId}
			data-action={value}
			onChange={(event) => onChange(event.target.value as PermissionRuleAction)}
		>
			{options.map((action) => (
				<option key={action} value={action}>
					{t(`settings.permissions.action.${action}`)}
				</option>
			))}
		</select>
	);
}

/**
 * 「模式 → 动作」表：数组编辑（↑↓ / ✕ / 添加），序号即评估序（后命中生效）。
 * 锁定行（bash 自保护）固定表尾：模式不可改、不可删、不可越过，动作只能 ask/deny。
 */
export function PatternTable({
	tool,
	rows,
	onChange,
	invalidPatterns,
	highlightPattern,
}: {
	tool: string;
	rows: PatternRow[];
	onChange: (rows: PatternRow[]) => void;
	/** 校验失败的模式（标红） */
	invalidPatterns?: ReadonlySet<string>;
	/** 试算命中的模式（高亮） */
	highlightPattern?: string | null;
}) {
	const t = useT();
	return (
		<div className="rounded-lg border border-border" data-testid="pattern-table" data-tool={tool}>
			<div className="grid grid-cols-[2rem_minmax(0,1fr)_7.5rem_4.5rem] items-center gap-2 border-b border-border px-2 py-1 text-[10px] uppercase tracking-wide text-ink-faint">
				<span>{t("settings.permissions.colIndex")}</span>
				<span>{t("settings.permissions.colPattern")}</span>
				<span>{t("settings.permissions.colAction")}</span>
				<span />
			</div>
			<ol className="max-h-96 overflow-y-auto">
				{rows.map((row, index) => {
					const invalid = invalidPatterns?.has(row.pattern) ?? false;
					const hit =
						highlightPattern !== undefined && highlightPattern !== null && highlightPattern === row.pattern;
					const canUp = index > 0 && !row.locked && !rows[index - 1]?.locked;
					const canDown = index < rows.length - 1 && !row.locked && !rows[index + 1]?.locked;
					return (
						<li
							key={row.id}
							data-testid="pattern-row"
							data-locked={row.locked ? "true" : undefined}
							data-hit={hit ? "true" : undefined}
							className={`grid grid-cols-[2rem_minmax(0,1fr)_7.5rem_4.5rem] items-center gap-2 border-b border-border px-2 py-1 last:border-b-0 ${
								hit ? "bg-hover" : ""
							}`}
						>
							<span className="font-mono text-[11px] text-ink-faint">{index + 1}</span>
							<div className="flex min-w-0 items-center gap-1.5">
								{row.locked && (
									<span
										className="shrink-0 text-[11px]"
										title={t("settings.permissions.lockedHint")}
										aria-hidden="true"
									>
										🔒
									</span>
								)}
								<input
									className={`${INPUT_CLASS} ${invalid ? "border-err" : ""}`}
									value={row.pattern}
									disabled={row.locked}
									placeholder={t("settings.permissions.patternPlaceholder")}
									aria-label={t("settings.permissions.colPattern")}
									aria-invalid={invalid || undefined}
									onChange={(event) => onChange(updateRow(rows, row.id, { pattern: event.target.value }))}
								/>
							</div>
							<ActionSelect
								value={row.action}
								locked={row.locked}
								onChange={(action) => onChange(updateRow(rows, row.id, { action }))}
							/>
							<div className="flex items-center justify-end gap-0.5">
								{row.locked ? (
									<span
										className="truncate text-[10px] text-ink-faint"
										title={t("settings.permissions.lockedHint")}
									>
										{t("settings.permissions.locked")}
									</span>
								) : (
									<>
										<button
											type="button"
											className={ICON_BUTTON}
											disabled={!canUp}
											aria-label={t("settings.permissions.moveUp")}
											title={t("settings.permissions.moveUp")}
											onClick={() => onChange(moveRow(rows, index, -1))}
										>
											↑
										</button>
										<button
											type="button"
											className={ICON_BUTTON}
											disabled={!canDown}
											aria-label={t("settings.permissions.moveDown")}
											title={t("settings.permissions.moveDown")}
											onClick={() => onChange(moveRow(rows, index, 1))}
										>
											↓
										</button>
										<button
											type="button"
											className={ICON_BUTTON}
											aria-label={t("settings.permissions.removeRow")}
											title={t("settings.permissions.removeRow")}
											onClick={() => onChange(removeRow(rows, row.id))}
										>
											✕
										</button>
									</>
								)}
							</div>
						</li>
					);
				})}
			</ol>
			<div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1">
				<button
					type="button"
					className="rounded px-1.5 py-0.5 text-[11px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
					data-testid="pattern-add"
					onClick={() => onChange(appendRow(rows))}
				>
					+ {t("settings.permissions.addPattern")}
				</button>
				<span className="text-[10px] text-ink-faint">{t("settings.permissions.orderHint")}</span>
			</div>
		</div>
	);
}
