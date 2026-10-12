import { heatmapGrid, parseNpy } from "@drone/shared";
import { useMemo } from "react";
import { useT } from "../../../i18n";
import type { PreviewRendererProps } from "../preview-registry";
import { base64Bytes } from "./b64";

/** viridis 近似（5 色线性插值），纯 SVG 绘制便于测试与截图。 */
const STOPS = [
	[68, 1, 84],
	[59, 82, 139],
	[33, 145, 140],
	[94, 201, 98],
	[253, 231, 37],
];
export function viridis(t: number): string {
	const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (STOPS.length - 1);
	const i = Math.min(STOPS.length - 2, Math.floor(x)),
		f = x - i;
	const a = STOPS[i] ?? [0, 0, 0],
		b = STOPS[i + 1] ?? [0, 0, 0];
	return `rgb(${a.map((v, k) => Math.round(v + ((b[k] ?? 0) - v) * f)).join(",")})`;
}

export function NpyViewer({ result }: PreviewRendererProps) {
	const t = useT();
	const parsed = useMemo(() => {
		try {
			const bytes = base64Bytes(result.data);
			if (!bytes) return { error: "tooLarge" as const };
			const array = parseNpy(bytes);
			return { array, grid: heatmapGrid(array, 96) };
		} catch (e) {
			return { error: e instanceof Error ? e.message : String(e) };
		}
	}, [result.data]);
	if ("error" in parsed)
		return (
			<p className="resource-notice" role="status">
				{parsed.error === "tooLarge"
					? t("resource.viewer.mediaTooLarge")
					: `${t("resource.viewer.npyFailed")} ${parsed.error}`}
			</p>
		);
	const { array, grid } = parsed;
	const cell = Math.max(2, Math.floor(480 / Math.max(grid.cols, grid.rows)));
	const span = grid.max - grid.min || 1;
	return (
		<div className="preview-npy" data-testid="preview-npy">
			<p className="resource-data-summary">
				{t("resource.viewer.npySummary", { dtype: array.dtype, shape: array.shape.join(" × ") || "()" })}
				{array.shape.length > 2 && t("resource.viewer.npySlice")}
			</p>
			<svg
				width={grid.cols * cell}
				height={grid.rows * cell}
				viewBox={`0 0 ${grid.cols} ${grid.rows}`}
				preserveAspectRatio="none"
				shapeRendering="crispEdges"
				role="img"
				aria-label="heatmap"
			>
				{Array.from({ length: grid.rows * grid.cols }, (_, i) => {
					const v = grid.cells[i] ?? Number.NaN;
					return (
						<rect
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed grid positions
							key={i}
							x={i % grid.cols}
							y={Math.floor(i / grid.cols)}
							width={1.02}
							height={1.02}
							fill={Number.isFinite(v) ? viridis((v - grid.min) / span) : "#ccc"}
						/>
					);
				})}
			</svg>
			<div className="preview-npy-scale">
				<span>{grid.min.toPrecision(4)}</span>
				<span className="preview-npy-bar" />
				<span>{grid.max.toPrecision(4)}</span>
			</div>
		</div>
	);
}
