import { exampleTaskForDirection } from "@drone/shared";
import { useEffect, useMemo, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { useExampleTaskStore } from "../../stores/example-tasks";
import { type FirstRunStatus, probeFirstRunStatus } from "./first-run-status";

function CardIllustration({ kind }: { kind: "research" | "knowledge" | "relay" }) {
	if (kind === "research")
		return (
			<svg aria-hidden="true" viewBox="0 0 88 42" className="h-10 w-20 opacity-80">
				<path d="M4 34 23 22l14 7 18-19 29 8" fill="none" stroke="currentColor" strokeWidth="2" />
				{[
					[4, 34],
					[23, 22],
					[37, 29],
					[55, 10],
					[84, 18],
				].map(([cx, cy]) => (
					<circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3" fill="currentColor" />
				))}
			</svg>
		);
	if (kind === "knowledge")
		return (
			<svg aria-hidden="true" viewBox="0 0 88 42" className="h-10 w-20 opacity-80">
				<path d="M17 9h43l11 7v21H17z" fill="none" stroke="currentColor" strokeWidth="2" />
				<path d="M60 9v8h11M27 20h31M27 27h23" fill="none" stroke="currentColor" strokeWidth="2" />
			</svg>
		);
	return (
		<svg aria-hidden="true" viewBox="0 0 88 42" className="h-10 w-20 opacity-80">
			<path d="M16 21a15 15 0 0 1 25-11l5 5M72 21a15 15 0 0 1-25 11l-5-5" fill="none" stroke="currentColor" strokeWidth="2" />
			<path d="m39 10 7 5-7 5M49 22l-7 5 7 5" fill="none" stroke="currentColor" strokeWidth="2" />
			</svg>
	);
}

/** U8b：首页三条主线卡——研究（聚焦输入框）/ 知识库（打开）/ 接力（回到最近任务）。 */
export function HomeCards() {
	const t = useT();
	const cwd = useSessionsStore((s) => s.cwd);
	const sessions = useSessionsStore((s) => s.sessions);
	const recent = [...sessions].sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0))[0];
	const [status, setStatus] = useState<FirstRunStatus | null>(null);
	useEffect(() => {
		let live = true;
		void probeFirstRunStatus(getPi(), cwd).then((next) => {
			if (live) setStatus(next);
		});
		return () => {
			live = false;
		};
	}, [cwd]);
	const example = useMemo(() => exampleTaskForDirection("evidence"), []);
	const setupCard = (key: "research" | "knowledge") => {
		if (key === "knowledge" && status && !status.knowledge) return "knowledge" as const;
		if (key === "research" && status && !status.zotero) return "zotero" as const;
		if (key === "research" && status && !status.compute) return "compute" as const;
		return null;
	};
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
				<article
					key={card.key}
					className={`flex min-h-28 flex-col justify-between rounded-2xl px-4 py-3 text-left transition-opacity ${card.tone} ${"disabled" in card && card.disabled ? "opacity-50" : ""}`}
				>
					<button type="button" disabled={"disabled" in card ? card.disabled : false} onClick={card.onClick} className="flex flex-1 flex-col justify-between text-left disabled:cursor-default">
						<span className="flex items-start justify-between gap-2">
							<span className="font-serif-sc text-[17px]">{t(`home.cards.${card.key}.title`)}</span>
							<CardIllustration kind={card.key} />
						</span>
						<span className="text-[12px] opacity-75">{t(`home.cards.${card.key}.hint`)}</span>
					</button>
					{(card.key === "research" || card.key === "knowledge") && setupCard(card.key) ? (
						<button
							type="button"
							className="mt-2 self-start text-[11px] font-medium underline decoration-current/40 underline-offset-2 hover:opacity-80"
							onClick={() => useSettingsStore.getState().openWith(setupCard(card.key) as "knowledge" | "zotero" | "compute")}
						>
							{t("home.cards.setup")}
						</button>
					) : null}
					{card.key === "research" && example ? (
						<button
							type="button"
							className="mt-1 self-start text-[11px] opacity-70 hover:opacity-100"
							onClick={() => useExampleTaskStore.getState().open(example.id)}
						>
							{t("home.cards.example")}
						</button>
					) : null}
				</article>
			))}
		</div>
	);
}
