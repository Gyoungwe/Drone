/** 状态条用的短路径：home 前缀换成 ~，超过 5 段只留首段和末 3 段。 */
export function shortenPath(path: string, home?: string): string {
	let p = path.replaceAll("\\", "/");
	if (home) {
		const h = home.replaceAll("\\", "/").replace(/\/$/, "");
		if (p === h || p.startsWith(`${h}/`)) p = `~${p.slice(h.length)}`;
	}
	const parts = p.split("/");
	return parts.length > 5 ? [parts[0], "…", ...parts.slice(-3)].join("/") : p;
}
