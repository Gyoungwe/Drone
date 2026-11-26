/**
 * 共享 Shiki 高亮器（只读代码块用）。
 *
 * 全应用只有一个实例：主题一次性注册（4 个），语法按需 loadLanguage。
 * - 只加载 bundledLanguages 里的语法，绝不动态 import 用户提供的模块或 URL。
 * - 聊天代码块用 vitesse-light/vitesse-dark，资源预览用 github-light/github-dark，
 *   两边共用同一实例，避免重复常驻的 grammar/WASM 内存。
 */
import type { BundledLanguage, Highlighter, ThemedToken } from "shiki";

export const CHAT_THEME = { light: "vitesse-light", dark: "vitesse-dark" } as const;
export const RESOURCE_THEME = { light: "github-light", dark: "github-dark" } as const;

const ALL_THEMES = [CHAT_THEME.light, CHAT_THEME.dark, RESOURCE_THEME.light, RESOURCE_THEME.dark] as const;

export type ThemeName = (typeof ALL_THEMES)[number];

const highlighterState: { promise?: Promise<Highlighter> } = {};

/** 主题注册一次即可；语法按需补充。并发调用共享同一 Promise，初始化失败时清空以便后续重试。 */
function getHighlighter(): Promise<Highlighter> {
	highlighterState.promise ??= import("shiki")
		.then(({ createHighlighter }) => createHighlighter({ themes: [...ALL_THEMES], langs: [] }))
		.catch((error: unknown) => {
			highlighterState.promise = undefined;
			throw error;
		});
	return highlighterState.promise;
}

/** 语言归一：取 info string 的第一段（去 `:line` 后缀），空则 text。 */
export function normalizeLanguage(language: string | undefined): string {
	const first = (language ?? "").trim().split(/\s+/)[0] ?? "";
	return first.split(":")[0]?.toLowerCase() ?? "";
}

/** 只加载 bundled 语法：不在白名单里的语言名（任意模块/URL 注入）一律当纯文本。 */
async function resolveBundled(language: string): Promise<BundledLanguage | "text"> {
	const { bundledLanguages } = await import("shiki");
	return Object.hasOwn(bundledLanguages, language) ? (language as BundledLanguage) : "text";
}

export interface HighlightedCode {
	lines: ThemedToken[][];
	/** 实际用于高亮的语言（未知语言降级为 text）。 */
	language: string;
}

/**
 * 高亮一段代码。未知语言返回 null —— 调用方据此回退到等宽纯文本，不抛错。
 */
export async function highlightCode(
	code: string,
	language: string,
	theme: ThemeName,
): Promise<HighlightedCode | null> {
	const lang = await resolveBundled(normalizeLanguage(language));
	if (lang === "text") return null;
	const highlighter = await getHighlighter();
	if (!highlighter.getLoadedLanguages().includes(lang)) {
		await highlighter.loadLanguage(lang);
	}
	const { tokens } = highlighter.codeToTokens(code, { lang, theme });
	return { lines: tokens, language: lang };
}
