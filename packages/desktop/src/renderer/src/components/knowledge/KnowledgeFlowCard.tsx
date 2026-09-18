import type { KnowledgeReadRecord } from "@drone/shared";
import { useEffect, useState } from "react";
import { getPi } from "../../api";
import { useKnowledgeStore } from "../../stores/knowledge";
import { isDraftSessionId, useSessionsStore } from "../../stores/sessions";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";
import { useUiStore } from "../../stores/ui";
import { Button } from "../ui/Button";
import { mergeKnowledgeArtifacts } from "./artifacts";
import { type knowledgeZh, useKnowledgeText } from "./copy";
import { reportKnowledgeError } from "./hooks";
import { KnowledgeNoteViewer } from "./KnowledgeNoteViewer";

const phases: Record<string, keyof typeof knowledgeZh> = {
	"setup-complete": "setupComplete",
	preparing: "preparing",
	navigation: "navigationPhase",
	"reading-wiki": "readingWiki",
	searching: "searching",
	"reading-evidence": "readingEvidence",
	checking: "checking",
	released: "released",
	"no-hits": "noHits",
	blocked: "blocked",
	unconfigured: "unconfigured",
	"evidence-only": "evidenceOnly",
	interrupted: "interrupted",
};
export function KnowledgeFlowCard({ sessionId }: { sessionId: string | null }) {
	const t = useKnowledgeText(),
		cwd = useSessionsStore((s) => s.cwd);
	const flow = useKnowledgeStore((s) => (sessionId ? s.flows[sessionId] : undefined));
	const transcript = useTranscriptStore((s) => selectTranscript(s, sessionId));
	const latest = [...transcript.messages].reverse().find((m) => m.kind === "assistant" && m.taskView);
	const artifacts = mergeKnowledgeArtifacts(
		flow?.artifacts || [],
		latest?.kind === "assistant" ? latest.taskView?.tasks || [] : [],
		cwd || "",
	);
	const [open, setOpen] = useState(false),
		[path, setPath] = useState<string | null>(null),
		[resuming, setResuming] = useState(false);
	useEffect(() => {
		setOpen(false);
		setPath(null);
		setResuming(false);
		if (!sessionId || isDraftSessionId(sessionId)) return;
		let live = true;
		void getPi()
			.getKnowledgeOverview({ cwd, sessionId })
			.then((value) => {
				if (live && value.flow) useKnowledgeStore.getState().apply({ kind: "flow", flow: value.flow });
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [sessionId, cwd]);
	if (!sessionId) return null;
	// Flow events are transient; persisted observed task artifacts must survive a reload.
	if (!flow)
		return artifacts.length ? (
			<section
				className="mx-4 my-2 rounded-xl border border-border bg-surface p-3 text-xs"
				data-testid="knowledge-flow-card"
			>
				<p>
					{t("outputs")} {artifacts.length}
				</p>
				{artifacts.map(
					(item) =>
						item.path && (
							<button
								key={item.key}
								type="button"
								className="mt-1 block break-all text-left underline"
								onClick={() =>
									useUiStore
										.getState()
										.openResourcePreview({ href: item.path || "", label: item.title, cwd: cwd || undefined })
								}
							>
								{item.title}
							</button>
						),
				)}
			</section>
		) : null;
	const records = [...flow.navigation, ...flow.reads];
	const activeSpecialist = flow.specialists?.find(
		(agent) => agent.status === "running" || agent.status === "queued",
	);
	const title = activeSpecialist
		? `${t(`specialist_${activeSpecialist.role}`)} · ${t(`worker_${activeSpecialist.status}`)}`
		: flow.publication?.warnings?.length
			? "有提醒"
			: t(phases[flow.phase] || "flow");
	// 阶段进度由后端 flow 单点派生（flow.stages）；渲染端只读展示，不再自行重算（旧 flow 缺省则全未完成）
	const stages: [keyof typeof knowledgeZh, boolean][] = [
		["navigation", flow.stages?.navigation ?? false],
		["wiki", flow.stages?.wiki ?? false],
		["search", flow.stages?.search ?? false],
		["publication", flow.stages?.publication ?? false],
	];
	function manage(tab: "overview" | "reviews" | "maintenance" = "overview") {
		useKnowledgeStore.getState().open({ cwd, sessionId, tab });
	}
	async function resume() {
		if (resuming) return;
		setResuming(true);
		try {
			await getPi().resumeKnowledgeCheck(sessionId!);
		} catch (e) {
			reportKnowledgeError(e);
		} finally {
			setResuming(false);
		}
	}
	return (
		<section
			className="mx-4 mb-2 mt-2 shrink-0 rounded-xl border border-border bg-surface text-ink"
			data-testid="knowledge-flow-card"
			aria-label={t("flow")}
		>
			<div className="flex items-center justify-between gap-2 px-3 py-2">
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
					className="flex min-w-0 items-center gap-2 text-left"
				>
					<span
						className={`h-1.5 w-1.5 shrink-0 rounded-full ${flow.phase === "blocked" ? "bg-warn" : flow.phase === "released" ? "bg-ok" : "bg-accent"}`}
						aria-hidden
					/>
					<span className="truncate text-[11px] font-medium" role="status" aria-live="polite">
						{title}
					</span>
					<span className="text-[10px] text-ink-faint">{open ? "▴" : "▾"}</span>
				</button>
				<span className="text-[10px] text-ink-faint">
					{t("matched")} {flow.search?.hits ?? 0} · {t("outputs")} {artifacts.length}
				</span>
			</div>
			{open && (
				<div className="max-h-[36vh] overflow-auto border-t border-border px-3 py-3">
					<div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
						{stages.map(([label, done]) => (
							<div key={label} className="rounded-lg bg-hover px-2 py-1.5 text-[10px]">
								<span aria-hidden>{done ? "✓" : "○"} </span>
								{t(label)}
							</div>
						))}
					</div>
					{flow.vault && <p className="mb-2 break-all font-mono text-[10px] text-ink-dim">{flow.vault}</p>}
					{flow.search && (
						<p className="mb-2 break-words text-[11px]">
							{t("search")}：{flow.search.query} · {t("matched")} {flow.search.hits} ·{" "}
							{flow.search.complete ? t("coverageReady") : t("coveragePartial")}
						</p>
					)}
					{!!flow.specialists?.length && (
						<div className="mb-3" data-testid="knowledge-specialist-runs">
							<h4 className="mb-2 text-[11px] font-semibold">{t("specialistRuns")}</h4>
							{flow.specialists.map((agent) => (
								<div key={agent.id} className="mb-2 rounded-lg border border-border p-2 text-[11px]">
									<div className="flex justify-between gap-2">
										<strong>{t(`specialist_${agent.role}`)}</strong>
										<span>{t(`worker_${agent.status}`)}</span>
									</div>
									<p className="mt-1 break-all text-[10px] text-ink-faint">
										{agent.model || agent.name}
										{agent.action ? ` · ${agent.action}` : ""}
									</p>
									{agent.summary && <p className="mt-1 break-words">{agent.summary}</p>}
									{agent.error && <p className="mt-1 break-words text-warn">{agent.error}</p>}
									{agent.sources?.map((ref) => (
										<div key={ref.path} className="mt-2 border-t border-border pt-1">
											<div className="flex items-center justify-between gap-2">
												<span className="min-w-0 truncate font-mono text-[10px]" title={ref.path}>
													{ref.path} · L{ref.startLine}–{ref.endLine}
												</span>
												<Button size="sm" onClick={() => setPath(ref.path)}>
													{t("openSource")}
												</Button>
											</div>
											{ref.excerpt && <p className="break-words text-[10px] text-ink-dim">{ref.excerpt}</p>}
										</div>
									))}
									{agent.inputTokens !== undefined && (
										<p className="mt-1 text-[10px] text-ink-dim">
											{t("specialistUsage")} {agent.inputTokens} / {agent.outputTokens ?? 0} · {t("sources")}{" "}
											{agent.sourceCount ?? 0}
										</p>
									)}
								</div>
							))}
							<p className="text-[10px] text-ink-faint">{t("specialistUnverified")}</p>
						</div>
					)}
					<h4 className="mb-2 text-[11px] font-semibold">{t("findings")}</h4>
					{(flow.search?.previews || []).map((row) => (
						<div key={row.path} className="mb-2 rounded-lg border border-border p-2 text-[11px]">
							<div className="flex items-start justify-between gap-2">
								<strong className="min-w-0 break-words">{row.title || row.path}</strong>
								<Button size="sm" onClick={() => setPath(row.path)}>
									{t("openSource")}
								</Button>
							</div>
							<p className="whitespace-pre-wrap break-words text-ink-dim">{row.excerpt}</p>
							<p className="mt-1 break-all font-mono text-[10px] text-ink-faint">
								{row.path} · L{row.startLine}–{row.endLine}
							</p>
						</div>
					))}
					{!flow.search?.hits && <p className="mb-2 text-[11px] text-ink-dim">{t("noFindings")}</p>}
					<p className="mb-3 text-[10px] text-ink-faint">{t("candidateHint")}</p>
					{!!artifacts.length && (
						<div className="mb-3">
							<h4 className="mb-1 text-[11px] font-semibold">{t("outputs")}</h4>
							{artifacts.map((item) => (
								<div key={item.key} className="mb-1 rounded-lg bg-hover p-2 text-[11px]">
									<div className="flex items-start justify-between gap-2">
										<span className="min-w-0 break-words">
											{item.title} · {item.status}
										</span>
										{item.path && (
											<Button
												size="sm"
												onClick={() => {
													if (/^(Wiki|Library|Projects|Inbox|Indexes)\//.test(item.path || ""))
														setPath(item.path);
													else
														useUiStore.getState().openResourcePreview({
															href: item.path || "",
															label: item.title,
															cwd: cwd || undefined,
														});
												}}
											>
												{t("openSource")}
											</Button>
										)}
									</div>
									<p className="break-words text-ink-dim">{item.detail}</p>
								</div>
							))}
						</div>
					)}
					{flow.phase === "no-hits" && <p className="mb-2 text-[11px] text-warn">{t("noHitsHint")}</p>}
					{(flow.error || flow.publication?.reason) && (
						<p className="mb-2 break-words rounded-lg bg-hover p-2 text-[11px] text-warn">
							{flow.error || flow.publication?.reason}
						</p>
					)}
					<h4 className="mb-1 text-[11px] font-semibold">{t("readScope")}</h4>
					<div className="space-y-1">
						{records.map((row: KnowledgeReadRecord) => (
							<div
								key={`${row.path}:${row.startLine}:${row.endLine}:${row.hash ?? "missing"}`}
								className="flex items-center justify-between gap-2 text-[10px]"
							>
								<div className="min-w-0">
									<span className="block truncate font-mono" title={row.path}>
										{row.path}
									</span>
									{row.excerpt && <p className="my-1 line-clamp-2 break-words text-ink-dim">{row.excerpt}</p>}
									<span className="text-ink-faint">
										{row.missing
											? t("missing")
											: `L${row.startLine}–${row.endLine} · ${row.hash?.slice(0, 12) || "—"}`}
										{row.truncated ? ` · ${t("truncated")}` : ""}
									</span>
								</div>
								<Button
									size="sm"
									disabled={!!row.missing || !flow.bindingRevision}
									onClick={() => setPath(row.path)}
								>
									{t("openSource")}
								</Button>
							</div>
						))}
					</div>
					{path && flow.bindingRevision && (
						<div className="mt-3">
							<KnowledgeNoteViewer
								cwd={cwd}
								path={path}
								revision={flow.bindingRevision}
								onClose={() => setPath(null)}
							/>
						</div>
					)}
					<p className="mt-3 text-[10px] text-ink-dim">{t("checksNotFacts")}</p>
					{!!flow.publication?.paths?.length && (
						<div className="my-2 text-[11px] text-warn">
							{flow.publication.paths.map((p) => (
								<code key={p} className="block break-all">
									{p}
								</code>
							))}
						</div>
					)}
					{flow.phase === "blocked" && (
						<div className="mt-2">
							<div className="flex flex-wrap gap-2">
								<Button size="sm" onClick={() => manage("maintenance")}>
									{t("maintenance")}
								</Button>
								<Button size="sm" disabled={resuming} onClick={() => void resume()}>
									{t("resume")}
								</Button>
							</div>
							<p className="mt-1 text-[10px] text-ink-faint">{t("resumeHint")}</p>
						</div>
					)}
				</div>
			)}
		</section>
	);
}
