// biome-ignore-all lint/suspicious/noArrayIndexKey: Read-only token and line positions are stable within this bounded source snapshot.
import { useEffect, useMemo, useState } from "react";
import type { BundledLanguage, ThemedToken } from "shiki";
import { useThemeStore } from "../../stores/theme";

let highlighter: ReturnType<typeof import("shiki")["createHighlighter"]> | undefined;
async function tokensFor(code: string, language: string, dark: boolean) {
	const { createHighlighter, bundledLanguages } = await import("shiki");
	highlighter ||= createHighlighter({ themes: ["github-light", "github-dark"], langs: [] });
	const h = await highlighter;
	// Only bundled grammars are loaded, on demand, never a user-provided module or URL.
	const lang = Object.hasOwn(bundledLanguages, language) ? (language as BundledLanguage) : "text";
	if (lang !== "text") await h.loadLanguage(lang);
	return h.codeToTokens(code, { lang, theme: dark ? "github-dark" : "github-light" }).tokens;
}
export function ResourceCode({ text, language = "text" }: { text: string; language?: string }) {
	const dark = useThemeStore((s) => s.resolved === "dark");
	const [tokens, setTokens] = useState<ThemedToken[][]>(),
		[wrap, setWrap] = useState(true),
		[copied, setCopied] = useState(false),
		[copyError, setCopyError] = useState(false);
	const sample = useMemo(() => text.slice(0, 64000).split("\n").slice(0, 1000).join("\n"), [text]);
	useEffect(() => {
		let cancelled = false;
		setTokens(undefined);
		setCopied(false);
		setCopyError(false);
		if (language !== "text")
			void tokensFor(sample, language, dark)
				.then((next) => {
					if (!cancelled) setTokens(next);
				})
				.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [sample, language, dark]);
	return (
		<div className="resource-code" data-testid="resource-code">
			<div className="resource-code-tools">
				<span>
					{language} · {sample.split("\n").length} 行片段
				</span>
				<button type="button" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
					自动换行
				</button>
				<button
					type="button"
					onClick={() => {
						void navigator.clipboard
							.writeText(sample)
							.then(() => {
								setCopied(true);
								setCopyError(false);
							})
							.catch(() => {
								setCopied(false);
								setCopyError(true);
							});
					}}
				>
					{copied ? "已复制" : "复制片段"}
				</button>
			</div>
			{copyError && (
				<p className="resource-notice" role="status">
					复制失败，可以直接选中源码复制。
				</p>
			)}
			{sample.length < text.length && (
				<p className="resource-notice">源码视图仅展示前 1,000 行／64,000 字符。</p>
			)}
			<pre className={wrap ? "resource-source wrap" : "resource-source"}>
				{(tokens || sample.split("\n").map((content) => [{ content }])).map((line, i) => (
					<span className="resource-source-line" key={`line-${i}`}>
						<span aria-hidden="true" className="resource-line-number">
							{i + 1}
						</span>
						<code>
							{line.map((token, j) => (
								<span
									key={`token-${j}`}
									style={{ color: ("color" in token ? token.color : undefined) as string | undefined }}
								>
									{token.content}
								</span>
							))}
							{"\n"}
						</code>
					</span>
				))}
			</pre>
		</div>
	);
}
