import type { KnowledgeTopic, KnowledgeTopicListResult } from "@drone/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { useSessionsStore } from "../../stores/sessions";
import { useAgentActive } from "../session/session-status";
import { Button } from "../ui/Button";
import { useKnowledgeText } from "./copy";

export function TopicManagement({
	cwd,
	bindingRevision,
	sessionId,
}: {
	cwd: string | null;
	bindingRevision: number;
	sessionId: string | null;
}) {
	const t = useKnowledgeText();
	const [query, setQuery] = useState("");
	const [data, setData] = useState<KnowledgeTopicListResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const epoch = useRef(0);
	const session = useSessionsStore((s) => s.sessions.find((item) => item.sessionId === sessionId));
	const streaming = useAgentActive(sessionId);
	const load = useCallback(
		async (filter = "") => {
			if (!cwd) return;
			const current = ++epoch.current;
			setError(null);
			try {
				const next = await getPi().getKnowledgeTopics({ cwd, bindingRevision, query: filter });
				if (current === epoch.current) setData(next);
			} catch (e) {
				if (current === epoch.current) setError(e instanceof Error ? e.message : String(e));
			}
		},
		[bindingRevision, cwd],
	);
	useEffect(() => {
		void load("");
		return () => {
			epoch.current++;
		};
	}, [load]);
	async function archive(topic: KnowledgeTopic) {
		const projectCwd = cwd;
		if (!data || !projectCwd || busy || !window.confirm(t("archiveConfirm"))) return;
		setBusy(true);
		setError(null);
		try {
			await getPi().archiveKnowledgeTopic({
				cwd: projectCwd,
				bindingRevision,
				id: topic.id,
				expectedRevision: data.revision,
			});
			await load(query);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}
	function resume(topic: KnowledgeTopic) {
		if (!sessionId || !session || session.readOnly || streaming) return;
		const text = `Prepare the knowledge context for topic "${topic.id}" from its recorded sources, then call research_resume_topic with the exact quoted topic id "${topic.id}" and reread the sources before continuing research.`;
		void getPi()
			.prompt(sessionId, text)
			.catch((e) => setError(e instanceof Error ? e.message : String(e)));
	}
	return (
		<section className="space-y-3" data-testid="knowledge-topics">
			<p className="text-[11px] text-ink-dim">{t("topicNeutral")}</p>
			<div className="flex gap-1">
				<input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={t("topicFilter")}
					className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-2 text-xs text-ink"
				/>
				<Button size="sm" disabled={!cwd} onClick={() => void load(query)}>
					{t("refresh")}
				</Button>
			</div>
			{!cwd && <p className="text-xs text-warn">{t("selectProject")}</p>}
			{data?.topics.map((topic) => (
				<article key={topic.id} className="rounded-lg border border-border p-3">
					<div className="flex items-start justify-between gap-2">
						<div>
							<h3 className="text-sm font-medium">{topic.title}</h3>
							<p className="mt-1 text-[10px] text-ink-dim">
								{t("topicStatus")}: {topic.status} · {topic.updatedAt}
							</p>
						</div>
						<div className="flex gap-1">
							<Button
								size="sm"
								disabled={busy || topic.status === "archived"}
								onClick={() => void archive(topic)}
							>
								{topic.status === "archived" ? t("topicArchived") : t("archiveTopic")}
							</Button>
							<Button
								size="sm"
								disabled={
									!sessionId || !session || session.readOnly || streaming || topic.status === "archived"
								}
								onClick={() => resume(topic)}
							>
								{t("resumeTopic")}
							</Button>
						</div>
					</div>
					<p className="mt-2 text-xs leading-relaxed">{topic.summary}</p>
					<dl className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2">
						<dt className="text-ink-dim">{t("topicEntities")}</dt>
						<dd>{topic.entities.join(", ") || "—"}</dd>
						<dt className="text-ink-dim">{t("topicQuestions")}</dt>
						<dd>{topic.unresolvedQuestions.join("; ") || "—"}</dd>
						<dt className="text-ink-dim">{t("topicSources")}</dt>
						<dd className="break-words">{topic.sources.map((source) => source.path).join(", ") || "—"}</dd>
						<dt className="text-ink-dim">{t("topicArtifacts")}</dt>
						<dd>{topic.artifacts.join(", ") || "—"}</dd>
					</dl>
				</article>
			))}
			{data && data.topics.length === 0 && <p className="text-xs text-ink-dim">{t("empty")}</p>}
			{error && (
				<p role="alert" className="break-words text-xs text-err">
					{error}
				</p>
			)}
		</section>
	);
}
