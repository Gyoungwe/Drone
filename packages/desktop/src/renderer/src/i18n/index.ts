import { useCallback } from "react";
import { create } from "zustand";
import { en } from "./en";
import { type Messages, zh } from "./zh";

export type Language = "zh" | "en";

const STORAGE_KEY = "pi-desktop.lang";
const dictionaries: Record<Language, Messages> = { zh, en };

/** 默认跟随系统语言（仅首期支持中/英，其他按英文处理） */
function detectLanguage(): Language {
	const saved = localStorage.getItem(STORAGE_KEY);
	if (saved === "zh" || saved === "en") return saved;
	return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

interface I18nStore {
	language: Language;
	setLanguage: (language: Language) => void;
}

export const useI18nStore = create<I18nStore>((set) => ({
	language: detectLanguage(),
	setLanguage: (language) => {
		localStorage.setItem(STORAGE_KEY, language);
		set({ language });
	},
}));

type DotKeys<T, Prefix extends string = ""> = {
	[K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : DotKeys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = DotKeys<Messages>;

/** 插件自带文案（挂钩 4）：按注册顺序在核心字典之后查找；插件卸载时注销。 */
type PluginMessages = Partial<Record<Language, Record<string, unknown>>>;
const pluginDictionaries = new Map<string, PluginMessages>();
export function registerPluginMessages(namespace: string, messages: PluginMessages): () => void {
	pluginDictionaries.set(namespace, messages);
	return () => {
		if (pluginDictionaries.get(namespace) === messages) pluginDictionaries.delete(namespace);
	};
}

function lookup(messages: unknown, key: string): string | null {
	let node: unknown = messages;
	for (const part of key.split(".")) {
		if (!node || typeof node !== "object") return null;
		node = (node as Record<string, unknown>)[part];
		if (node === undefined) return null;
	}
	return typeof node === "string" ? node : null;
}
function resolve(language: Language, key: string): string | null {
	const core = lookup(dictionaries[language], key);
	if (core !== null) return core;
	for (const messages of pluginDictionaries.values()) {
		const value = lookup(messages[language], key) ?? lookup(messages.zh ?? messages.en, key);
		if (value !== null) return value;
	}
	return null;
}

export function translate(
	language: Language,
	key: MessageKey,
	params?: Record<string, string | number>,
): string {
	const template = resolve(language, key) ?? key;
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

/** 可选翻译：键不存在时返回 null（供扩展贡献的回执卡 / 状态记号回退到原文）。 */
export function translateOptional(language: Language, key: string): string | null {
	return resolve(language, key);
}

/** 组件内使用：const t = useT(); t("settings.title") / t("permission.queued", { count: 2 }) */
export function useT() {
	const language = useI18nStore((s) => s.language);
	return useCallback(
		(key: MessageKey, params?: Record<string, string | number>) => translate(language, key, params),
		[language],
	);
}
