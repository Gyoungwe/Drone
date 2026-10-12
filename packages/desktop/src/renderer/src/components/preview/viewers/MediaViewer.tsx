import { useT } from "../../../i18n";
import type { PreviewRendererProps } from "../preview-registry";

/** 音视频：主进程 16 MiB 内整读为 data URL；超限提示外部打开。 */
export function MediaViewer({ result, src }: PreviewRendererProps) {
	const t = useT();
	if (!src) return <div className="resource-empty">{t("resource.viewer.mediaTooLarge")}</div>;
	const video = result.mimeType.startsWith("video/");
	return (
		<div className="resource-media preview-media" data-testid={video ? "preview-video" : "preview-audio"}>
			{video ? (
				// biome-ignore lint/a11y/useMediaCaption: user files have no caption track
				<video controls src={src} style={{ maxWidth: "100%" }} />
			) : (
				// biome-ignore lint/a11y/useMediaCaption: user files have no caption track
				<audio controls src={src} />
			)}
		</div>
	);
}
