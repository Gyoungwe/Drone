// biome-ignore-all lint/suspicious/noArrayIndexKey: Bounded immutable preview positions, not editable record identities.
import { looksAligned, resourceFormat, sequencePreview, tablePreview } from "@drone/shared";
import { useEffect, useMemo, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { FigureAnnotator, type FigureSource } from "./FigureAnnotator";
import { AlignmentReader, TreeReader } from "./ResourceBioViewers";
import { ResourceCode } from "./ResourceCode";
import { ResourceMarkdown } from "./ResourceMarkdown";
/** CSP + an empty sandbox deny scripts, forms, popups, remote subresources and privileged APIs. */
export function htmlPreviewDocument(html: string): string {
	// Template content is inert: it is never attached to the application DOM.
	const template = document.createElement("template");
	template.innerHTML = html.slice(0, 128 * 1024);
	template.content.querySelectorAll("script,iframe,object,embed,base,meta,link,template").forEach((el) => {
		el.remove();
	});
	for (const el of template.content.querySelectorAll("*")) {
		for (const attr of [...el.attributes]) {
			if (
				/^on/i.test(attr.name) ||
				["href", "xlink:href", "action", "formaction", "srcdoc", "target", "ping"].includes(
					attr.name.toLowerCase(),
				)
			)
				el.removeAttribute(attr.name);
		}
	}
	return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>body{font:15px/1.7 system-ui,sans-serif;padding:20px;margin:0;color:#202124;background:white;overflow-wrap:anywhere}img,svg,table{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px}pre{white-space:pre-wrap}</style></head><body>${template.innerHTML}</body></html>`;
}
function TableReader({ text, ext }: { text: string; ext: string }) {
	const t = useT();
	const [header, setHeader] = useState(true),
		[query, setQuery] = useState(""),
		[page, setPage] = useState(0);
	const table = useMemo(() => tablePreview(text, ext, header), [text, ext, header]);
	const rows = useMemo(
		() =>
			table.rows.filter(
				(row) => !query || row.some((cell) => cell.toLowerCase().includes(query.toLowerCase())),
			),
		[table, query],
	);
	const pageCount = Math.max(1, Math.ceil(rows.length / 50)),
		current = Math.min(page, pageCount - 1);
	return (
		<div className="resource-table-reader" data-testid="resource-table">
			<div className="resource-data-tools">
				<input
					aria-label={t("resource.viewer.filterLabel")}
					placeholder={t("resource.viewer.filterPlaceholder")}
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setPage(0);
					}}
				/>
				{["csv", "tsv"].includes(ext) && (
					<label>
						<input
							type="checkbox"
							checked={header}
							onChange={(e) => {
								setHeader(e.target.checked);
								setPage(0);
							}}
						/>
						{t("resource.viewer.firstRowHeader")}
					</label>
				)}
			</div>
			<p className="resource-data-summary">
				{t("resource.viewer.tableSummary", { rows: table.rows.length, cols: table.headers.length })}
				{query && t("resource.viewer.tableFiltered", { rows: rows.length })}
				{t("resource.viewer.notWholeFile")}
			</p>
			{table.clipped && <p className="resource-notice">{t("resource.viewer.tableClipped")}</p>}
			{table.warnings.map((w) => (
				<p key={w} className="resource-notice">
					{w}
				</p>
			))}
			{!!table.metadata.length && (
				<details className="resource-metadata">
					<summary>{t("resource.viewer.metadata")}</summary>
					<pre>{table.metadata.join("\n")}</pre>
				</details>
			)}
			{rows.length ? (
				<div className="resource-table-scroll">
					<table>
						<thead>
							<tr>
								<th scope="col">{t("resource.viewer.rowIndex")}</th>
								{table.headers.map((h, i) => (
									<th scope="col" key={`h-${i}`}>
										{h || t("resource.viewer.column", { n: i + 1 })}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{rows.slice(current * 50, current * 50 + 50).map((row, i) => (
								<tr key={`r-${i}`}>
									<td className="resource-row-index">{current * 50 + i + 1}</td>
									{table.headers.map((_, j) => (
										<td key={`c-${j}`}>
											<span>{row[j] ?? ""}</span>
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : (
				<p className="resource-empty">{t("resource.viewer.noRecords")}</p>
			)}
			<div className="resource-data-tools">
				<button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>
					{t("resource.viewer.prevPage")}
				</button>
				<span>
					{current + 1} / {pageCount}
				</span>
				<button type="button" disabled={current + 1 >= pageCount} onClick={() => setPage(current + 1)}>
					{t("resource.viewer.nextPage")}
				</button>
			</div>
		</div>
	);
}
function SequenceReader({ text, kind }: { text: string; kind: "fasta" | "fastq" }) {
	const t = useT();
	const parsed = useMemo(() => sequencePreview(text, kind), [text, kind]);
	return (
		<div className="resource-sequences" data-testid="resource-sequences">
			<p className="resource-data-summary">
				{t("resource.viewer.seqSummary", { kind: kind.toUpperCase(), count: parsed.records.length })}
			</p>
			<p className="resource-preview-footnote">{t("resource.viewer.seqFootnote")}</p>
			{parsed.warnings.map((w) => (
				<p className="resource-notice" key={w}>
					{w}
				</p>
			))}
			{parsed.clipped && <p className="resource-notice">{t("resource.viewer.seqClipped")}</p>}
			{parsed.records.map((r, i) => (
				<details className="resource-sequence" key={`seq-${i}`} open={i === 0}>
					<summary>
						{r.name || t("resource.viewer.unnamedSequence")}
						<span>{t("resource.viewer.seqLength", { n: r.length })}</span>
						{r.warning && <span>{t("resource.viewer.seqIncomplete")}</span>}
					</summary>
					{r.warning && <p className="resource-notice">{r.warning}</p>}
					<div className="resource-sequence-scroll">
						<pre>
							{Array.from({ length: Math.ceil(r.sequence.length / 60) }, (_, line) => (
								<span className="resource-sequence-line" key={`line-${line}`}>
									<span className="resource-base-offset">{line * 60 + 1}</span>
									{[...r.sequence.slice(line * 60, line * 60 + 60)].map((base, j) => (
										<span
											key={`base-${j}`}
											className={`resource-base base-${/[ACGTU]/i.test(base) ? base.toUpperCase() : "other"}`}
										>
											{base}
											{j % 10 === 9 ? " " : ""}
										</span>
									))}
								</span>
							))}
						</pre>
						{r.quality !== undefined && (
							<>
								<h5>{t("resource.viewer.qualityTitle")}</h5>
								<pre className="resource-quality">{r.quality}</pre>
							</>
						)}
					</div>
				</details>
			))}
			{!parsed.records.length && <p className="resource-empty">{t("resource.viewer.seqNoHeader")}</p>}
		</div>
	);
}
/** HTML 图：默认静态隔离预览；用户可切到交互模式（drone-html:// + sandbox allow-scripts，无同源、无网络） */
function HtmlPreview({
	text,
	name,
	source,
	path,
}: {
	text: string;
	name: string;
	source?: FigureSource;
	path?: string;
}) {
	const t = useT();
	const [interactive, setInteractive] = useState(false);
	const [url, setUrl] = useState<string | null>(null);
	const [error, setError] = useState("");
	const href = source?.href;
	const cwd = source?.cwd;
	useEffect(() => {
		setUrl(null);
		setError("");
		if (!interactive || !href) return;
		let cancelled = false;
		void getPi()
			.htmlPreviewUrl(href, cwd)
			.then((next) => {
				if (!cancelled) setUrl(next);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setInteractive(false);
				setError(
					t("resource.html.interactiveFailed", { error: err instanceof Error ? err.message : String(err) }),
				);
			});
		return () => {
			cancelled = true;
		};
	}, [interactive, href, cwd, t]);
	const frame =
		interactive && url ? (
			<iframe
				title={name}
				className="resource-html-frame"
				sandbox="allow-scripts"
				referrerPolicy="no-referrer"
				src={url}
			/>
		) : (
			<iframe
				title={name}
				className="resource-html-frame"
				sandbox=""
				referrerPolicy="no-referrer"
				srcDoc={htmlPreviewDocument(text)}
			/>
		);
	return (
		<>
			<p className="resource-notice">
				{interactive ? t("resource.html.interactiveNotice") : t("resource.html.staticNotice")}
			</p>
			{error && (
				<p role="alert" className="resource-notice">
					{error}
				</p>
			)}
			{source && (
				<div className="resource-data-tools">
					<button type="button" aria-pressed={interactive} onClick={() => setInteractive(!interactive)}>
						{interactive ? t("resource.html.static") : t("resource.html.interactive")}
					</button>
				</div>
			)}
			{source ? (
				<FigureAnnotator source={source} name={name} path={path ?? source.href} block>
					{frame}
				</FigureAnnotator>
			) : (
				frame
			)}
		</>
	);
}
/** FASTA：像比对结果（含 gap、等长）时默认按比对查看，可切回逐条序列 */
function FastaReader({ text }: { text: string }) {
	const t = useT();
	const aligned = useMemo(() => looksAligned(text), [text]);
	const [asAlignment, setAsAlignment] = useState(true);
	if (!aligned) return <SequenceReader text={text} kind="fasta" />;
	return (
		<>
			<div className="resource-data-tools">
				<button type="button" onClick={() => setAsAlignment(!asAlignment)}>
					{asAlignment ? t("resource.alignment.viewAsSequences") : t("resource.alignment.viewAsAlignment")}
				</button>
			</div>
			{asAlignment ? (
				<AlignmentReader text={text} ext="fasta" />
			) : (
				<SequenceReader text={text} kind="fasta" />
			)}
		</>
	);
}
export function ResourceTextPreview({
	text,
	name,
	onNavigate,
	source,
	path,
}: {
	text: string;
	name: string;
	onNavigate: (href: string, label?: string) => void;
	/** 预览目标（用于交互 HTML 与图标注）；缺省时只做静态预览 */
	source?: FigureSource;
	path?: string;
}) {
	const t = useT();
	const format = resourceFormat(name);
	const json = useMemo(() => {
		if (format.kind !== "json") return null;
		try {
			const value: unknown = JSON.parse(text);
			const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
			let visited = 0;
			while (pending.length) {
				const next = pending.pop();
				if (!next) break;
				if (++visited > 10000 || next.depth > 32) return { valid: false, text };
				if (next.value && typeof next.value === "object") {
					const children = Object.values(next.value);
					if (children.length + pending.length > 10000) return { valid: false, text };
					pending.push(...children.map((value) => ({ value, depth: next.depth + 1 })));
				}
			}
			return { valid: true, text: JSON.stringify(value, null, 2) };
		} catch {
			return { valid: false, text };
		}
	}, [text, format.kind]);
	if (format.kind === "markdown") return <ResourceMarkdown text={text} onNavigate={onNavigate} />;
	if (format.kind === "table") return <TableReader text={text} ext={format.ext} />;
	if (format.kind === "fasta") return <FastaReader text={text} />;
	if (format.kind === "fastq") return <SequenceReader text={text} kind="fastq" />;
	if (format.kind === "alignment") return <AlignmentReader text={text} ext={format.ext} />;
	if (format.kind === "tree") return <TreeReader text={text} />;
	if (format.kind === "html") return <HtmlPreview text={text} name={name} source={source} path={path} />;
	return (
		<>
			{json && !json.valid && <p className="resource-notice">{t("resource.viewer.jsonInvalid")}</p>}
			<ResourceCode text={json?.text ?? text} language={format.language} />
		</>
	);
}
