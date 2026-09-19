/** 紧凑时长（codex 同款）：42s / 3m 05s / 1h 02m；数字配 tabular-nums 防跳动 */
export function formatDuration(ms: number): string {
	const total = Math.floor(Math.max(0, ms) / 1000);
	if (total < 60) return `${total}s`;
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
	return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** 紧凑数字：1.2k / 3.45M（token 计数） */
export function compactNumber(n: number): string {
	if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(Math.round(n));
}
