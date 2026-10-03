/**
 * Keep model-authored card copy readable when a provider compresses a list into one line.
 * Existing newlines are preserved; inline bullets and numbered items become separate lines.
 */
export function formatCardText(value: string): string {
	return value
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t]+/g, " ")
		.replace(/([:：])\s*(?=(?:[-*•]\s+|\d+[.)、]\s+|[一二三四五六七八九十]+[、.]\s+))/g, "$1\n")
		.replace(/\s+(?=(?:[-*•]\s+|\d+[.)、]\s+|[一二三四五六七八九十]+[、.]\s+))/g, "\n")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.join("\n");
}
