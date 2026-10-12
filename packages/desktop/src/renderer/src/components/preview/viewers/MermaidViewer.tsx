import { useEffect, useId, useState } from "react";
import { useT } from "../../../i18n";
import type { PreviewRendererProps } from "../preview-registry";

/** Mermaid：懒加载 mermaid（strict 安全级别，禁 HTML 标签与点击回调），渲染为 SVG。 */
export function MermaidViewer({ result }: PreviewRendererProps) {
	const t = useT();
	const id = useId().replace(/[^a-zA-Z0-9]/g, "");
	const [svg, setSvg] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let cancelled = false;
		setSvg(null);
		setFailed(false);
		void import("mermaid")
			.then(async ({ default: mermaid }) => {
				mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
				const out = await mermaid.render(`drone-mermaid-${id}`, result.text ?? "");
				if (!cancelled) setSvg(out.svg);
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [result.text, id]);
	if (failed)
		return (
			<p className="resource-notice" role="status">
				{t("resource.viewer.mermaidFailed")}
			</p>
		);
	if (!svg) return <div className="resource-empty">{t("resource.viewer.mermaidLoading")}</div>;
	return (
		<div
			className="preview-mermaid"
			data-testid="preview-mermaid"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid strict-mode SVG, sanitised by mermaid (DOMPurify)
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	);
}
