import type { DailyDiscoveryState } from "@drone/shared";
import { useCallback, useEffect, useState } from "react";
import { getPi } from "../../api";
import { useKnowledgeStore } from "../../stores/knowledge";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";
import { useKnowledgeText } from "./copy";

/**
 * 知识库主页「新想法」：每日发现（默认开，每天一次）根据最近更新的笔记与相关旧笔记提出的想法。
 * 每条可存为想法笔记或忽略；开关与「现在运行」也在这里。
 */
/** 没有想法时说明原因：没绑定 / 没有新笔记（只扫 Library、Wiki、Projects）/ 读过但没想法 */
export function emptyReason(
	state: Pick<DailyDiscoveryState, "lastOutcome" | "lastError">,
	t: (key: "dailyEmpty" | "dailyNoNewNotes" | "dailyRanNoIdeas" | "dailyNotBound") => string,
): string {
	const outcome = state.lastError ? null : state.lastOutcome;
	if (outcome?.kind === "not-bound") return t("dailyNotBound");
	if (outcome?.kind === "no-new-notes")
		return t("dailyNoNewNotes").replace("{since}", new Date(outcome.since).toLocaleString());
	if (outcome?.kind === "ran" && outcome.added === 0)
		return t("dailyRanNoIdeas").replace("{notes}", String(outcome.notes));
	return t("dailyEmpty");
}

export function DailyIdeas({
	cwd,
	sessionId,
	bindingRevision,
}: {
	cwd: string | null;
	sessionId: string | null;
	bindingRevision: number;
}) {
	const t = useKnowledgeText();
	const revision = useKnowledgeStore((s) => s.revision);
	const [state, setState] = useState<DailyDiscoveryState | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			setState(await getPi().getDailyDiscovery());
		} catch (e) {
			setError(String((e as Error).message || e));
		}
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: revision 是刷新信号（知识库变化后重读）
	useEffect(() => {
		void load();
	}, [load, revision]);

	async function act(key: string, operation: () => Promise<DailyDiscoveryState>) {
		setBusy(key);
		setError(null);
		try {
			setState(await operation());
		} catch (e) {
			setError(String((e as Error).message || e));
		} finally {
			setBusy(null);
		}
	}

	if (!state) return null;
	const ideas = state.ideas.filter((idea) => idea.status !== "dismissed");
	return (
		<section aria-label={t("dailyTitle")} data-testid="daily-ideas">
			<div className="mb-2 flex flex-wrap items-center gap-2">
				<h3 className="text-xs font-semibold">{t("dailyTitle")}</h3>
				<span className="text-[11px] text-ink-faint">
					{state.lastRunAt
						? t("dailyLastRun").replace("{time}", new Date(state.lastRunAt).toLocaleString())
						: t("dailyNeverRun")}
				</span>
				<span className="ml-auto flex items-center gap-2 text-[11px] text-ink-dim">
					{t("dailyEnabled")}
					<Switch
						checked={state.enabled}
						onCheckedChange={(enabled) => void act("toggle", () => getPi().updateDailyDiscovery({ enabled }))}
					/>
				</span>
				<Button
					size="sm"
					disabled={busy !== null}
					onClick={() => void act("run", () => getPi().updateDailyDiscovery({ run: true }))}
				>
					{busy === "run" ? t("loading") : t("dailyRunNow")}
				</Button>
			</div>
			<p className="mb-2 text-[11px] leading-relaxed text-ink-faint">{t("dailyHint")}</p>
			{error && (
				<p role="alert" className="mb-2 break-words text-xs text-err">
					{error}
				</p>
			)}
			{!error && state.lastError && (
				<p role="status" className="mb-2 break-words text-[11px] text-err">
					{t("dailyFailed").replace("{error}", state.lastError)}
				</p>
			)}
			{ideas.length === 0 ? (
				<p className="text-[11px] text-ink-faint">{emptyReason(state, t)}</p>
			) : (
				<ul className="space-y-2">
					{ideas.map((idea) => (
						<li key={idea.id} className="rounded-xl border border-border p-3 text-xs">
							<div className="flex items-start gap-2">
								<p className="min-w-0 flex-1 font-medium">{idea.title}</p>
								<span className="shrink-0 rounded-full bg-hover px-2 py-0.5 text-[11px] text-warn">
									{t("dailySpeculative")}
								</span>
							</div>
							<p className="mt-1 leading-relaxed">{idea.idea}</p>
							<p className="mt-2 text-[11px] text-ink-dim">
								<span className="font-medium">{t("dailyBasis")}</span>{" "}
								{idea.basis.map((path, index) => (
									<span key={path}>
										{index > 0 && "、"}
										<button
											type="button"
											className="font-mono text-accent hover:underline"
											onClick={() =>
												useKnowledgeStore.getState().open({
													cwd,
													sessionId,
													tab: "reviews",
													note: path,
													noteRevision: bindingRevision,
												})
											}
										>
											{path}
										</button>
									</span>
								))}
							</p>
							<p className="mt-1 text-[11px] text-ink-dim">
								<span className="font-medium">{t("dailyTest")}</span> {idea.test}
							</p>
							{idea.whyOverlooked && <p className="mt-1 text-[11px] text-ink-faint">{idea.whyOverlooked}</p>}
							<div className="mt-2 flex gap-1">
								{idea.status === "saved" ? (
									<span className="text-[11px] text-ink-faint">
										{t("dailySaved")} {idea.savedPath}
									</span>
								) : (
									<>
										<Button
											size="sm"
											disabled={busy !== null}
											onClick={() =>
												void act(idea.id, () => getPi().decideDailyIdea({ id: idea.id, action: "save" }))
											}
										>
											{t("dailySave")}
										</Button>
										<Button
											size="sm"
											disabled={busy !== null}
											onClick={() =>
												void act(idea.id, () => getPi().decideDailyIdea({ id: idea.id, action: "dismiss" }))
											}
										>
											{t("dailyDismiss")}
										</Button>
									</>
								)}
							</div>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
