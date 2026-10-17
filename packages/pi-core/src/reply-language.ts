/**
 * Host-authored text used by the portable core tools.
 *
 * The host may set DRONE_REPLY_LANGUAGE while building its session. Keeping
 * this tiny adapter in pi-core avoids importing the Desktop/backend language
 * service into an installable Pi package.
 */
export type ReplyLanguage = "zh" | "en";

function language(): ReplyLanguage | undefined {
	const value = process.env.DRONE_REPLY_LANGUAGE?.trim().toLowerCase();
	if (value?.startsWith("zh")) return "zh";
	if (value?.startsWith("en")) return "en";
	return undefined;
}

export function hostText(zh: string, en: string): string {
	return language() === "zh" ? zh : en;
}
