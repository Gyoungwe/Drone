// biome-ignore-all lint/suspicious/noArrayIndexKey: Static read-only cells are keyed by position, never editable list identities.
import { isLocalResourceTarget } from "@drone/shared";
import { lexer } from "marked";
import { createElement, type ReactNode, useMemo } from "react";
import { ResourceCode } from "./ResourceCode";

type Cell = { text: string; tokens?: Node[] };
type Node = {
	type: string;
	raw?: string;
	text?: string;
	tokens?: Node[];
	depth?: number;
	lang?: string;
	href?: string;
	items?: Node[];
	ordered?: boolean;
	start?: number;
	task?: boolean;
	checked?: boolean;
	header?: Cell[];
	rows?: Cell[][];
};
const slug = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^\p{L}\p{N}_-]+/gu, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 120);
const decodeEntities = (value: string) =>
	value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, entity: string) => {
		const named: Record<string, string> = {
			amp: "&",
			lt: "<",
			gt: ">",
			quot: '"',
			apos: "'",
			nbsp: "\u00a0",
		};
		if (!entity.startsWith("#")) return named[entity.toLowerCase()] || raw;
		const n =
			entity[1]?.toLowerCase() === "x"
				? Number.parseInt(entity.slice(2), 16)
				: Number.parseInt(entity.slice(1), 10);
		return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "�";
	});
/** Token-to-React renderer. No raw HTML, MDX execution, automatic image loads, or innerHTML. */
export function ResourceMarkdown({
	text,
	onNavigate,
}: {
	text: string;
	onNavigate: (href: string, label?: string) => void;
}) {
	const parsed = useMemo(() => {
		try {
			return { nodes: lexer(text.slice(0, 64000), { gfm: true }) as unknown as Node[], error: false };
		} catch {
			return { nodes: [] as Node[], error: true };
		}
	}, [text]);
	if (parsed.error)
		return (
			<>
				<p className="resource-notice">Markdown 无法解析，显示原文。</p>
				<ResourceCode text={text} />
			</>
		);
	let budget = 2500;
	let clipped = false;
	const render = (nodes: Node[], depth = 0): ReactNode =>
		nodes.map((node, i) => {
			if (--budget < 0 || depth > 24) {
				clipped = true;
				return null;
			}
			const key = `${depth}-${i}`;
			const children = node.tokens ? render(node.tokens, depth + 1) : decodeEntities(node.text || "");
			switch (node.type) {
				case "space":
				case "def":
					return null;
				case "heading":
					return createElement(
						`h${Math.min(6, Math.max(1, node.depth || 1))}`,
						{ key, id: `resource-heading-${slug(node.text || "")}` },
						children,
					);
				case "paragraph":
					return <p key={key}>{children}</p>;
				case "text":
				case "escape":
					return <span key={key}>{children}</span>;
				case "strong":
					return <strong key={key}>{children}</strong>;
				case "em":
					return <em key={key}>{children}</em>;
				case "del":
					return <del key={key}>{children}</del>;
				case "codespan":
					return <code key={key}>{node.text}</code>;
				case "code":
					return (
						<ResourceCode key={key} text={node.text || ""} language={(node.lang || "text").split(/\s/)[0]} />
					);
				case "br":
					return <br key={key} />;
				case "hr":
					return <hr key={key} />;
				case "blockquote":
					return <blockquote key={key}>{children}</blockquote>;
				case "list":
					return node.ordered ? (
						<ol key={key} start={node.start || 1}>
							{render(node.items || [], depth + 1)}
						</ol>
					) : (
						<ul key={key}>{render(node.items || [], depth + 1)}</ul>
					);
				case "list_item":
					return (
						<li key={key}>
							{node.task && (node.checked ? "☑ " : "☐ ")}
							{children}
						</li>
					);
				case "link":
					return (
						<a
							key={key}
							href={
								isLocalResourceTarget(node.href || "") ||
								/^(?:https?:\/\/|mailto:|obsidian:|zotero:|#)/i.test(node.href || "")
									? node.href
									: "#"
							}
							onClick={(e) => {
								e.preventDefault();
								const href = node.href || "";
								if (href.startsWith("#")) {
									try {
										document
											.getElementById(`resource-heading-${slug(decodeURIComponent(href.slice(1)))}`)
											?.scrollIntoView({ block: "start" });
									} catch {}
									return;
								}
								onNavigate(href, node.text);
							}}
						>
							{children}
						</a>
					);
				case "image":
					return (
						<button
							type="button"
							className="resource-image-reference"
							key={key}
							onClick={() => onNavigate(node.href || "", node.text)}
						>
							图片：{node.text || "未命名"} · 点击预览
						</button>
					);
				case "table":
					if (
						(node.header?.length || 0) > 60 ||
						(node.rows?.length || 0) > 200 ||
						node.rows?.some((r) => r.length > 60)
					)
						clipped = true;
					return (
						<div className="resource-table-scroll" key={key}>
							<table>
								<thead>
									<tr>
										{node.header?.slice(0, 60).map((c, j) => (
											<th key={`h-${j}`}>{c.tokens ? render(c.tokens, depth + 1) : c.text}</th>
										))}
									</tr>
								</thead>
								<tbody>
									{node.rows?.slice(0, 200).map((row, j) => (
										<tr key={`r-${j}`}>
											{row.slice(0, 60).map((c, k) => (
												<td key={`c-${k}`}>{c.tokens ? render(c.tokens, depth + 1) : c.text}</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					);
				case "html":
					return (
						<code key={key} className="resource-html-literal">
							{node.raw}
						</code>
					);
				default:
					return <span key={key}>{node.raw || node.text}</span>;
			}
		});
	const body = render(parsed.nodes);
	return (
		<article className="resource-markdown" data-testid="resource-markdown">
			{text.length > 64000 && (
				<p className="resource-notice">Markdown 仅排版前 64,000 字符；可切换源码或外部打开。</p>
			)}
			{body}
			{clipped && (
				<p className="resource-notice">
					文档结构超过预览上限（2,500 个标记、24 层、表格 200 行／60
					列），后续结构已省略；请在外部查看完整文件。
				</p>
			)}
			<p className="resource-preview-footnote">只读排版 · 原始 HTML 不执行 · 图片按需打开</p>
		</article>
	);
}
