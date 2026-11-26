/**
 * 聊天代码块提供只读展示和复制。
 *
 * 设计要点：
 * - 高亮走共享 Shiki 实例（lib/shiki-highlighter），语法按需加载；未知语言、
 *   加载失败、高亮未就绪时一律回退到等宽纯文本，不阻塞渲染。
 * - 流式期间代码会持续增长：高亮按「代码内容 + 语言 + 主题」缓存键复用，
 *   变了才重新高亮。高亮未回来前显示纯文本，回来后原地替换 —— 不 remount、不闪烁。
 * - 复制按钮悬浮／聚焦时浮现（CSS 负责显隐），只有复制一个动作。
 */
import type { CodeBlockNodeProps } from "markstream-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import { CHAT_THEME, highlightCode, normalizeLanguage } from "../../lib/shiki-highlighter";
import { useThemeStore } from "../../stores/theme";

/** 库自己的 code_block 节点类型（CodeBlockNodeProps["node"]）。 */
export type ChatCodeNode = CodeBlockNodeProps["node"];

export interface ChatCodeBlockProps {
	node: ChatCodeNode;
	isDark?: boolean;
}

/** 单块代码的高亮上限：超出部分跳过高亮／diff 着色，直接回退展示完整纯文本（不截断）。 */
const MAX_HIGHLIGHT_CHARS = 200_000;

function useCopyState() {
	const t = useT();
	const [copied, setCopied] = useState(false);
	const [failed, setFailed] = useState(false);
	const timer = useRef<number | undefined>(undefined);

	useEffect(() => () => window.clearTimeout(timer.current), []);

	const copy = useCallback((text: string) => {
		void navigator.clipboard
			.writeText(text)
			.then(() => {
				setCopied(true);
				setFailed(false);
			})
			.catch(() => {
				setCopied(false);
				setFailed(true);
			})
			.finally(() => {
				window.clearTimeout(timer.current);
				timer.current = window.setTimeout(() => setCopied(false), 1800);
			});
	}, []);

	return { copied, failed, copy, label: t("message.copy"), copiedLabel: t("message.copied") };
}

/**
 * 流式期间的高亮去抖窗口（ms）。
 *
 * 未闭合的围栏每来一个 token 就整段重高亮，n 次追加 × O(n) 分词 = O(n²) 次
 * token 分配：250 行的块流式期间能堆出几百 MB 临时垃圾。这里改成「内容稳定
 * 窗口内不重复高亮」——流式期间先显示等宽纯文本，稳定 200ms 后高亮一次；
 * 围栏闭合（final）时立即高亮。
 */
const HIGHLIGHT_DEBOUNCE_MS = 200;

type HighlightLines =
	Awaited<ReturnType<typeof highlightCode>> extends infer H
		? H extends { lines: infer L }
			? L
			: never
		: never;

/**
 * 按需高亮。返回 undefined 表示「还没有可用的高亮结果」——调用方渲染纯文本。
 * 缓存键含代码内容，代码未变时直接复用上次结果。
 *
 * @param pending 围栏尚未闭合（还在流式追加）。此时高亮走去抖路径。
 */
