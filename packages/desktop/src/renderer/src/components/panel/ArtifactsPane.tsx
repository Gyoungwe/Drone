import type { InquiryArtifactProvenance, InquiryArtifactRecord } from "@drone/shared";
import { useEffect, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";
import { TaskArtifactLinks, taskArtifactLinks } from "../chat/TaskArtifactLinks";
import { ObsidianIcon, SearchIcon } from "../icons";
import { mergeKnowledgeArtifacts } from "../knowledge/artifacts";
import { KnowledgeFlowCard } from "../knowledge/KnowledgeFlowCard";
import { FlowCards } from "./FlowCards";

/**
 * 「产物」页签：知识流状态卡（原聊天区顶部横条 KnowledgeFlowCard，含阶段/产物/继续检查/管理）
 * + 通用回执卡（归档 / 入库 / 总结 / 文献 / Wiki 候选，flow.cards）+ 任务产物链接 + 研究工作台 / 知识库 全屏视图入口。
 */
export function ArtifactsPane({ sessionId }: { sessionId: string | null }) {
	const t = useT();
	const cwd = useSessionsStore((s) => s.cwd);
	const messages = useTranscriptStore((s) => selectTranscript(s, sessionId).messages);
	const flow = useKnowledgeStore((s) => (sessionId ? s.flows[sessionId] : undefined));
	const openKnowledge = useKnowledgeStore((s) => s.open);
	const latestMessage = [...messages].reverse().find((m) => m.kind === "assistant" && m.taskView);
	const view = latestMessage?.kind === "assistant" ? latestMessage.taskView : undefined;
	const tasksWithArtifacts = (view?.tasks ?? []).filter((task) => taskArtifactLinks(task).length > 0);
	const artifacts = mergeKnowledgeArtifacts(flow?.cards || [], view?.tasks ?? [], cwd || "");
	const cards = flow?.cards?.length ?? 0;
	const [ledgerArtifacts, setLedgerArtifacts] = useState<InquiryArtifactRecord[]>([]);
	const [provenanceById, setProvenanceById] = useState<Record<string, InquiryArtifactProvenance | undefined>>(
		{},
	);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [rerunningId, setRerunningId] = useState<string | null>(null);
	const [rerunResults, setRerunResults] = useState<Record<string, RerunNotice>>({});

	const inquiryScope = `${sessionId ?? ""}:${cwd ?? ""}`;
	useEffect(() => {
		void inquiryScope;
		let live = true;
		setProvenanceById({});
		setExpandedId(null);
		setRerunResults({});
		void getPi()
			.listArtifacts()
			.then((records) => {
				if (live) setLedgerArtifacts(records.filter((record) => record.purpose === "deliverable"));
			})
			.catch(() => {
				if (live) setLedgerArtifacts([]);
			});
		return () => {
			live = false;
		};
	}, [inquiryScope]);

	const empty =
		!flow &&
		artifacts.length === 0 &&
		tasksWithArtifacts.length === 0 &&
		cards === 0 &&
		ledgerArtifacts.length === 0;

	async function toggleProvenance(record: InquiryArtifactRecord): Promise<void> {
		if (expandedId === record.id) {
			setExpandedId(null);
			return;
		}
		setExpandedId(record.id);
		if (provenanceById[record.id]) return;
		const result = await getPi().artifactProvenance(record.id);
		if ("reproducibility" in result) setProvenanceById((current) => ({ ...current, [record.id]: result }));
	}

	async function rerun(record: InquiryArtifactRecord): Promise<void> {
		setRerunningId(record.id);
		try {
			const result = await getPi().rerunArtifact(record.id);
			setRerunResults((current) => ({
				...current,
				[record.id]:
					"status" in result
						? {
								key:
									result.status === "reproduced"
										? "panel.artifactProvenance.reproduced"
										: "panel.artifactProvenance.superseded",
								difference: result.difference,
								sha256: result.sha256,
							}
						: { key: "panel.artifactProvenance.rerunFailed" },
			}));
			if ("status" in result && result.status === "superseded") {
				setLedgerArtifacts((current) =>
					current.map((item) => (item.id === record.id ? { ...item, status: "superseded" } : item)),
				);
			}
		} finally {
			setRerunningId(null);
		}
	}

	return (
		<div className="context-pane">
			{ledgerArtifacts.length > 0 && (
				<section className="panel-card" data-testid="inquiry-artifacts">
					<header className="text-[12px] font-medium text-ink">{t("panel.artifactProvenance.title")}</header>
					<div className="mt-1 space-y-2">
						{ledgerArtifacts.map((record) => (
							<ArtifactProvenanceCard
								key={record.id}
								record={record}
								provenance={provenanceById[record.id]}
								expanded={expandedId === record.id}
								rerunning={rerunningId === record.id}
								rerunResult={rerunResults[record.id]}
								onToggle={() => void toggleProvenance(record)}
								onRerun={() => void rerun(record)}
							/>
						))}
					</div>
				</section>
			)}
			<div className="panel-flow">
				<KnowledgeFlowCard sessionId={sessionId} />
			</div>
			<FlowCards sessionId={sessionId} />
			{tasksWithArtifacts.length > 0 && (
				<section className="panel-card">
					<header className="text-[12px] font-medium text-ink">{t("panel.taskArtifacts")}</header>
					<div className="mt-1 space-y-2">
						{tasksWithArtifacts.map((task) => (
							<div key={task.id}>
								<p className="truncate text-[11px] text-ink-dim" title={task.goal}>
									{task.goal}
								</p>
								<TaskArtifactLinks task={task} sessionId={sessionId} />
							</div>
						))}
					</div>
				</section>
			)}
			{empty && <p className="panel-empty">{t("panel.artifactsEmpty")}</p>}
			<div className="grid grid-cols-2 gap-2">
				<button
					type="button"
					className="panel-action"
					onClick={() => openKnowledge({ cwd, sessionId, tab: "overview" })}
				>
					<SearchIcon size={14} />
					<span>{t("workbench.nav.research")}</span>
				</button>
				<button
					type="button"
					className="panel-action"
					onClick={() => openKnowledge({ cwd, sessionId, tab: "reviews" })}
				>
					<ObsidianIcon size={14} />
					<span>{t("workbench.nav.knowledge")}</span>
				</button>
			</div>
		</div>
	);
}

type RerunNotice = {
	key:
		| "panel.artifactProvenance.reproduced"
		| "panel.artifactProvenance.superseded"
		| "panel.artifactProvenance.rerunFailed";
	difference?: string;
	sha256?: string;
};

export function ArtifactProvenanceCard({
	record,
	provenance,
	expanded,
	rerunning = false,
	rerunResult,
	onToggle,
	onRerun,
}: {
	record: InquiryArtifactRecord;
	provenance?: InquiryArtifactProvenance;
	expanded: boolean;
	rerunning?: boolean;
	rerunResult?: RerunNotice;
	onToggle: () => void;
	onRerun?: () => void;
}) {
	const t = useT();
	const status = provenance?.reproducibility;
	const badge = status
		? t(`panel.artifactProvenance.badge.${status}`)
		: t("panel.artifactProvenance.loading");
	return (
		<article className="rounded-lg bg-hover p-2 text-[11px]" data-testid="artifact-provenance-card">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="break-words font-medium text-ink">{record.path}</p>
					<p className="font-mono text-ink-faint">sha256:{record.sha256.slice(0, 16)}…</p>
				</div>
				<button type="button" className="panel-action" aria-expanded={expanded} onClick={onToggle}>
					{expanded ? t("panel.artifactProvenance.collapse") : t("panel.artifactProvenance.expand")}
				</button>
			</div>
			{expanded && provenance && (
				<div className="mt-2 space-y-1 border-t border-border pt-2" data-testid="artifact-provenance-details">
					<p data-reproducibility={provenance.reproducibility}>
						<span className="mr-1 rounded px-1 py-0.5 text-[10px]">{badge}</span>
					</p>
					{provenance.attempts.map((attempt) => (
						<div key={attempt.id} className="space-y-0.5">
							{attempt.codeFingerprint && (
								<p className="break-all">
									{t("panel.artifactProvenance.codeFingerprint")}: {attempt.codeFingerprint}
								</p>
							)}
							<p className="break-words">
								{t("panel.artifactProvenance.parameters")}: {JSON.stringify(attempt.parameters)}
							</p>
							{attempt.resultSummary && <p className="break-words">{attempt.resultSummary}</p>}
						</div>
					))}
					{provenance.runProvenance && (
						<div className="break-words">
							<p>
								{t("panel.artifactProvenance.environment")}: {provenance.runProvenance.workflow || "—"}
								{provenance.runProvenance.modules?.length
									? ` · ${provenance.runProvenance.modules.join(", ")}`
									: ""}
							</p>
							{provenance.runProvenance.containerDigests?.length && (
								<p>
									{t("panel.artifactProvenance.container")}:{" "}
									{provenance.runProvenance.containerDigests.join(", ")}
								</p>
							)}
							{provenance.runProvenance.commandSummary && (
								<p>
									{t("panel.artifactProvenance.command")}: {provenance.runProvenance.commandSummary}
								</p>
							)}
							{provenance.runProvenance.environment && (
								<p>
									{t("panel.artifactProvenance.environmentValues")}:{" "}
									{JSON.stringify(provenance.runProvenance.environment)}
								</p>
							)}
						</div>
					)}
					{provenance.parentChain.length > 0 && (
						<p className="break-words">
							{t("panel.artifactProvenance.parents")}:{" "}
							{provenance.parentChain.map((item) => item.id).join(" → ")}
						</p>
					)}
					{provenance.parentChainTruncated && (
						<p className="text-warn">{t("panel.artifactProvenance.parentsTruncated")}</p>
					)}
					{provenance.sourceSessionId && (
						<button
							type="button"
							className="underline"
							onClick={() => useSessionsStore.getState().switchSession(provenance.sourceSessionId as string)}
						>
							{t("panel.artifactProvenance.openSession")} · {provenance.sourceSessionId}
							{provenance.sourceTurn !== undefined
								? ` · ${t("panel.artifactProvenance.turn")} ${provenance.sourceTurn}`
								: ""}
						</button>
					)}
					{provenance.reproducibility === "reproducible" && onRerun && (
						<button type="button" className="panel-action ml-2" disabled={rerunning} onClick={onRerun}>
							{rerunning ? t("panel.artifactProvenance.rerunning") : t("panel.artifactProvenance.rerun")}
						</button>
					)}
					{rerunResult && (
						<div className="mt-1 text-warn">
							<p>{t(rerunResult.key)}</p>
							{rerunResult.difference && (
								<p>
									{t("panel.artifactProvenance.difference")}: {rerunResult.difference}
									{rerunResult.sha256 ? ` · sha256:${rerunResult.sha256}` : ""}
								</p>
							)}
						</div>
					)}
				</div>
			)}
		</article>
	);
}
