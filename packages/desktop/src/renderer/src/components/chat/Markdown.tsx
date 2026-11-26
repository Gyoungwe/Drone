import {
	type KnowledgeOverview,
	knowledgeLinksForDisplay,
	parseKnowledgeHref,
	splitResourceLink,
} from "@drone/shared";
import MarkdownRender, { type SmoothMarkdownStreamOptions, setCustomComponents } from "markstream-react";
import { getPi } from "../../api";
import { reportKnowledgeError } from "../../lib/knowledge-error";
import { useKnowledgeStore } from "../../stores/knowledge";
import "markstream-react/index.css";
import { type MouseEvent, useCallback, useMemo, useRef } from "react";
import { useSessionsStore } from "../../stores/sessions";
import { useThemeStore } from "../../stores/theme";
import { useUiStore } from "../../stores/ui";
import { ChatCodeBlock } from "./ChatCodeBlock";

/**
 * 平滑输出速率参数（markstream 内置 smooth streaming controller，grapheme 级 pacing）：
 * - min 80 cps：小 delta 时的基速（利落的打字机感，不拖沓）
 * - 自适应：backlog <600 字在 900ms 内追平；超过则切换到 350ms 快进（≤1000 cps、
 *   每次 commit ≤80 字、30fps）——大 trunk 变成连续滑出而非整块蹦现，且不会越积越多
 * - flushOnFinish 保持 false：final（turn_end 固化）后不跳变，继续平滑追完剩余 backlog
 */
const SMOOTH_OPTIONS: SmoothMarkdownStreamOptions = {
	minCharsPerSecond: 80,
	// 其余（targetLatencyMs 900 / catchUpLatencyMs 350 / catchUpThreshold 600 / max 1000cps）用默认
};

/** 聊天 Markdown 的自定义组件注册表（模块级，只注册一次）。 */
const CHAT_MARKDOWN_ID = "chat-markdown";
setCustomComponents(CHAT_MARKDOWN_ID, { code_block: ChatCodeBlock });

/** 减速动效偏好：关闭 pacing，直接输出 */
const REDUCED_MOTION =
	typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Markdown 渲染：markstream-react（增量解析，为流式 token 设计，避免 react-markdown 每帧全量 re-parse）。
 * final=false 时未闭合的构造（代码块/表格/链接）按 pending 渲染；提交后必须 true。
 *
 * 流式丝滑性（两层）：
 * 1. smoothStreaming：内容经自适应速率控制器逐字放出（大 trunk 平滑滑出）。只对「挂载时就在流式」
 *    的消息启用——历史/固化后打开的消息直出（mount 初值锁定，否则整篇会重播一遍）。
 *    流式 → turn_end 固化依赖 MessageList 的 key 稳定（StreamingState.id）保持组件不 remount，
 *    controller 才能存活并平滑追平。
 * 2. fade 必须关闭：开启后 smooth controller 每次 commit 都会创建带 opacity/will-change 的临时
 *    span；高频合成层切换会让整个文本排版区域看起来闪烁。fade=false 走库内稳定文本 span 分支，
 *    不依赖 animationend 沉淀。样式覆写集中在 globals.css 的 .markdown-body 下。
 * isDark 驱动代码块 shiki 主题（vitesse-light/dark）与容器深浅 —— 主题选择现在在
 * ChatCodeBlock 内部完成（见 lib/shiki-highlighter 的 CHAT_THEME）。
 */
export function Markdown({
	text,
	streaming,
	onLink,
}: {
	text: string;
	streaming?: boolean;
	/** A contribution owns navigation when supplied; no host knowledge or resource routing runs. */
	onLink?: (href: string) => void;
}) {
	const isDark = useThemeStore((s) => s.resolved === "dark");
	const cwd = useSessionsStore((s) => s.cwd);
	const openResourcePreview = useUiStore((s) => s.openResourcePreview);
	const displayText = useMemo(() => (onLink ? text : knowledgeLinksForDisplay(text)), [text, onLink]);
	const handleClick = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
			if (!(target instanceof HTMLAnchorElement)) return;
			const href = target.getAttribute("href");
			if (href === null) return;
			if (onLink) {
				event.preventDefault();
				event.stopPropagation();
				onLink(href);
				return;
			}
			if (!href) return;
			const notePath = parseKnowledgeHref(href);
			if (notePath) {
				event.preventDefault();
				event.stopPropagation();
				void getPi()
					.invokeKnowledge({ operation: "overview", input: { cwd } })
					.then((value) => {
						const overview = value as KnowledgeOverview;
						if (!overview.binding) throw new Error("No knowledge Vault is bound");
						useKnowledgeStore.getState().open({
							cwd,
							sessionId: useSessionsStore.getState().activeSessionId,
							tab: "overview",
							note: notePath,
							noteRevision: overview.binding.revision,
						});
					})
					.catch(reportKnowledgeError);
				return;
			}
			if (href.startsWith("#")) return;
			event.preventDefault();
			event.stopPropagation();
			const resourceTarget = splitResourceLink(href);
			openResourcePreview({
				...resourceTarget,
				label: target.textContent?.trim() || href,
				cwd: cwd ?? undefined,
			});
		},
		[cwd, onLink, openResourcePreview],
	);
	// 挂载初值锁定：流式中挂载 → 本次生命周期始终启用平滑（含固化后追平）；历史消息挂载 → 永不启用
	const smoothableRef = useRef<boolean>(Boolean(streaming) && !REDUCED_MOTION);
	return (
		<div className="markdown-body text-[15px] leading-[1.75] text-ink select-text">
			{/* deferNodesUntilVisible=false：markstream 0.0.55 的延迟节点 bug——块数 > initialRenderBatchSize(40)
			    的节点先渲染为 node-placeholder 占位条，等 IntersectionObserver 标记可见后只写 ref 不触发
			    re-render（非虚拟化路径）；流式期间靠内容更新顺带刷新，流一停占位条就永久残留。 */}
			<MarkdownRender
				customId={CHAT_MARKDOWN_ID}
				content={displayText}
				onClick={handleClick}
				final={!streaming}
				fade={false}
				smoothStreaming={smoothableRef.current}
				smoothStreamingOptions={SMOOTH_OPTIONS}
				isDark={isDark}
				deferNodesUntilVisible={false}
			/>
		</div>
	);
}
