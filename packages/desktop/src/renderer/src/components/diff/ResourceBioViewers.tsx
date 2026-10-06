// biome-ignore-all lint/suspicious/noArrayIndexKey: Bounded immutable preview positions, not editable record identities.
import {
	ALIGNMENT_MAX_RECORDS,
	alignmentPreview,
	columnConservation,
	isNucleotideAlignment,
	layoutTree,
	parseNewick,
	residueClass,
	type TreeLayout,
} from "@drone/shared";
import { useMemo, useState } from "react";
import { useT } from "../../i18n";

const ROW = 16;
const LABEL_WIDTH = 220;
const PLOT_WIDTH = 420;

function treeOrError(text: string): { layout: TreeLayout } | { error: string } {
	try {
		return { layout: layoutTree(parseNewick(text)) };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

/** Newick 系统发育树：矩形图，按枝长（或层级）绘制，叶名在右侧 */
export function TreeReader({ text }: { text: string }) {
	const t = useT();
	const [support, setSupport] = useState(true);
	const result = useMemo(() => treeOrError(text), [text]);
	if ("error" in result)
		return <p className="resource-notice">{t("resource.tree.parseFailed", { error: result.error })}</p>;
	const { layout } = result;
	const scale = PLOT_WIDTH / Math.max(layout.depth, 1e-9);
	const height = Math.max(1, layout.leaves) * ROW + ROW;
	const x = (value: number) => 10 + value * scale;
	const y = (value: number) => ROW / 2 + 4 + value * ROW;
	const byId = layout.nodes;
	const scaleBar = layout.hasLengths ? niceScale(layout.depth) : 0;
	return (
		<div className="resource-tree" data-testid="resource-tree">
			<p className="resource-data-summary">{t("resource.tree.summary", { leaves: layout.leaves })}</p>
			<p className="resource-preview-footnote">
				{layout.hasLengths ? t("resource.tree.scaleLengths") : t("resource.tree.scaleDepth")}
			</p>
			<label className="resource-data-tools">
				<input type="checkbox" checked={support} onChange={(event) => setSupport(event.target.checked)} />
				{t("resource.tree.support")}
			</label>
			<div className="resource-tree-scroll">
				<svg
					role="img"
					aria-label={t("resource.tree.summary", { leaves: layout.leaves })}
					width={PLOT_WIDTH + LABEL_WIDTH + 20}
					height={height + (scaleBar ? 24 : 0)}
				>
					{byId.map((node) => {
						if (node.parent === null) return null;
						const parent = byId[node.parent];
						if (!parent) return null;
						return (
							<path
								key={`e-${node.id}`}
								className="resource-tree-edge"
								d={`M${x(parent.x)},${y(parent.y)} V${y(node.y)} H${x(node.x)}`}
							/>
						);
					})}
					{byId.map((node) =>
						node.leaf ? (
							<text key={`l-${node.id}`} className="resource-tree-leaf" x={x(node.x) + 4} y={y(node.y) + 4}>
								{node.name || "—"}
							</text>
						) : support && node.name ? (
							<text
								key={`s-${node.id}`}
								className="resource-tree-support"
								x={x(node.x) + 3}
								y={y(node.y) - 3}
							>
								{node.name}
							</text>
						) : null,
					)}
					{scaleBar > 0 && (
						<g className="resource-tree-scale">
							<path d={`M10,${height + 8} H${10 + scaleBar * scale}`} />
							<text x={12 + scaleBar * scale} y={height + 12}>
								{scaleBar}
							</text>
						</g>
					)}
				</svg>
			</div>
		</div>
	);
}

/** 约为树深 1/5 的整齐标尺长度（1/2/5 × 10^k） */
function niceScale(depth: number): number {
	if (!(depth > 0)) return 0;
	const target = depth / 5;
	const power = 10 ** Math.floor(Math.log10(target));
	const step = [1, 2, 5, 10].find((m) => m * power >= target) ?? 10;
	return Number((step * power).toPrecision(3));
}

const WINDOW = 120;

/** 列号标尺：每 10 列在该列处右对齐写列号 */
export function alignmentRuler(start: number, end: number): string {
	const chars = Array.from({ length: end - start }, () => " ");
	for (let column = start + 1; column <= end; column++) {
		if (column % 10 !== 0) continue;
		const label = String(column);
		const last = column - start - 1;
		for (let i = 0; i < label.length; i++) {
			const at = last - label.length + 1 + i;
			if (at >= 0) chars[at] = label[i] ?? " ";
		}
	}
	return chars.join("");
}

/** 多序列比对：按列分窗查看，残基着色 + 保守度条 */
export function AlignmentReader({ text, ext }: { text: string; ext: string }) {
	const t = useT();
	const parsed = useMemo(() => alignmentPreview(text, ext), [text, ext]);
	const nucleotide = useMemo(() => isNucleotideAlignment(parsed.records), [parsed]);
	const [start, setStart] = useState(0);
	const end = Math.min(parsed.length, start + WINDOW);
	const conservation = useMemo(() => columnConservation(parsed.records, start, end), [parsed, start, end]);
	const nameWidth = Math.min(24, Math.max(4, ...parsed.records.map((record) => record.name.length)));
	return (
		<div className="resource-alignment" data-testid="resource-alignment">
			<p className="resource-data-summary">
				{t("resource.alignment.summary", {
					format: parsed.format.toUpperCase(),
					records: parsed.records.length,
					length: parsed.length,
				})}
			</p>
			<p className="resource-preview-footnote">{t("resource.alignment.footnote")}</p>
			{parsed.clipped && (
				<p className="resource-notice">{t("resource.alignment.clipped", { max: ALIGNMENT_MAX_RECORDS })}</p>
			)}
			{parsed.warnings.map((warning) => (
				<p key={warning} className="resource-notice">
					{warning}
				</p>
			))}
			{parsed.length > WINDOW && (
				<div className="resource-data-tools">
					<button type="button" disabled={start === 0} onClick={() => setStart(Math.max(0, start - WINDOW))}>
						{t("resource.alignment.prev")}
					</button>
					<span>{t("resource.alignment.columns", { start: start + 1, end })}</span>
					<button type="button" disabled={end >= parsed.length} onClick={() => setStart(start + WINDOW)}>
						{t("resource.alignment.next")}
					</button>
				</div>
			)}
			<div className="resource-alignment-scroll">
				<pre>
					<span className="resource-alignment-row resource-alignment-ruler">
						<span className="resource-alignment-name">{" ".repeat(nameWidth)}</span>
						{alignmentRuler(start, end)}
					</span>
					{parsed.records.map((record, row) => (
						<span key={`r-${row}`} className="resource-alignment-row">
							<span className="resource-alignment-name" title={record.name}>
								{record.name.slice(0, nameWidth).padEnd(nameWidth)}
							</span>
							{[...record.sequence.slice(start, end)].map((residue, i) => (
								<span key={`c-${i}`} className={`resource-residue res-${residueClass(residue, nucleotide)}`}>
									{residue}
								</span>
							))}
						</span>
					))}
					<span className="resource-alignment-row" title={t("resource.alignment.conservation")}>
						<span className="resource-alignment-name">
							{t("resource.alignment.conservation").slice(0, nameWidth).padEnd(nameWidth)}
						</span>
						{conservation.map((value, i) => (
							<span key={`k-${i}`} className="resource-conservation" style={{ opacity: 0.15 + value * 0.85 }}>
								{value >= 1 ? "*" : value >= 0.8 ? ":" : value >= 0.5 ? "." : " "}
							</span>
						))}
					</span>
				</pre>
			</div>
		</div>
	);
}
