import { knowledgeLinksForDisplay, parseKnowledgeHref } from "@drone/shared";
import MarkdownRender from "markstream-react";
import "markstream-react/index.css";
import { type MouseEvent, useMemo, useRef, useState } from "react";
import { t } from "../i18n";

/** 平滑输出参数（与桌面端 Markdown.tsx 同款：min 80cps，其余默认；final 后追平不跳变） */
const SMOOTH_OPTIONS = { minCharsPerSecond: 80 } as const;

/** 只读代码展示不显示编辑器式的符号/Unicode decoration；保留真实拖选高亮。 */
const CODE_BLOCK_PROPS = {
	monacoOptions: {
		renderLineHighlight: "none",
		selectionHighlight: false,
		occurrencesHighlight: "off",
		matchBrackets: "never",
		bracketPairColorization: { enabled: false },
		unicodeHighlight: {
			ambiguousCharacters: false,
			invisibleCharacters: false,
			nonBasicASCII: false,
		},
	},
} as const;

const REDUCED_MOTION =
	typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Markdown 渲染（markstream-react，增量解析）。lan-web 版：isDark 由调用方 prop 传入
 * （桌面版从 theme store 读）。流式平滑只在挂载时 streaming=true 的消息启用（useRef 锁初值，
 * 历史消息不整篇重播）。deferNodesUntilVisible=false：0.0.55 延迟节点 bug（占位条不刷新）。
 */
export function Markdown({
	text,
	streaming,
	isDark,
}: {
	text: string;
	streaming?: boolean;
	isDark: boolean;
}) {
	const smoothableRef = useRef<boolean>(Boolean(streaming) && !REDUCED_MOTION);
	const displayText = useMemo(() => knowledgeLinksForDisplay(text), [text]);
	const [sourcePath, setSourcePath] = useState<string | null>(null);
	const handleClick = (event: MouseEvent<HTMLDivElement>) => {
		const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
		const path = parseKnowledgeHref(link?.getAttribute("href") || "");
		if (!path) return;
		event.preventDefault();
		event.stopPropagation();
		setSourcePath(path);
	};
	return (
		<div className="markdown-body">
			<MarkdownRender
				content={displayText}
				onClick={handleClick}
				final={!streaming}
				fade={false}
				smoothStreaming={smoothableRef.current}
				smoothStreamingOptions={SMOOTH_OPTIONS}
				isDark={isDark}
				codeBlockProps={CODE_BLOCK_PROPS}
				deferNodesUntilVisible={false}
			/>
			{sourcePath && (
				<aside className="citation-detail" aria-label={t("citation.path")}>
					<strong>{t("citation.path")}</strong>
					<code>{sourcePath}</code>
					<button type="button" onClick={() => setSourcePath(null)}>
						{t("citation.close")}
					</button>
				</aside>
			)}
		</div>
	);
}
