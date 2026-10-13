import { useT } from "../../i18n";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";

/** U8b：首页三条主线卡——研究（聚焦输入框）/ 知识库（打开）/ 接力（回到最近任务）。 */
export function HomeCards() {
	const t = useT();
	const cwd = useSessionsStore((s) => s.cwd);
	const sessions = useSessionsStore((s) => s.sessions);
	const recent = [...sessions].sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0))[0];
	const cards = [
		{
			key: "research",
			tone: "bg-ink text-on-ink",
			onClick: () =>
				(document.querySelector('[data-testid="composer-input"]') as HTMLElement | null)?.focus(),
		},
		{
			key: "knowledge",
			tone: "bg-hover text-ink",
			onClick: () => useKnowledgeStore.getState().open({ cwd, sessionId: null, tab: "reviews" }),
		},
		{
			key: "relay",
			tone: "bg-[var(--chip-accent)] text-ink",
			disabled: !recent,
			onClick: () => recent && useSessionsStore.getState().switchSession(recent.sessionId),
		},
	] as const;
	return (
		<div className="grid w-full max-w-[720px] grid-cols-3 gap-3" data-testid="home-cards">
			{cards.map((card) => (
				<button
					key={card.key}
					type="button"
					disabled={"disabled" in card ? card.disabled : false}
					onClick={card.onClick}
					className={`flex min-h-24 flex-col justify-between rounded-2xl px-4 py-3 text-left transition-opacity hover:opacity-90 disabled:opacity-50 ${card.tone}`}
				>
					<span className="font-serif-sc text-[17px]">{t(`home.cards.${card.key}.title`)}</span>
					<span className="text-[12px] opacity-75">{t(`home.cards.${card.key}.hint`)}</span>
				</button>
			))}
		</div>
	);
}
