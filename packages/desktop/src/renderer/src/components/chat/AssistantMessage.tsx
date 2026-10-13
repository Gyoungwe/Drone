import { useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import type { UIToolCall } from "../../stores/transcript";
import { Markdown } from "./Markdown";
import { MemoryCitationRow } from "./MemoryCitationRow";
import { MetaGroup, type MetaItem } from "./MetaGroup";
import { memoryCitations } from "./memory-citations";

/** 助手消息体：元数据（思考/工具，折叠）+ Markdown 正文 + 打字指示器 */
export function AssistantMessage({
	text,
	thinking,
	tools,
	streaming,
	metaInGroup = false,
}: {
	text: string;
	thinking: string;
	tools: UIToolCall[];
	streaming?: boolean;
	/** 思考/工具已并入上方合并组（MessageList 合并模式），不再自行包裹 */
	metaInGroup?: boolean;
}) {
	const t = useT();
	const model = useSessionsStore((s) => s.currentModel);
	const cited = streaming ? [] : memoryCitations(text, tools);
	const items: MetaItem[] = [];
	if (!metaInGroup && (thinking || tools.length > 0)) items.push({ thinking, tools });

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2 text-[11px] text-ink-faint" data-testid="assistant-header">
				<span
					className="grid h-5 w-5 place-items-center rounded-full bg-ink text-[10px] text-on-ink"
					aria-hidden="true"
				>
					✦
				</span>
				<span className="font-medium text-ink-2">{model?.modelId ?? t("message.assistant")}</span>
				<span aria-hidden="true">·</span>
				<span className="tabular-nums">
					{t("message.stepsSummary", { count: tools.length + (thinking ? 1 : 0) })}
				</span>
			</div>
			{items.length > 0 && <MetaGroup items={items} working={Boolean(streaming) && !text} />}
			{text && <Markdown text={text} streaming={streaming} />}
			{cited.length > 0 && (
				<MemoryCitationRow ids={cited} label={t("message.memoryUsed", { count: cited.length })} />
			)}
			{streaming && !text && !thinking && tools.length === 0 && (
				<div className="flex items-center gap-1 text-ink-faint">
					<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint" />
					<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint [animation-delay:150ms]" />
					<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint [animation-delay:300ms]" />
				</div>
			)}
		</div>
	);
}
