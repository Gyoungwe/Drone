import {
	exampleTaskForDirection,
	groupRunningFirst,
	type KnowledgeOverview,
	type SessionMeta,
} from "@drone/shared";
import { useEffect, useMemo, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { useExampleTaskStore } from "../../stores/example-tasks";
import { useKnowledgeStore } from "../../stores/knowledge";
import { deriveProjects, useProjectsStore } from "../../stores/projects";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { useTranscriptStore } from "../../stores/transcript";
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
			<path
				d="M16 21a15 15 0 0 1 25-11l5 5M72 21a15 15 0 0 1-25 11l-5-5"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			/>
			<path d="m39 10 7 5-7 5M49 22l-7 5 7 5" fill="none" stroke="currentColor" strokeWidth="2" />
		</svg>
	);
}

function displayCount(value: number | undefined | null): string {
	return value == null ? "—" : String(value);
}

export function weekStart(now = new Date()): number {
	const date = new Date(now);
	date.setHours(0, 0, 0, 0);
	const day = date.getDay();
	const offset = day === 0 ? 6 : day - 1;
	date.setDate(date.getDate() - offset);
	return date.getTime();
}

export function countWeeklyDeposits(
	history: NonNullable<KnowledgeOverview["wikiHistory"]> | undefined,
	now = new Date(),
): number | undefined {
	if (!history) return undefined;
	const since = weekStart(now);
	return history.filter((entry) => entry.reviewedAt >= since).length;
}

export function pickUnfinishedSession(
	sessions: SessionMeta[],
	activeIds: readonly string[],
): SessionMeta | undefined {
	const active = new Set(activeIds);
	return sessions.find((session) => active.has(session.sessionId));
}

