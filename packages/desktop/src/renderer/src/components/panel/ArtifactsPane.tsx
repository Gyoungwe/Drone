import { collectDeliveries } from "@drone/shared";
import { useT } from "../../i18n";
import { mergeKnowledgeArtifacts } from "../../lib/knowledge-artifacts";
import { ArtifactContributions } from "../../plugins/ArtifactContributions";
import { useKnowledgeStore } from "../../stores/knowledge";
import { useSessionsStore } from "../../stores/sessions";
import { selectTranscript, useTranscriptStore } from "../../stores/transcript";
import { useUiPluginsStore } from "../../stores/ui-plugins";
import { DeliveryCards } from "../chat/DeliveryCards";
import { ObsidianIcon } from "../icons";
import { KnowledgeFlowCard } from "../knowledge/KnowledgeFlowCard";
import { EvidencePane } from "./EvidencePane";
import { FlowCards } from "./FlowCards";

/**
 * 「文件」页签：知识流状态卡（原聊天区顶部横条 KnowledgeFlowCard，含阶段/产物/继续检查/管理）
 * + 通用回执卡（归档 / 入库 / 总结 / 文献 / Wiki 候选，flow.cards）+ 任务产物链接 + 研究工作台 / 知识库 全屏视图入口。
 */
export function ArtifactsPane({ sessionId }: { sessionId: string | null }) {
	const t = useT();
	const cwd = useSessionsStore((s) => s.cwd);
	const messages = useTranscriptStore((s) => selectTranscript(s, sessionId).messages);
	const flow = useKnowledgeStore((s) => (sessionId ? s.flows[sessionId] : undefined));
	const openKnowledge = useKnowledgeStore((s) => s.open);
	const uiPluginsConfig = useUiPluginsStore((s) => s.config);
	const uiPlugins = useUiPluginsStore((s) => s.plugins);
	const deliveries = collectDeliveries(messages);
	const artifacts = mergeKnowledgeArtifacts(flow?.cards || [], cwd || "");
	const cards = flow?.cards?.length ?? 0;
	const inquiryReady =
		uiPluginsConfig.enabled &&
		uiPlugins.some(
			(plugin) =>
				plugin.enabled &&
				plugin.built &&
				!plugin.invalidReason &&
				!plugin.buildError &&
				plugin.contributions.some((item) => item.region === "panel.tab" && item.id === "inquiry"),
		);
	const empty = !flow && artifacts.length === 0 && cards === 0;

	return (
		<div className="context-pane">
			{deliveries.length > 0 && (
				<section className="panel-card" data-testid="panel-deliveries">
					<header className="text-[12px] font-medium text-ink">{t("delivery.title")}</header>
					<DeliveryCards files={deliveries} sessionId={sessionId} />
				</section>
			)}
			<section
				className="panel-card"
				data-testid="inquiry-plugin-status"
				data-ready={inquiryReady ? "true" : "false"}
			>
				<header className="flex items-center justify-between gap-2">
					<span className="text-[12px] font-medium text-ink">{t("panel.inquiryPlugin.title")}</span>
					<span className={`text-[11px] ${inquiryReady ? "text-ok" : "text-ink-faint"}`}>
						{t(inquiryReady ? "panel.inquiryPlugin.available" : "panel.inquiryPlugin.unavailable")}
					</span>
				</header>
				<p className="mt-1 text-[11px] text-ink-dim">
					{t(inquiryReady ? "panel.inquiryPlugin.availableHint" : "panel.inquiryPlugin.unavailableHint")}
				</p>
			</section>
			<ArtifactContributions
				surface="evidence.pane"
				artifactId={null}
				analysisId={null}
				capabilityId={null}
				sessionId={sessionId}
				workspaceId={null}
				renderDefault={() => <EvidencePane defaultRoot={cwd} />}
			/>
			<div className="panel-flow">
				<KnowledgeFlowCard sessionId={sessionId} />
			</div>
			<FlowCards sessionId={sessionId} />
			{empty && <p className="panel-empty">{t("panel.artifactsEmpty")}</p>}
			<div className="grid grid-cols-1 gap-2">
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