function useHighlightLines(
	code: string,
	language: string,
	dark: boolean,
	pending: boolean,
): HighlightLines | undefined {
	const [result, setResult] = useState<{ key: string; lines: HighlightLines }>();
	const key = `${language}|${dark ? "d" : "l"}|${code}`;

	useEffect(() => {
		if (!code || language === "text") {
			setResult(undefined);
			return undefined;
		}
		let cancelled = false;
		const run = () => {
			void highlightCode(code, language, dark ? CHAT_THEME.dark : CHAT_THEME.light)
				.then((highlighted) => {
					if (cancelled) return;
					setResult(highlighted ? { key, lines: highlighted.lines } : undefined);
				})
				.catch(() => {
					if (!cancelled) setResult(undefined);
				});
		};
		// 已闭合：内容不会再变，立即高亮。
		if (!pending) {
			run();
			return () => {
				cancelled = true;
			};
		}
		// 流式中：等内容稳定后再高亮，避免逐 token 重算整段。
		const timer = window.setTimeout(run, HIGHLIGHT_DEBOUNCE_MS);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [code, dark, key, language, pending]);

	return result?.key === key ? result.lines : undefined;
}

/** diff 块：`-` 行为删除、`+` 行为新增，其余为上下文。 */
function diffLineKind(line: string): "add" | "del" | "context" {
	if (line.startsWith("+")) return "add";
	if (line.startsWith("-")) return "del";
	return "context";
}

/** diff 视图：逐行按 +/- 着色。 */
function DiffView({ lines, keys }: { lines: string[]; keys: string[] }) {
	return (
		<pre className="chat-code-diff">
			<code>
				{lines.map((line, index) => (
					<span className={`chat-code-diff-line is-${diffLineKind(line)}`} key={keys[index]}>
						{line}
						{"\n"}
					</span>
				))}
			</code>
		</pre>
	);
}

/** 语法高亮视图：每行一组 token span。 */
function HighlightedView({
	lines,
	lineKeys,
	tokenKeys,
}: {
	lines: HighlightLines;
	lineKeys: string[];
	tokenKeys: string[][];
}) {
	return (
		<pre className="chat-code-highlighted">
			<code>
				{lines.map((line, index) => (
					<span className="chat-code-line" key={lineKeys[index]}>
						{line.map((token, tokenIndex) => (
							<span
								key={tokenKeys[index]?.[tokenIndex]}
								style={{ color: "color" in token ? token.color : undefined }}
							>
								{token.content}
							</span>
						))}
						{"\n"}
					</span>
				))}
			</code>
		</pre>
	);
}

/** 短哈希：给行/token 生成内容派生的稳定 key（不用数组下标）。 */
function hashText(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

/** 内容相同的多行/多 token 追加出现次数，保证 key 唯一。 */
function uniqueKeys(values: string[]): string[] {
	const seen = new Map<string, number>();
	return values.map((value) => {
		const count = (seen.get(value) ?? 0) + 1;
		seen.set(value, count);
		return `${hashText(value)}-${count}`;
	});
}

/**
 * 从节点派生「显示内容 + React key」的全部数据。
 *
 * 拆出来是为了让 ChatCodeBlock 本体保持短函数（仓库上限 60 行），
 * 同时把「高亮上限 / 复制全文 / 显示全文」三者的关系集中在一处。
 */
function useCodeBlockContent(node: ChatCodeNode, language: string, dark: boolean) {
	const source = useMemo(() => node.code ?? "", [node.code]);
	// 围栏未闭合 = 还在流式追加（解析器用 node.loading 标记）。此期间走高亮去抖。
	const isPending = node.loading === true;
	const isDiff = node.diff === true;
	const tooLong = source.length > MAX_HIGHLIGHT_CHARS;

	// diff 块走原始 unified diff 文本逐行着色，不走语法高亮。
	// 注意用 node.raw：解析器给 diff 节点的 code 是 updatedCode（丢失 -/+ 前缀），
	// raw 才是保留前缀的原始 diff。
	const diffSource = useMemo(() => {
		if (!isDiff) return "";
		return node.raw?.length ? node.raw : source;
	}, [isDiff, node.raw, source]);
	const diffTooLong = diffSource.length > MAX_HIGHLIGHT_CHARS;
	const diffLines = useMemo(
		() => (isDiff && !diffTooLong ? diffSource.replace(/\n$/, "").split("\n") : undefined),
		[diffSource, diffTooLong, isDiff],
	);
	const lines = useHighlightLines(
		isDiff || tooLong ? "" : source,
		isDiff || tooLong ? "text" : language,
		dark,
		isPending,
	);

	// key 用内容派生（不用数组下标）：流式期间行内容变化，但 key 保持稳定，
	// React 就能复用已有 DOM 节点而不是整段重建。
	const diffLineKeys = useMemo(() => (diffLines ? uniqueKeys(diffLines) : []), [diffLines]);
	const lineKeys = useMemo(
		() => (lines ? uniqueKeys(lines.map((line) => line.map((token) => token.content).join(""))) : []),
		[lines],
	);
	const tokenKeys = useMemo(
		() => (lines ? lines.map((line) => uniqueKeys(line.map((token) => token.content))) : []),
		[lines],
	);

	return { source, diffSource, diffLines, diffLineKeys, lines, lineKeys, tokenKeys };
}

export function ChatCodeBlock({ node }: ChatCodeBlockProps) {
	const t = useT();
	const dark = useThemeStore((s) => s.resolved === "dark");
	const language = useMemo(() => normalizeLanguage(node.language), [node.language]);
	const isDiff = node.diff === true;
	const { copied, failed, copy, label, copiedLabel } = useCopyState();
	const { source, diffSource, diffLines, diffLineKeys, lines, lineKeys, tokenKeys } = useCodeBlockContent(
		node,
		language,
		dark,
	);

	const handleCopy = useCallback(
		() => copy(isDiff ? diffSource : source),
		[copy, diffSource, isDiff, source],
	);

	return (
		<div
			className={`code-block-container chat-code-block${isDiff ? " is-diff" : ""}`}
			data-testid="chat-code-block"
			data-language={language}
		>
			{/* header DOM 必须保留：复制按钮在这里（CSS 把 header 悬浮化，常态隐身）。
			    按钮必须是 header 的直接子元素——globals.css 用
			    `.code-block-header > div:first-child { display:none }` 藏掉库的语言胶囊，
			    若再包一层 div，复制按钮会被这条规则一起藏掉。 */}
			<div className="code-block-header">
				<button
					type="button"
					className="code-action-btn chat-code-copy"
					aria-label={copied ? copiedLabel : label}
					onClick={handleCopy}
				>
					{copied ? copiedLabel : label}
				</button>
			</div>
			{failed && (
				<p className="chat-code-notice" role="status">
					{t("resource.viewer.copyFailed")}
				</p>
			)}
			{diffLines ? (
				<DiffView lines={diffLines} keys={diffLineKeys} />
			) : lines ? (
				<HighlightedView lines={lines} lineKeys={lineKeys} tokenKeys={tokenKeys} />
			) : (
				/* 纯文本回退展示**全文**：高亮上限只应限制高亮成本，
				   不能让超长代码块在界面上被静默截断（复制给的是全文，两者必须一致）。 */
				<pre className="chat-code-plain">
					<code>{isDiff ? diffSource : source}</code>
				</pre>
			)}
		</div>
	);
}
