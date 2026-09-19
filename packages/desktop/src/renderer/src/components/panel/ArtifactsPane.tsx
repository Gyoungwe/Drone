import { useT } from "../../i18n";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";
import { TaskArtifactLinks, taskArtifactLinks } from "../chat/TaskArtifactLinks";
import { ObsidianIcon, SearchIcon } from "../icons";
import { mergeKnowledgeArtifacts } from "../knowledge/artifacts";
import { KnowledgeFlowCard } from "../knowledge/KnowledgeFlowCard";
import { LiteratureReceipts } from "./LiteratureReceipts";

/**
 * 「产物」页签：知识流状态卡（原聊天区顶部横条 KnowledgeFlowCard，含阶段/产物/继续检查/管理）
 * + 文献回执卡（DOI / Zotero key / Vault 笔记 / 全文状态）+ 任务产物链接 + 研究工作台 / 知识库 全屏视图入口。
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
	const artifacts = mergeKnowledgeArtifacts(flow?.artifacts || [], view?.tasks ?? [], cwd || "");
	const literature = flow?.literature?.length ?? 0;
	const empty = !flow && artifacts.length === 0 && tasksWithArtifacts.length === 0 && literature === 0;

	return (
		<div className="context-pane">
			<div className="panel-flow">
				<KnowledgeFlowCard sessionId={sessionId} />
			</div>
			<LiteratureReceipts sessionId={sessionId} />
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
