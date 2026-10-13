import { groupRunningFirst } from "@drone/shared";
import { useMemo } from "react";
import { useT } from "../../i18n";
import { useAskCountsStore } from "../../stores/ask-counts";
import { deriveSessions, useProjectsStore } from "../../stores/projects";
import { useSessionsStore } from "../../stores/sessions";
import { useTranscriptStore } from "../../stores/transcript";
import { useUiStore } from "../../stores/ui";
import { PlusIcon } from "../icons";
import { groupByDate } from "./date-groups";
import { SessionRow } from "./SessionRow";

const GROUP_LABELS = {
	today: "projects.today",
	yesterday: "projects.yesterday",
	earlier: "projects.earlier",
} as const;

/** 右侧会话面板：新会话按钮 + 按日期分组的会话列表 */
export function SessionPanel() {
	const t = useT();
	const selectedCwd = useProjectsStore((s) => s.selectedCwd);
	const search = useProjectsStore((s) => s.search);
	const allSessions = useProjectsStore((s) => s.allSessions);
	const sessions = useMemo(
		() => deriveSessions({ allSessions, selectedCwd, search }),
		[allSessions, selectedCwd, search],
	);
	const createDraftSession = useSessionsStore((s) => s.createDraftSession);
	const setView = useUiStore((s) => s.setView);

	// P14 侧栏「进行中」：运行中 / 等待输入的会话置顶，结束后回到日期分组
	const activeIds = useTranscriptStore((s) =>
		Object.entries(s.bySession)
			.filter(([, e]) => e?.agentActive)
			.map(([id]) => id)
			.sort()
			.join("|"),
	);
	const askCounts = useAskCountsStore((s) => s.bySession);
	const { running, rest } = useMemo(() => {
		const active = new Set(activeIds ? activeIds.split("|") : []);
		return groupRunningFirst(sessions, (m) => active.has(m.sessionId) || (askCounts[m.sessionId] ?? 0) > 0);
	}, [sessions, activeIds, askCounts]);
	const groups = groupByDate(rest);

	const newSession = () => {
		if (!selectedCwd) return;
		// draft tab：发送首条消息时才真正创建，期间仍可在空态切换项目
		createDraftSession(selectedCwd);
		setView("chat");
	};

	return (
		<div className="project-sessions flex min-w-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center justify-end px-5 pt-3">
				<button
					type="button"
					className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-ink-2 transition-colors hover:bg-hover disabled:opacity-40"
					onClick={newSession}
					disabled={!selectedCwd}
				>
					<PlusIcon />
					{t("projects.newSession")}
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
				{sessions.length === 0 && (
					<p className="py-10 text-center text-[13px] text-ink-faint">{t("projects.noSessions")}</p>
				)}
				{running.length > 0 && (
					<div data-testid="sessions-running">
						<h3 className="pt-4 pb-2 text-[13px] font-medium text-ink-dim">{t("projects.running")}</h3>
						<ul className="flex flex-col gap-0.5">
							{running.map((session) => (
								<SessionRow
									key={session.sessionId}
									session={session}
									live={(askCounts[session.sessionId] ?? 0) > 0 ? "awaiting" : "running"}
								/>
							))}
						</ul>
					</div>
				)}
				{groups.map((group) => (
					<div key={group.key}>
						<h3 className="pt-4 pb-2 text-[13px] font-medium text-ink-dim">{t(GROUP_LABELS[group.key])}</h3>
						<ul className="flex flex-col gap-0.5">
							{group.sessions.map((session) => (
								<SessionRow key={session.sessionId} session={session} />
							))}
						</ul>
					</div>
				))}
			</div>
		</div>
	);
}
