// biome-ignore-all lint/suspicious/noArrayIndexKey: Static read-only cells are keyed by position, never editable list identities.
import { isLocalResourceTarget, resourceHeadingId, splitResourceLink } from "@drone/shared";
import MarkdownRender, {
	type NodeComponentProps,
	type NodeRendererProps,
	setCustomComponents,
} from "markstream-react";
import { Component, createContext, createElement, type ReactNode, useContext, useMemo } from "react";
import { useT } from "../../i18n";
import { ResourceCode } from "./ResourceCode";
import {
	boundResourceNodes,
	boundResourceSource,
	RESOURCE_CLIPPED_NODE,
	type ResourceFenceNode,
	type ResourceNode,
} from "./resource-markdown-limits";

const RESOURCE_MARKDOWN_ID = "resource-markdown";
type Navigate = (href: string, label?: string) => void;
type NodeProps<Kind extends string> = NodeComponentProps<ResourceNode<Kind>>;
const NavigateContext = createContext<Navigate | null>(null);

const validateLink = () => true;
const customMarkdownIt: NonNullable<NodeRendererProps["customMarkdownIt"]> = (markdown) => {
	markdown.set({ validateLink });
	return markdown;
};

function renderChildren({
	node,
	ctx,
	renderNode,
	indexKey,
}: NodeProps<"heading" | "link" | "table_cell" | "strikethrough">) {
	if (!ctx || !renderNode) return null;
	return node.children.map((child, index) => renderNode(child, `${String(indexKey)}-${index}`, ctx));
}

function ResourceHeading(props: NodeProps<"heading">) {
	const { node } = props;
	const level = Math.min(6, Math.max(1, node.level));
	return createElement(`h${level}`, { id: resourceHeadingId(node.text) }, renderChildren(props));
}

function ResourceLink(props: NodeProps<"link">) {
	const { href, text } = props.node;
	const navigate = useContext(NavigateContext);
	const safeHref = isLocalResourceTarget(href) || /^(?:https?:\/\/|mailto:|obsidian:|zotero:|#)/i.test(href);
	return (
		<a
			href={safeHref ? href : "#"}
			onClick={(event) => {
				event.preventDefault();
				if (href.startsWith("#")) {
					const id = resourceHeadingId(splitResourceLink(href).fragment ?? "");
					const localHeading = event.currentTarget.closest("article")?.querySelector(`[id="${id}"]`);
					(localHeading ?? document.getElementById(id))?.scrollIntoView({ block: "start" });
					return;
				}
				navigate?.(href, text);
			}}
		>
			{renderChildren(props)}
		</a>
	);
}

function ResourceImage({ node }: NodeProps<"image">) {
	const t = useT();
	const navigate = useContext(NavigateContext);
	return (
		<button type="button" className="resource-image-reference" onClick={() => navigate?.(node.src, node.alt)}>
			{t("resource.viewer.imageReference", { name: node.alt || t("resource.viewer.unnamed") })}
		</button>
	);
}

function ResourceTable(props: NodeProps<"table">) {
	const { node, indexKey } = props;
	const cells = (row: ResourceNode<"table_row">, rowKey: string, Cell: "th" | "td") =>
		row.cells.map((cell, index) => {
			const key = `${rowKey}-${index}`;
			return <Cell key={key}>{renderChildren({ ...props, node: cell, indexKey: key })}</Cell>;
		});
	return (
		<div className="resource-table-scroll">
			<table>
				<thead>
					<tr>{cells(node.header, `${indexKey}-header`, "th")}</tr>
				</thead>
				<tbody>
					{node.rows.map((row, index) => {
						const key = `${indexKey}-row-${index}`;
						return <tr key={key}>{cells(row, key, "td")}</tr>;
					})}
				</tbody>
			</table>
		</div>
	);
}

function ResourceFence({ node }: NodeComponentProps<ResourceFenceNode>) {
	const language = (node.sourceLanguage ?? node.language).trim().split(/\s+/)[0] || "text";
	return <ResourceCode text={node.code} language={language} />;
}

function ResourceHtml({ node }: NodeProps<"html_block" | "html_inline">) {
	return <code className="resource-html-literal">{node.raw || node.content}</code>;
}

function ResourceMath({ node }: NodeProps<"math_block" | "math_inline">) {
	const literal = node.raw || node.content;
	return node.type === "math_block" ? <pre>{literal}</pre> : <code>{literal}</code>;
}

function ResourceCheckbox({ node }: NodeProps<"checkbox" | "checkbox_input">) {
	return <span>{node.checked ? "☑ " : "☐ "}</span>;
}

function ResourceClippedNotice() {
	const t = useT();
	return <p className="resource-notice">{t("resource.viewer.markdownTooComplex")}</p>;
}

setCustomComponents(RESOURCE_MARKDOWN_ID, {
	code_block: ResourceFence,
	mermaid: ResourceFence,
	infographic: ResourceFence,
	d2: ResourceFence,
	html_block: ResourceHtml,
	html_inline: ResourceHtml,
	image: ResourceImage,
	heading: ResourceHeading,
	link: ResourceLink,
	table: ResourceTable,
	math_block: ResourceMath,
	math_inline: ResourceMath,
	checkbox: ResourceCheckbox,
	checkbox_input: ResourceCheckbox,
	strikethrough: (props: NodeProps<"strikethrough">) => <del>{renderChildren(props)}</del>,
	[RESOURCE_CLIPPED_NODE]: ResourceClippedNotice,
});

const ResourceMarkdownBoundary = class extends Component<{ children: ReactNode; fallback: ReactNode }> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}

	render() {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
};

export function ResourceMarkdown({ text, onNavigate }: { text: string; onNavigate: Navigate }) {
	const t = useT();
	const { content, lengthClipped, complexityClipped } = useMemo(() => boundResourceSource(text), [text]);
	const parseOptions = useMemo<NonNullable<NodeRendererProps["parseOptions"]>>(
		() => ({ validateLink, postTransformNodes: (nodes) => boundResourceNodes(nodes, complexityClipped) }),
		[complexityClipped],
	);
	const fallback = (
		<>
			<p className="resource-notice">{t("resource.viewer.markdownInvalid")}</p>
			<ResourceCode text={text} />
		</>
	);
	return (
		<ResourceMarkdownBoundary key={text} fallback={fallback}>
			<article className="resource-markdown" data-testid="resource-markdown">
				{lengthClipped && <p className="resource-notice">{t("resource.viewer.markdownClipped")}</p>}
				<NavigateContext.Provider value={onNavigate}>
					<MarkdownRender
						customId={RESOURCE_MARKDOWN_ID}
						content={content}
						final
						fade={false}
						smoothStreaming={false}
						batchRendering={false}
						maxLiveNodes={0}
						deferNodesUntilVisible={false}
						showTooltips={false}
						htmlPolicy="escape"
						renderCodeBlocksAsPre
						customMarkdownIt={customMarkdownIt}
						parseOptions={parseOptions}
					/>
				</NavigateContext.Provider>
				<p className="resource-preview-footnote">{t("resource.viewer.markdownFootnote")}</p>
			</article>
		</ResourceMarkdownBoundary>
	);
}
