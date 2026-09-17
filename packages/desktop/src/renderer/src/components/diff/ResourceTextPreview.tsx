// biome-ignore-all lint/suspicious/noArrayIndexKey: Bounded immutable preview positions, not editable record identities.
import { resourceFormat, sequencePreview, tablePreview } from "@drone/shared";
import { useMemo, useState } from "react";
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
					aria-label="筛选预览表格"
					placeholder="筛选当前片段…"
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
						首行表头
					</label>
				)}
			</div>
			<p className="resource-data-summary">
				片段内 {table.rows.length} 行 · {table.headers.length} 列{query && ` · 筛选后 ${rows.length} 行`}
				（不是全文件统计）
			</p>
			{table.clipped && <p className="resource-notice">表格最多显示 200 行、60 列；长单元格也会截断。</p>}
			{table.warnings.map((w) => (
				<p key={w} className="resource-notice">
					{w}
				</p>
			))}
			{!!table.metadata.length && (
				<details className="resource-metadata">
					<summary>文件头／元数据（最多 30 行）</summary>
					<pre>{table.metadata.join("\n")}</pre>
				</details>
			)}
			{rows.length ? (
				<div className="resource-table-scroll">
					<table>
						<thead>
							<tr>
								<th scope="col">序</th>
								{table.headers.map((h, i) => (
									<th scope="col" key={`h-${i}`}>
										{h || `列 ${i + 1}`}
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
				<p className="resource-empty">当前片段没有可显示的记录。</p>
			)}
			<div className="resource-data-tools">
				<button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>
					上一页
				</button>
				<span>
					{current + 1} / {pageCount}
				</span>
				<button type="button" disabled={current + 1 >= pageCount} onClick={() => setPage(current + 1)}>
					下一页
				</button>
			</div>
		</div>
	);
}
function SequenceReader({ text, kind }: { text: string; kind: "fasta" | "fastq" }) {
	const parsed = useMemo(() => sequencePreview(text, kind), [text, kind]);
	return (
		<div className="resource-sequences" data-testid="resource-sequences">
			<p className="resource-data-summary">
				{kind.toUpperCase()} · 当前片段 {parsed.records.length} 条记录（不是全文件统计）
			</p>
			<p className="resource-preview-footnote">
				每条最多显示 600 个序列字符；颜色用于阅读，不进行比对、质控或生物学判断。
			</p>
			{parsed.warnings.map((w) => (
				<p className="resource-notice" key={w}>
					{w}
				</p>
			))}
			{parsed.clipped && <p className="resource-notice">仅展示前 20 条记录／每条 600 字符。</p>}
			{parsed.records.map((r, i) => (
				<details className="resource-sequence" key={`seq-${i}`} open={i === 0}>
					<summary>
						{r.name || "未命名序列"}
						<span> · 本片段读取 {r.length} 字符</span>
						{r.warning && <span> · 不完整／长度不一致</span>}
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
								<h5>质量字符串（原始字符，不推断编码）</h5>
								<pre className="resource-quality">{r.quality}</pre>
							</>
						)}
					</div>
				</details>
			))}
			{!parsed.records.length && (
				<p className="resource-empty">未识别到完整标题，切换源码检查格式或片段边界。</p>
			)}
		</div>
	);
}
export function ResourceTextPreview({
	text,
	name,
	onNavigate,
}: {
	text: string;
	name: string;
	onNavigate: (href: string, label?: string) => void;
}) {
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
	if (format.kind === "fasta" || format.kind === "fastq")
		return <SequenceReader text={text} kind={format.kind} />;
	if (format.kind === "html")
		return (
			<>
				<p className="resource-notice">
					隔离 HTML 预览：脚本、外部子资源、链接跳转和表单已禁用。需要完整交互时请在外部打开。
				</p>
				<iframe
					title="隔离 HTML 文件预览"
					className="resource-html-frame"
					sandbox=""
					referrerPolicy="no-referrer"
					srcDoc={htmlPreviewDocument(text)}
				/>
			</>
		);
	return (
		<>
			{json && !json.valid && (
				<p className="resource-notice">
					JSON 无法格式化（片段不完整、语法无效或嵌套／节点过多），显示原文，不自动修复。
				</p>
			)}
			<ResourceCode text={json?.text ?? text} language={format.language} />
		</>
	);
}
