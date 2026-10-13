/** 相对时间（「10 分钟前」「昨天」）：会话列表第二行用。超过 7 天显示月-日。 */
export function relativeTime(ms: number, language: "zh" | "en", now = Date.now()): string {
	const diff = Math.max(0, now - ms);
	const min = Math.floor(diff / 60_000);
	if (min < 1) return language === "zh" ? "刚刚" : "just now";
	const rtf = new Intl.RelativeTimeFormat(language === "zh" ? "zh-CN" : "en", { numeric: "auto" });
	if (min < 60) return rtf.format(-min, "minute");
	const hours = Math.floor(min / 60);
	if (hours < 24) return rtf.format(-hours, "hour");
	const days = Math.floor(hours / 24);
	if (days < 7) return rtf.format(-days, "day");
	return new Date(ms).toLocaleDateString(language === "zh" ? "zh-CN" : "en", {
		month: "short",
		day: "numeric",
	});
}

/** 目录名：取路径末级（Windows / POSIX 都可） */
export function dirName(cwd: string): string {
	return cwd.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? cwd;
}
