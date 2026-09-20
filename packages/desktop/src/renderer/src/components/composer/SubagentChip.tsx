import type { SubagentPanelSource } from "@drone/shared";
import { useT } from "../../i18n";
import { SubagentAvatar } from "../chat/SubagentAvatar";
import { CloseIcon } from "../icons";

/**
 * @ 子智能体胶囊：输入框行首的「收件人」——头像 + 名称，强调色底；其后的正文即任务。
 * 不可拆分：× / Esc / 空文本 Backspace 都整枚撤销并把 `@name ` 拼回文本（与 slash 胶囊同一恢复语义）。
 */
export function SubagentChip({
	name,
	source,
	onRemove,
}: {
	name: string;
	source?: SubagentPanelSource;
	onRemove: () => void;
}) {
	const t = useT();
	return (
		<span
			className="mt-0.5 flex shrink-0 select-none items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 text-[12px] font-semibold leading-5 text-accent"
			data-testid="composer-subagent-chip"
			data-agent={name}
			title={t("composer.subagentChipTitle", { agent: name })}
		>
			<SubagentAvatar name={name} source={source} size="sm" state="idle" />
			<span className="max-w-[160px] truncate">{name}</span>
			<button
				type="button"
				aria-label={t("composer.removeSubagent")}
				onClick={onRemove}
				className="shrink-0 text-accent/60 transition-colors hover:text-accent"
			>
				<CloseIcon size={8} />
			</button>
		</span>
	);
}
