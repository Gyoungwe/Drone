import { parseNotebook } from "@drone/shared";
import { useMemo } from "react";
import { useT } from "../../../i18n";
import { ResourceCode } from "../../diff/ResourceCode";
import { ResourceMarkdown } from "../../diff/ResourceMarkdown";
import type { PreviewRendererProps } from "../preview-registry";

/** .ipynb 只读预览：markdown 单元走 ResourceMarkdown，代码走 ResourceCode，输出只渲染文本 / PNG / 错误。 */
export function NotebookViewer({ result }: PreviewRendererProps) {
	const t = useT();
	const parsed = useMemo(() => {
		try {
			return parseNotebook(result.text ?? "");
		} catch {
			return null;
		}
	}, [result.text]);
	if (!parsed)
		return (
			<p className="resource-notice" role="status">
				{t("resource.viewer.notebookParseFailed")}
			</p>
		);
	return (
		<div className="preview-notebook" data-testid="preview-notebook">
			{parsed.clipped && <p className="resource-notice">{t("resource.viewer.notebookClipped")}</p>}
			{parsed.cells.map((cell, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: cells are an immutable parsed snapshot
				<section key={index} className={`preview-nb-cell preview-nb-${cell.type}`}>
					{cell.type === "markdown" ? (
						<ResourceMarkdown text={cell.source} onNavigate={() => {}} />
					) : (
						<>
							<div className="preview-nb-prompt">[{cell.executionCount ?? " "}]</div>
							<ResourceCode text={cell.source} language={cell.type === "raw" ? "text" : parsed.language} />
						</>
					)}
					{cell.outputs.map((out, i) =>
						out.kind === "image" ? (
							// biome-ignore lint/suspicious/noArrayIndexKey: immutable snapshot
							<img key={i} className="preview-nb-image" alt="" src={`data:image/png;base64,${out.png}`} />
						) : (
							// biome-ignore lint/suspicious/noArrayIndexKey: immutable snapshot
							<pre key={i} className={out.kind === "error" ? "preview-nb-error" : "preview-nb-output"}>
								{out.text}
							</pre>
						),
					)}
				</section>
			))}
		</div>
	);
}
