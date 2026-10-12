import { decodeTiff, readTiffInfo } from "@drone/shared";
import { useMemo } from "react";
import { useT } from "../../../i18n";
import type { PreviewRendererProps } from "../preview-registry";
import { base64Bytes } from "./b64";
import { RgbaCanvas } from "./RgbaCanvas";

/** TIFF 预览（P4）：第 1 页像素（无压缩 / PackBits），16 / 32 位按 min–max 拉伸；不支持的压缩只显示元数据。 */
export function TiffViewer({ result }: PreviewRendererProps) {
	const t = useT();
	const parsed = useMemo(() => {
		const bytes = base64Bytes(result.data);
		if (!bytes) return { error: t("resource.viewer.mediaTooLarge") };
		try {
			const info = readTiffInfo(bytes);
			if (info.unsupported)
				return { info, error: `${t("resource.viewer.tiffUnsupported")} ${info.unsupported}` };
			return { info, image: decodeTiff(bytes, 512) };
		} catch (e) {
			return { error: `${t("resource.viewer.tiffFailed")} ${e instanceof Error ? e.message : String(e)}` };
		}
	}, [result.data, t]);
	const info = parsed.info;
	return (
		<div className="preview-tiff" data-testid="preview-tiff">
			{info && (
				<p className="resource-data-summary">
					{t("resource.viewer.tiffSummary", {
						size: `${info.width} × ${info.height}`,
						bits: `${info.bitsPerSample}-bit ${info.sampleFormat}`,
						channels: info.samplesPerPixel,
						pages: info.pages,
					})}
				</p>
			)}
			{"image" in parsed && parsed.image ? (
				<>
					<RgbaCanvas
						rgba={parsed.image.rgba}
						width={parsed.image.outWidth}
						height={parsed.image.outHeight}
						label="tiff"
						displayWidth={Math.min(560, Math.max(parsed.image.outWidth, 240))}
					/>
					{parsed.image.bitsPerSample > 8 && (
						<p className="resource-data-summary">
							{t("resource.viewer.tiffRange", {
								min: parsed.image.min.toPrecision(4),
								max: parsed.image.max.toPrecision(4),
							})}
						</p>
					)}
				</>
			) : (
				<p className="resource-notice" role="status">
					{parsed.error}
				</p>
			)}
		</div>
	);
}
