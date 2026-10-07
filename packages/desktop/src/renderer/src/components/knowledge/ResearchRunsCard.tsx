import type { ResearchRunDetail, ResearchRunListItem } from "@drone/shared";
import { useEffect, useState } from "react";
import { getPi } from "../../api";
import { useKnowledgeText } from "./copy";
import { KnowledgeNoteViewer } from "./KnowledgeNoteViewer";

function stateTone(state: string): string {
	if (state === "complete") return "border-ok/30 bg-ok/5 text-ok";
	if (state === "active") return "border-accent/40 bg-accent/8 text-accent";
	if (state === "blocked") return "border-err/30 bg-err/5 text-err";
	return "border-border bg-hover text-ink-dim";
}

export function ResearchRunsCard({
	cwd,
	project,
	revision = 0,
}: {
	cwd: string | null;
	project: string | null;
	revision?: number;
}) {
	const t = useKnowledgeText();
	const [runs, setRuns] = useState<ResearchRunListItem[]>([]);
	const [selected, setSelected] = useState<ResearchRunDetail | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [sourcePath, setSourcePath] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		if (!cwd) {
			setRuns([]);
			setSelected(null);
			setSourcePath(null);
			return;
		}
		setLoading(true);
		setError(null);
		void getPi()
			.getResearchRuns({ cwd, project, limit: 8 })
			.then(async (result) => {
				if (cancelled) return;
				setRuns(result.items);
				if (!result.items.length) {
					setSelected(null);
					return;
				}
				const current = result.items.find((item) => item.runId === selected?.runId) ?? result.items.at(0);
				if (!current) return;
				const detail = await getPi().getResearchRun({ cwd, runId: current.runId });
				if (!cancelled) setSelected(detail);
			})
			.catch((reason) => {
				if (!cancelled) setError(String((reason as Error)?.message || reason));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [cwd, project, selected?.runId]);

	async function select(run: ResearchRunListItem) {
		if (!cwd) return;
		setError(null);
		try {
			setSelected(await getPi().getResearchRun({ cwd, runId: run.runId }));
		} catch (reason) {
			setError(String((reason as Error)?.message || reason));
		}
	}

	return (
		<section className="rounded-xl border border-border p-4" data-testid="research-runs-card">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h3 className="text-xs font-semibold">{t("researchRuns")}</h3>
					<p className="mt-1 text-[11px] text-ink-dim">{t("researchRunsHint")}</p>
				</div>
				{selected && (
					<span className="rounded-full bg-hover px-2 py-0.5 text-[11px] text-ink-dim">
						{selected.answerable ? t("researchAnswerable") : t("researchInProgress")}
					</span>
				)}
			</div>
			{loading && <p className="mt-3 text-xs text-ink-dim">{t("researchRunsLoading")}</p>}
			{error && <p className="mt-3 break-words text-xs text-err">{error}</p>}
			{!loading && !runs.length && <p className="mt-3 text-xs text-ink-dim">{t("researchRunsEmpty")}</p>}
			{runs.length > 0 && (
				<div className="mt-3 grid gap-3 lg:grid-cols-[minmax(180px,0.35fr)_minmax(0,1fr)]">
					<div className="space-y-1">
						{runs.map((run) => (
							<button
								key={run.runId}
								type="button"
								onClick={() => void select(run)}
								className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${selected?.runId === run.runId ? "border-accent bg-accent/5" : "border-border hover:bg-hover"}`}
							>
								<div className="flex items-center justify-between gap-2">
									<span className="truncate font-medium">{run.resultSlug}</span>
									<span className="text-[10px] text-ink-faint">{run.stage}</span>
								</div>
								<p className="mt-1 line-clamp-2 text-[11px] text-ink-dim">{run.query || run.runId}</p>
							</button>
						))}
					</div>
					{selected && (
						<div className="min-w-0">
							<div className="rounded-lg bg-hover px-3 py-2 text-xs">
								<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
									<strong>{selected.runId}</strong>
									<span className="text-ink-dim">{selected.status}</span>
									<span className="text-ink-dim">
										{t("researchArchive")}: {selected.archive.count + selected.archive.reused}
									</span>
									<span className="text-ink-dim">
										{t("researchIntegrity")}:{" "}
										{selected.integrity
											? `${selected.integrity.verified}/${selected.integrity.checked}`
											: t("researchCoverageUnknown")}
									</span>
								</div>
								<p className="mt-1 text-ink-dim">{selected.query}</p>
							</div>
							<div className="mt-3 flex gap-1 overflow-x-auto pb-1">
								{selected.route.map((node) => (
									<div
										key={node.key}
										className={`min-w-[92px] rounded-lg border px-2 py-2 ${stateTone(node.state)}`}
									>
										<p className="text-[11px] font-medium">{node.label}</p>
										<p className="mt-1 text-[10px] opacity-80">{node.state}</p>
									</div>
								))}
							</div>
							<p className="mt-2 text-[11px] text-ink-dim">{t("researchRouteHint")}</p>
							{selected.gaps && selected.gaps.length > 0 && (
								<div className="mt-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-[11px] text-warn">
									<span className="font-medium">{t("researchGaps")}: </span>
									{selected.gaps.join(" · ")}
								</div>
							)}
							{selected.governance &&
								(selected.governance.duplicateSources.length > 0 ||
									selected.governance.staleSources.length > 0 ||
									selected.governance.unavailableSources.length > 0) && (
									<p className="mt-2 text-[11px] text-warn">
										{t("researchGovernance")}: {selected.governance.duplicateSources.length}{" "}
										{t("researchDuplicates")}, {selected.governance.staleSources.length} {t("researchStale")},{" "}
										{selected.governance.unavailableSources.length} {t("researchUnavailable")}
									</p>
								)}
							{selected.timeline && selected.timeline.length > 0 && (
								<details className="mt-2 text-[11px]">
									<summary className="cursor-pointer font-medium">
										{t("researchTimeline")} ({selected.timeline.length})
									</summary>
									<ol className="mt-2 space-y-1 border-l border-border pl-3">
										{selected.timeline.slice(-12).map((event) => (
											<li
												key={`${event.at || "event"}-${event.type}`}
												className={event.status === "failed" ? "text-err" : "text-ink-dim"}
											>
												<span className="font-medium">{event.type}</span>
												{event.detail ? ` · ${event.detail}` : ""}
											</li>
										))}
									</ol>
								</details>
							)}
							<div className="mt-3 grid gap-2 sm:grid-cols-3">
								<div className="rounded-lg border border-border px-3 py-2 text-xs">
									<span className="text-ink-dim">{t("researchSources")}</span>
									<strong className="ml-2">{selected.sources.length}</strong>
								</div>
								<div className="rounded-lg border border-border px-3 py-2 text-xs">
									<span className="text-ink-dim">{t("researchClaims")}</span>
									<strong className="ml-2">{selected.claims.length}</strong>
								</div>
								<div className="rounded-lg border border-border px-3 py-2 text-xs">
									<span className="text-ink-dim">{t("researchCoverage")}</span>
									<strong className="ml-2">
										{selected.coverage ? t("researchCoverageRecorded") : t("researchCoverageUnknown")}
									</strong>
								</div>
							</div>
							{selected.warnings.length > 0 && (
								<p className="mt-2 text-[11px] text-warn">{selected.warnings.join(" · ")}</p>
							)}
							{selected.sources.length > 0 && (
								<div className="mt-2 space-y-1 text-[11px]">
									<p className="text-ink-dim">{t("researchSourceList")}</p>
									{selected.sources.slice(0, 8).map((source) => (
										<button
											key={source.path}
											type="button"
											onClick={() => setSourcePath(source.path)}
											className="block max-w-full truncate text-left text-accent hover:underline"
										>
											{source.verified ? "✓" : "!"} {source.path}
										</button>
									))}
								</div>
							)}
							{selected.claims.length > 0 && (
								<ul className="mt-2 space-y-1 text-[11px] text-ink-dim">
									{selected.claims.slice(0, 6).map((claim) => (
										<li key={claim.id || claim.claim}>
											<span className="font-medium">[{claim.relationship || claim.status}]</span>{" "}
											{claim.claim}
											{claim.limitations ? (
												<span className="text-ink-faint"> · {claim.limitations}</span>
											) : null}
										</li>
									))}
								</ul>
							)}
							{selected.provenance && (
								<div className="mt-3 rounded-lg border border-border px-3 py-2 text-[11px]">
									<span className="text-ink-dim">{t("researchProvenance")}: </span>
									<span>{selected.provenance.status}</span>
									{selected.provenance.limitations.length > 0 && (
										<span className="ml-2 text-ink-faint">{selected.provenance.limitations.join(" · ")}</span>
									)}
								</div>
							)}
							{sourcePath && revision > 0 && (
								<div className="mt-3">
									<KnowledgeNoteViewer
										cwd={cwd}
										revision={revision}
										path={sourcePath}
										onClose={() => setSourcePath(null)}
									/>
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</section>
	);
}
