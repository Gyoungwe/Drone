import { type Axis, parseVolume, sliceToRgba, volumeMip, volumeSlice } from "@drone/shared";
import { useMemo, useState } from "react";
import { useT } from "../../../i18n";
import type { PreviewRendererProps } from "../preview-registry";
import { base64Bytes } from "./b64";
import { RgbaCanvas } from "./RgbaCanvas";

const AXES: Axis[] = ["z", "y", "x"];

/** 体数据预览（P4）：NIfTI / MRC 三正交切片 + 滑块，另附 z 向最大强度投影。 */
export function VolumeViewer({ result }: PreviewRendererProps) {
	const t = useT();
	const parsed = useMemo(() => {
		const bytes = base64Bytes(result.data);
		if (!bytes) return { error: t("resource.viewer.mediaTooLarge") };
		try {
			return { vol: parseVolume(bytes, result.name) };
		} catch (e) {
			return { error: `${t("resource.viewer.volumeFailed")} ${e instanceof Error ? e.message : String(e)}` };
		}
	}, [result.data, result.name, t]);
	const vol = "vol" in parsed ? parsed.vol : null;
	const [index, setIndex] = useState<Record<Axis, number> | null>(null);
	const idx = index ?? {
		x: Math.floor((vol?.dims[0] ?? 1) / 2),
		y: Math.floor((vol?.dims[1] ?? 1) / 2),
		z: Math.floor((vol?.dims[2] ?? 1) / 2),
	};
	const [showMip, setShowMip] = useState(false);
	if (!vol)
		return (
			<p className="resource-notice" role="status">
				{parsed.error}
			</p>
		);
	const limit: Record<Axis, number> = { x: vol.dims[0], y: vol.dims[1], z: vol.dims[2] };
	return (
		<div className="preview-volume" data-testid="preview-volume">
			<p className="resource-data-summary">
				{t("resource.viewer.volumeSummary", {
					format: vol.format === "nifti" ? "NIfTI" : "MRC",
					dims: vol.dims.join(" × "),
					dtype: vol.dtype,
					spacing: vol.spacing.map((s) => s.toPrecision(3)).join(" × "),
				})}
			</p>
			<div className="preview-volume-grid">
				{AXES.map((axis) => {
					const slice = volumeSlice(vol, axis, idx[axis]);
					return (
						<figure key={axis} className="preview-volume-cell" data-testid={`volume-slice-${axis}`}>
							<RgbaCanvas
								rgba={sliceToRgba(slice, vol.min, vol.max)}
								width={slice.width}
								height={slice.height}
								label={`slice ${axis}`}
								displayWidth={180}
							/>
							<figcaption>
								<span>
									{axis.toUpperCase()} {idx[axis] + 1}/{limit[axis]}
								</span>
								<input
									type="range"
									min={0}
									max={limit[axis] - 1}
									value={idx[axis]}
									aria-label={`${axis} slice`}
									onChange={(e) => setIndex({ ...idx, [axis]: Number(e.target.value) })}
								/>
							</figcaption>
						</figure>
					);
				})}
				<figure className="preview-volume-cell">
					{showMip ? (
						(() => {
							const mip = volumeMip(vol);
							return (
								<RgbaCanvas
									rgba={sliceToRgba(mip, vol.min, vol.max)}
									width={mip.width}
									height={mip.height}
									label="mip"
									displayWidth={180}
								/>
							);
						})()
					) : (
						<div className="preview-volume-placeholder" />
					)}
					<figcaption>
						<button type="button" className="preview-volume-mip" onClick={() => setShowMip((v) => !v)}>
							{t("resource.viewer.volumeMip")}
						</button>
					</figcaption>
				</figure>
			</div>
		</div>
	);
}
