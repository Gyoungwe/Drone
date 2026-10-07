/**
 * Reply language of the desktop UI (zh/en), pushed from the renderer over IPC (UiStateSave).
 *
 * The value is mirrored into `process.env.DRONE_REPLY_LANGUAGE` so first-party runtimes that are
 * compiled into separate Pi extension graphs (packages/tasks runtime-compiled, .pi/lib) read the same
 * value without importing the backend.
 */
export type ReplyLanguage = "zh" | "en";

const ENV = "DRONE_REPLY_LANGUAGE";
let current: ReplyLanguage | undefined;

export function normalizeReplyLanguage(value: unknown): ReplyLanguage | undefined {
	if (typeof value !== "string") return undefined;
	const lower = value.trim().toLowerCase();
	if (lower.startsWith("zh")) return "zh";
	if (lower.startsWith("en")) return "en";
	return undefined;
}

export function setReplyLanguage(value: unknown): ReplyLanguage | undefined {
	const language = normalizeReplyLanguage(value);
	if (!language) return current;
	current = language;
	process.env[ENV] = language;
	return language;
}

export function getReplyLanguage(): ReplyLanguage | undefined {
	return current ?? normalizeReplyLanguage(process.env[ENV]);
}

/** Forget the language (tests, or a host that stops providing one). */
export function clearReplyLanguage(): void {
	current = undefined;
	delete process.env[ENV];
}

/** Pick host-authored text for the current UI language (English when unknown). */
export function hostText(zh: string, en: string): string {
	return getReplyLanguage() === "zh" ? zh : en;
}

/**
 * Appended system-prompt rule. Mixed Chinese/English replies came from English host strings,
 * tool results and skill docs; pin the visible language explicitly.
 */
export function replyLanguagePrompt(language: ReplyLanguage | undefined = getReplyLanguage()): string[] {
	if (language === "zh")
		return [
			"回复语言：用户界面是简体中文。除非用户明确要求其他语言，你写给用户看的所有文字都用简体中文：正文回答、set_status 的 text/detail/next、task_plan 的 goal/summary/里程碑标题、ask_user 的问题与选项、任务报告和总结。",
			"代码、文件路径、命令、工具名与参数、包名、API 字段、引用文献标题和专有名词保持原文，不要翻译。工具结果、技能文档或网页是英文时，也用中文转述要点，不要整段照搬英文。",
		];
	if (language === "en")
		return [
			"Reply language: the user interface is English. Unless the user writes in or asks for another language, write everything the user sees in English: answers, set_status text/detail/next, task_plan goal/summary/milestone titles, ask_user questions and reports. Keep code, paths, commands, tool names and proper nouns as-is.",
		];
	return [];
}
