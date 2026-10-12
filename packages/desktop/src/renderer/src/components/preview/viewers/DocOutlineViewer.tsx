import { latexOutline, typstOutline } from "@drone/shared";
import { createElement, useMemo } from "react";
import { useT } from "../../../i18n";
import type { PreviewRendererProps } from "../preview-registry";

/** LaTeX / Typst 结构预览：标题层级 + 段落 + 公式块（不编译，页脚说明）。 */
export function DocOutlineViewer({ result }: PreviewRendererProps) {
	const t = useT();
	const typst = result.previewKind === "typst" || result.name.toLowerCase().endsWith(".typ");
	const outline = useMemo(
		() => (typst ? typstOutline(result.text ?? "") : latexOutline(result.text ?? "")),
		[typst, result.text],
	);
	return (
		<article className="preview-doc" data-testid="preview-doc">
			<p className="resource-data-summary">
				{t(typst ? "resource.viewer.typstNote" : "resource.viewer.latexNote")}
			</p>
			{outline.title && <h1 className="preview-doc-title">{outline.title}</h1>}
			{outline.blocks.map((block, i) =>
				block.kind === "heading" ? (
					createElement(
						`h${Math.min(4, block.level + 1)}`,
						{ key: i, className: "preview-doc-h" },
						block.text,
					)
				) : block.kind === "math" ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: immutable outline snapshot
					<pre key={i} className="preview-doc-math">
						{block.text}
					</pre>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: immutable outline snapshot
					<p key={i}>{block.text}</p>
				),
			)}
		</article>
	);
}
