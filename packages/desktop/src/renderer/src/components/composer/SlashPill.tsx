import { useI18nStore, useT } from "../../i18n";
import { CloseIcon } from "../icons";
import { slashPillView } from "./slash-pill";

/**
 * / 命令胶囊：正文首行的行内 token（强调色浅底、无阴影、无边框），高度 = 正文行高，与文字同一行居中。
 * skill 显示产品名（无则裸名，如 nature-figure），前缀淡色 `/` 表明是命令；悬停显示实际发送的完整命令。
 * × / Esc / 光标在最前时 Backspace 都整枚撤销并把 `/cmd ` 拼回文本（恢复语义不变）。
 */
export function SlashPill({ name, onRemove }: { name: string; onRemove: () => void }) {
	const t = useT();
	const language = useI18nStore((s) => s.language);
	const view = slashPillView(name, language);
	return (
		<span
			className="inline-flex h-[22px] max-w-[220px] shrink-0 select-none items-center gap-1 rounded-md bg-accent/10 pr-1 pl-1.5 text-[12.5px] leading-none font-medium text-accent"
			data-testid="composer-slash-pill"
			data-command={name}
			title={t("slash.pillTitle", { command: view.command })}
		>
			{view.isSkill && (
				<span aria-hidden="true" className="text-accent/60">
					/
				</span>
			)}
			<span className="min-w-0 truncate">{view.label}</span>
			<button
				type="button"
				aria-label={t("slash.removePill")}
				onClick={onRemove}
				className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-accent/60 transition-colors hover:bg-accent/15 hover:text-accent"
			>
				<CloseIcon size={8} />
			</button>
		</span>
	);
}
