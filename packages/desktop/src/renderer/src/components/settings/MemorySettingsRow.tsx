import type { MemoryListItem, MemoryProjectStatus } from "@drone/shared";
import { useCallback, useEffect, useState } from "react";
import { useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { Switch } from "../ui/Switch";
import { SettingsRow } from "./SettingsRow";

const BTN =
	"rounded-md border border-border px-2 py-1 text-[11px] text-ink-2 transition-colors hover:border-border-strong hover:bg-hover disabled:opacity-50";

/** 当前项目的观察记忆：开关 + 清空 + 记录列表（删除 / 提升为项目记忆）。展示层，便于样张与测试直接渲染。 */
export function MemorySettingsView({
	status,
	onToggle,
	onClear,
	items,
	onToggleList,
	onRemove,
	onPromote,
}: {
	status: MemoryProjectStatus | null;
	onToggle: (enabled: boolean) => void;
	onClear: () => void;
	/** null = 列表收起。 */
	items?: MemoryListItem[] | null;
	onToggleList?: () => void;
	onRemove?: (id: number) => void;
	onPromote?: (id: number) => void;
}) {
	const t = useT();
	return (
		<>
			<SettingsRow
				title={t("settings.memory.title")}
				hint={t("settings.memory.hint", { count: status?.count ?? 0 })}
			>
				<div className="flex items-center gap-2" data-testid="memory-settings">
					{onToggleList ? (
						<button type="button" className={BTN} disabled={!status?.count} onClick={onToggleList}>
							{t(items ? "settings.memory.hide" : "settings.memory.view")}
						</button>
					) : null}
					<button type="button" className={BTN} disabled={!status?.count} onClick={onClear}>
						{t("settings.memory.clear")}
					</button>
					<Switch checked={status?.enabled === true} disabled={status === null} onCheckedChange={onToggle} />
				</div>
			</SettingsRow>
			{items ? (
				<ul
					className="scroll-fade mb-2 max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border"
					data-testid="memory-list"
				>
					{items.map((item) => (
						<li key={item.id} className="flex items-start gap-2 px-3 py-2 text-[12px]">
							<span className="shrink-0 rounded bg-hover px-1.5 py-0.5 text-[10px] text-ink-faint">
								{item.kind}
							</span>
							<div className="min-w-0 flex-1">
								<div className="truncate text-ink" title={item.title}>
									{item.title}
								</div>
								{item.body ? <div className="truncate text-[11px] text-ink-faint">{item.body}</div> : null}
								<div className="text-[10px] text-ink-faint">{new Date(item.createdAt).toLocaleString()}</div>
							</div>
							<button
								type="button"
								className={BTN}
								title={t("settings.memory.promoteHint")}
								onClick={() => onPromote?.(item.id)}
							>
								{t("settings.memory.promote")}
							</button>
							<button type="button" className={BTN} onClick={() => onRemove?.(item.id)}>
								{t("settings.memory.remove")}
							</button>
						</li>
					))}
					{items.length === 0 ? (
						<li className="px-3 py-2 text-[12px] text-ink-faint">{t("settings.memory.empty")}</li>
					) : null}
				</ul>
			) : null}
		</>
	);
}

export function MemorySettingsRow() {
	const cwd = useSessionsStore((s) => s.cwd);
	const [status, setStatus] = useState<MemoryProjectStatus | null>(null);
	const [items, setItems] = useState<MemoryListItem[] | null>(null);
	useEffect(() => {
		if (!cwd) return;
		let live = true;
		setItems(null);
		void window.pi.memoryGetStatus(cwd).then((next) => live && setStatus(next));
		return () => {
			live = false;
		};
	}, [cwd]);
	const refresh = useCallback(
		(next: MemoryProjectStatus) => {
			setStatus(next);
			if (cwd) void window.pi.memoryList(cwd).then((list) => setItems((open) => (open ? list : open)));
		},
		[cwd],
	);
	if (!cwd) return null;
	return (
		<MemorySettingsView
			status={status}
			items={items}
			onToggle={(enabled) => void window.pi.memorySetEnabled(cwd, enabled).then(setStatus)}
			onClear={() => void window.pi.memoryClear(cwd).then(refresh)}
			onToggleList={() =>
				items ? setItems(null) : void window.pi.memoryList(cwd).then((list) => setItems(list))
			}
			onRemove={(id) => void window.pi.memoryRemove(cwd, id).then(refresh)}
			onPromote={(id) => void window.pi.memoryPromote(cwd, id).then(refresh)}
		/>
	);
}
