import type { ResourcePreviewResult } from "@drone/shared";
import { resourceFormat } from "@drone/shared";
import { useT } from "../../i18n";
import { FigureAnnotator, type FigureSource } from "../diff/FigureAnnotator";
import { ResourceCode } from "../diff/ResourceCode";
import { ResourceTextPreview } from "../diff/ResourceTextPreview";
import { previewRendererFor, routePreview } from "./preview-registry";
import "./viewers";

export interface PreviewHostProps {
	result: ResourcePreviewResult;
	src: string | null;
	mode: "preview" | "source";
	zoom: number;
	imageError: boolean;
	onImageError: () => void;
	onNavigate: (href: string, label?: string) => void;
	source: FigureSource;
}

/** 统一预览宿主：按 previewKind 分发到已注册预览器，否则走内建 图片 / PDF / 文本 / 二进制 视图。 */
export function PreviewHost({
	result,
	src,
	mode,
	zoom,
	imageError,
	onImageError,
	onNavigate,
	source,
}: PreviewHostProps) {
	const t = useT();
	if (mode === "source" && result.text !== undefined) {
		const format = resourceFormat(result.name);
		return (
			<ResourceCode
				text={result.text}
				language={result.name.toLowerCase().endsWith(".svg") ? "xml" : format.language}
			/>
		);
	}
	const route = routePreview(result, Boolean(src));
	if (route.view === "registered") {
		const Renderer = previewRendererFor(route.kind);
		if (Renderer)
			return (
				<div className="preview-host" data-preview-kind={route.kind}>
					<Renderer result={result} src={src} />
				</div>
			);
	}
	if (route.view === "image" && src)
		return (
			<div className="resource-media" data-preview-kind="image">
				{imageError ? (
					<p className="resource-notice" role="status">
						{t("resource.viewer.imageDecodeFailed")}
					</p>
				) : (
					<FigureAnnotator source={source} name={result.name} path={result.path} width={`${zoom * 100}%`}>
						<img
							src={src}
							alt={result.name}
							style={{ width: "100%", maxWidth: "none", maxHeight: "none" }}
							onError={onImageError}
						/>
					</FigureAnnotator>
				)}
			</div>
		);
	if (route.view === "pdf" && src)
		return (
			<iframe
				className="resource-frame"
				data-preview-kind="pdf"
				src={`${src}#toolbar=1&navpanes=0&view=FitH`}
				title={result.name}
			/>
		);
	if (route.view === "text")
		return (
			<ResourceTextPreview
				key={result.path}
				text={result.text || ""}
				name={result.name}
				onNavigate={onNavigate}
				source={source}
				path={result.path}
			/>
		);
	return (
		<div className="resource-empty" data-preview-kind={route.view}>
			{route.view === "binary" ? (
				<>
					{t("resource.binaryHint")}
					<p>{t("resource.viewer.binaryFormats")}</p>
				</>
			) : (
				<p>{t("resource.viewer.mediaTooLarge")}</p>
			)}
		</div>
	);
}
