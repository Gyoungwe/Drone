/**
 * UI language mirrored by the desktop host into DRONE_REPLY_LANGUAGE (see backend reply-language.ts).
 * Host strings that users see in tool cards are bilingual in Chinese mode (Chinese first, then the
 * English contract the model relies on) and English otherwise.
 */
export function hostLanguage(): "zh" | "en" {
	return String(process.env.DRONE_REPLY_LANGUAGE || "")
		.toLowerCase()
		.startsWith("zh")
		? "zh"
		: "en";
}

export function bilingual(zh: string, en: string): string {
	return hostLanguage() === "zh" ? `${zh}\n${en}` : en;
}