/** UI-7：首页科研工作台摘要。所有摘要都来自现有 store/IPC，缺数据时保持未知。 */
export function HomeCards() {
	const t = useT();
	const cwd = useSessionsStore((s) => s.cwd);
	const sessions = useSessionsStore((s) => s.sessions);
	const allSessions = useProjectsStore((s) => s.allSessions);
	const addedProjects = useProjectsStore((s) => s.addedProjects);
	const projectsLoaded = useProjectsStore((s) => s.loaded);
	const loadProjects = useProjectsStore((s) => s.load);
	const [status, setStatus] = useState<FirstRunStatus | null>(null);
	const [overview, setOverview] = useState<KnowledgeOverview | null>(null);
	const [overviewLoading, setOverviewLoading] = useState(false);

	useEffect(() => {
		if (!projectsLoaded) void loadProjects();
	}, [loadProjects, projectsLoaded]);

	useEffect(() => {
		let live = true;
		void probeFirstRunStatus(getPi(), cwd).then((next) => {
			if (live) setStatus(next);
		});
		return () => {
			live = false;
		};
	}, [cwd]);

	useEffect(() => {
		let live = true;
		setOverviewLoading(true);
		void getPi()
			.getKnowledgeOverview({ cwd })
			.then((next) => {
				if (live) setOverview(next);
			})
			.catch(() => {
				if (live) setOverview(null);
			})
			.finally(() => {
				if (live) setOverviewLoading(false);
			});
		return () => {
			live = false;
		};
	}, [cwd]);

	const activeIds = useTranscriptStore((s) =>
		Object.entries(s.bySession)
			.filter(([, entry]) => entry?.agentActive)
			.map(([id]) => id)
			.sort()
			.join("|"),
	);
	const projects = useMemo(
		() => deriveProjects({ allSessions, addedProjects }),
		[addedProjects, allSessions],
	);
	const recentSessions = useMemo(() => {
		const active = new Set(activeIds ? activeIds.split("|") : []);
		const sorted = allSessions
			.filter((session) => session.sessionFile)
			.sort((a, b) => (b.modifiedAt ?? b.createdAt) - (a.modifiedAt ?? a.createdAt));
		const grouped = groupRunningFirst(sorted, (session) => active.has(session.sessionId));
		return [...grouped.running, ...grouped.rest];
	}, [activeIds, allSessions]);
	const openSessions = useMemo(
		() =>
			[...sessions]
				.filter((session) => session.sessionFile)
				.sort((a, b) => (b.modifiedAt ?? b.createdAt) - (a.modifiedAt ?? a.createdAt)),
		[sessions],
	);
	const recent = recentSessions[0] ?? openSessions[0];
	const unfinished = useMemo(
		() => pickUnfinishedSession(recentSessions, activeIds ? activeIds.split("|") : []),
		[activeIds, recentSessions],
	);

	const weeklyDeposits = useMemo(() => countWeeklyDeposits(overview?.wikiHistory), [overview]);
	const setupCard = (key: "research" | "knowledge") => {
		if (key === "knowledge" && status && !status.knowledge) return "knowledge" as const;
		if (key === "research" && status && !status.zotero) return "zotero" as const;
		if (key === "research" && status && !status.compute) return "compute" as const;
		return null;
	};
	const cards = [
		{
			key: "research" as const,
			tone: "border border-border bg-surface text-ink shadow-[0_12px_30px_-24px_rgba(15,23,42,0.45)]",
			onClick: () =>
				(document.querySelector('[data-testid="composer-input"]') as HTMLElement | null)?.focus(),
			metric: projects.length ? t("home.cards.research.projects", { count: projects.length }) : undefined,
		},
		{
			key: "knowledge" as const,
			tone: "border border-border bg-surface text-ink shadow-[0_12px_30px_-24px_rgba(15,23,42,0.45)]",
			onClick: () => useKnowledgeStore.getState().open({ cwd, sessionId: null, tab: "reviews" }),
			metric: overviewLoading
				? t("home.cards.loading")
				: t("home.cards.knowledge.metrics", {
						notes: displayCount(overview?.index?.noteCount),
						deposits: displayCount(weeklyDeposits),
						pending: displayCount(overview?.index?.pendingChanges),
					}),
		},
		{
			key: "relay" as const,
			tone: "border border-border bg-hover text-ink shadow-[0_12px_30px_-24px_rgba(15,23,42,0.45)]",
			disabled: !recent,
			onClick: () => recent && void useProjectsStore.getState().openSession(recent),
			metric: unfinished
				? t("home.cards.relay.unfinished", { task: unfinished.name ?? t("home.untitled") })
				: recent
					? t("home.cards.relay.recent", { task: recent.name ?? t("home.untitled") })
					: t("home.cards.relay.none"),
		},
	] as const;

	return (
		<div className="w-full max-w-[900px] space-y-4" data-testid="home-cards">
			<div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
				{cards.map((card) => (
					<article
						key={card.key}
						className={`flex min-h-32 flex-col justify-between rounded-2xl px-4 py-3 text-left transition-opacity ${card.tone} ${"disabled" in card && card.disabled ? "opacity-50" : ""}`}
					>
						<button
							type="button"
							disabled={"disabled" in card ? card.disabled : false}
							onClick={card.onClick}
							className="flex flex-1 flex-col justify-between text-left disabled:cursor-default"
						>
							<span className="flex items-start justify-between gap-2">
								<span className="font-serif-sc text-[17px]">{t(`home.cards.${card.key}.title`)}</span>
								<CardIllustration kind={card.key} />
							</span>
							<span className="text-[12px] opacity-75">{t(`home.cards.${card.key}.hint`)}</span>
							{card.metric && <span className="mt-2 text-[11px] font-medium opacity-90">{card.metric}</span>}
						</button>
						{(card.key === "research" || card.key === "knowledge") && setupCard(card.key) ? (
							<button
								type="button"
								className="mt-2 self-start text-[11px] font-medium underline decoration-current/40 underline-offset-2 hover:opacity-80"
								onClick={() =>
									useSettingsStore
										.getState()
										.openWith(setupCard(card.key) as "knowledge" | "zotero" | "compute")
								}
							>
								{t("home.cards.setup")}
							</button>
						) : null}
						{card.key === "research" && (
							<button
								type="button"
								className="mt-1 self-start text-[11px] opacity-70 hover:opacity-100"
								onClick={() => {
									const example = exampleTaskForDirection("evidence");
									if (example) useExampleTaskStore.getState().open(example.id);
								}}
							>
								{t("home.cards.example")}
							</button>
						)}
					</article>
				))}
			</div>
		</div>
	);
}
