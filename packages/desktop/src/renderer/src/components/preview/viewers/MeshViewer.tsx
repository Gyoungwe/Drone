import { type Mesh, parseObj, parseStl, projectMesh } from "@drone/shared";
import { useMemo, useRef, useState } from "react";
import { useT } from "../../../i18n";
import type { PreviewRendererProps } from "../preview-registry";
import { base64Bytes } from "./b64";

const SIZE = 420;
/** STL / OBJ：正交投影 + 平面着色的 SVG 渲染，拖动旋转；超过 6 万面均匀抽样。 */
export function MeshViewer({ result }: PreviewRendererProps) {
	const t = useT();
	const [angle, setAngle] = useState({ yaw: 0.6, pitch: -0.45 });
	const drag = useRef<{ x: number; y: number } | null>(null);
	const parsed = useMemo((): { mesh: Mesh } | { error: string } => {
		try {
			const bytes = base64Bytes(result.data);
			if (!bytes) return { error: t("resource.viewer.mediaTooLarge") };
			return {
				mesh: result.name.toLowerCase().endsWith(".obj")
					? parseObj(new TextDecoder().decode(bytes))
					: parseStl(bytes),
			};
		} catch (e) {
			return { error: `${t("resource.viewer.meshFailed")} ${e instanceof Error ? e.message : String(e)}` };
		}
	}, [result.data, result.name, t]);
	const faces = useMemo(
		() => ("mesh" in parsed ? projectMesh(parsed.mesh, angle.yaw, angle.pitch, SIZE) : []),
		[parsed, angle],
	);
	if ("error" in parsed)
		return (
			<p className="resource-notice" role="status">
				{parsed.error}
			</p>
		);
	return (
		<div className="preview-mesh" data-testid="preview-mesh">
			<p className="resource-data-summary">
				{t("resource.viewer.meshSummary", { faces: parsed.mesh.totalTriangles })}
				{parsed.mesh.count < parsed.mesh.totalTriangles &&
					t("resource.viewer.meshSampled", { shown: parsed.mesh.count })}
			</p>
			<svg
				width={SIZE}
				height={SIZE}
				role="img"
				aria-label={result.name}
				style={{ cursor: "grab", touchAction: "none" }}
				onPointerDown={(e) => {
					drag.current = { x: e.clientX, y: e.clientY };
					(e.target as Element).setPointerCapture?.(e.pointerId);
				}}
				onPointerMove={(e) => {
					if (!drag.current) return;
					const dx = e.clientX - drag.current.x,
						dy = e.clientY - drag.current.y;
					drag.current = { x: e.clientX, y: e.clientY };
					setAngle((a) => ({
						yaw: a.yaw + dx * 0.01,
						pitch: Math.max(-1.5, Math.min(1.5, a.pitch + dy * 0.01)),
					}));
				}}
				onPointerUp={() => {
					drag.current = null;
				}}
			>
				{faces.map((f, i) => {
					const l = Math.round(70 + f.shade * 160);
					return (
						<polygon
							// biome-ignore lint/suspicious/noArrayIndexKey: faces re-sorted per frame, index is the paint order
							key={i}
							points={f.points}
							fill={`rgb(${l},${l},${Math.min(255, l + 12)})`}
							stroke="none"
						/>
					);
				})}
			</svg>
			<p className="resource-data-summary">{t("resource.viewer.meshHint")}</p>
		</div>
	);
}
