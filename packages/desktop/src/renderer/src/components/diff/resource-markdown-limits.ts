import type { NodeRendererProps } from "markstream-react";

const SOURCE_LIMIT = 64_000;
const PARAGRAPH_LIMIT = 8_000;
const DELIMITER_LIMIT = 400;
const NODE_LIMIT = 2_500;
const DEPTH_LIMIT = 24;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const TABLE_SEPARATOR = /^(?=.*\|) {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?$/;

type ParseOptions = NonNullable<NodeRendererProps["parseOptions"]>;
type ParsedNode = Parameters<NonNullable<ParseOptions["postTransformNodes"]>>[0][number];
export type ResourceNode<Kind extends string> = Extract<ParsedNode, { type: Kind }>;
export type ResourceFenceNode = ResourceNode<"code_block"> & { sourceLanguage?: string };
export const RESOURCE_CLIPPED_NODE = "resource_clipped";

function paragraphCutoff(source: string): number {
	const lines = source.split("\n");
	let offset = 0;
	let length = 0;
	let delimiters = 0;
	let fence = "";
	let table = false;
	for (const [index, line] of lines.entries()) {
		const start = offset;
		offset += line.length + 1;
		const [, marker = "", info = ""] = FENCE.exec(line.trimEnd()) ?? [];
		if (fence) {
			if (marker.startsWith(fence) && !info) fence = "";
			continue;
		}
		if (marker && !(marker.startsWith("`") && info.includes("`"))) {
			fence = marker;
			length = delimiters = 0;
			table = false;
			continue;
		}
		if (!line.trim()) {
			length = delimiters = 0;
			table = false;
			continue;
		}
		table =
			line.includes("|") &&
			(table || (length === 0 && TABLE_SEPARATOR.test(lines[index + 1]?.trimEnd() ?? "")));
		if (table) length = delimiters = 0;
		const prefix = line.slice(0, Math.max(0, PARAGRAPH_LIMIT - length));
		for (const delimiter of prefix.matchAll(/[*_~`[]/g)) {
			if (++delimiters > DELIMITER_LIMIT) return start + delimiter.index;
		}
		if (prefix.length < line.length) return start + prefix.length;
		length += line.length + 1;
	}
	return source.length;
}

export function boundResourceSource(text: string) {
	const sample = text.slice(0, SOURCE_LIMIT);
	const cutoff = paragraphCutoff(sample);
	return {
		content: sample.slice(0, cutoff),
		lengthClipped: text.length > SOURCE_LIMIT,
		complexityClipped: cutoff < sample.length,
	};
}

const CHILD_LIMITS = [
	["children", Number.POSITIVE_INFINITY],
	["items", Number.POSITIVE_INFINITY],
	["term", Number.POSITIVE_INFINITY],
	["definition", Number.POSITIVE_INFINITY],
	["rows", 200],
	["cells", 60],
] as const;

type Branch = (typeof CHILD_LIMITS)[number][0];
type TreeNode = { type: string; header?: TreeNode | boolean } & Partial<
	Record<Branch, readonly TreeNode[] | null>
>;
type Budget = { remaining: number; clipped: boolean };

function boundNode<Node extends TreeNode>(node: Node, depth: number, budget: Budget): Node {
	const result = { ...node };
	if (typeof node.header === "object") {
		budget.remaining--;
		result.header = boundNode(node.header, depth + 1, budget);
	}
	for (const [branch, limit] of CHILD_LIMITS) {
		const children = node[branch];
		if (children) Object.assign(result, { [branch]: boundNodes(children, depth + 1, budget, limit) });
	}
	if (node.type === "code_block" && "language" in node && typeof node.language === "string") {
		const language = node.language;
		if (!/^(?:mermaid|infographic|d2(?:lang)?)(?:[:\s]|$)/i.test(language.trim())) {
			Object.assign(result, { language: "", sourceLanguage: language });
		}
	}
	return result;
}

function boundNodes<Node extends TreeNode>(
	nodes: readonly Node[],
	depth: number,
	budget: Budget,
	limit = nodes.length,
) {
	const bounded: Node[] = [];
	for (const node of nodes.slice(0, limit)) {
		const headerCount = Number(typeof node.header === "object");
		if (depth + headerCount > DEPTH_LIMIT || budget.remaining <= headerCount) break;
		budget.remaining--;
		bounded.push(boundNode(node, depth, budget));
	}
	if (bounded.length < nodes.length) budget.clipped = true;
	return bounded;
}

export function boundResourceNodes(nodes: ParsedNode[], complexityClipped: boolean): ParsedNode[] {
	const budget = { remaining: NODE_LIMIT, clipped: complexityClipped };
	const bounded = boundNodes(nodes, 0, budget);
	return budget.clipped ? [...bounded, { type: RESOURCE_CLIPPED_NODE, raw: "" }] : bounded;
}
