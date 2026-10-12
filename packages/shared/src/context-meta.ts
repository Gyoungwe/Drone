/**
 * 上下文可见性（P16）：每轮注入「剩余 token + 今天日期」，以及每条回合的元数据（模式 / 模型 / 强度 / 上下文）。
 */
export interface TurnMeta {
	mode?: string;
	provider?: string;
	model?: string;
	effort?: string;
	contextTokens?: number | null;
	contextWindow?: number | null;
}

export const TURN_CONTEXT_CUSTOM_TYPE = "drone:turn-context";

/** 本地日期（YYYY-MM-DD）与时区；不用 toISOString（那是 UTC，跨零点会差一天）。 */
export function localDate(now: Date, timeZone?: string): { date: string; timeZone: string } {
	const tz = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(now);
	return { date: parts, timeZone: tz };
}

export function remainingTokens(
	used: number | null | undefined,
	window: number | null | undefined,
): number | null {
	if (used == null || !window || window <= 0) return null;
	return Math.max(0, window - used);
}

/** 注入给模型的一行（短，避免每轮浪费 token）。 */
export function turnContextNote(input: {
	usedTokens: number | null | undefined;
	contextWindow: number | null | undefined;
	now: Date;
	timeZone?: string;
}): string {
	const { date, timeZone } = localDate(input.now, input.timeZone);
	const left = remainingTokens(input.usedTokens, input.contextWindow);
	const ctx =
		left == null || !input.contextWindow
			? "context remaining: unknown"
			: `context remaining: ~${left} of ${input.contextWindow} tokens (${Math.round((left / input.contextWindow) * 100)}%)`;
	return `[turn] today ${date} (${timeZone}); ${ctx}. If remaining is low, wrap up or suggest /compact.`;
}

export function serializeTurnMeta(meta: TurnMeta): string {
	return JSON.stringify(meta);
}

export function parseTurnMeta(raw: unknown): TurnMeta | null {
	let v = raw;
	if (typeof raw === "string") {
		try {
			v = JSON.parse(raw);
		} catch {
			return null;
		}
	}
	if (!v || typeof v !== "object") return null;
	const r = v as Record<string, unknown>;
	const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : undefined);
	const num = (k: string) =>
		typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : r[k] === null ? null : undefined;
	const out: TurnMeta = {};
	for (const k of ["mode", "provider", "model", "effort"] as const) {
		const s = str(k);
		if (s !== undefined) out[k] = s;
	}
	for (const k of ["contextTokens", "contextWindow"] as const) {
		const n = num(k);
		if (n !== undefined) out[k] = n;
	}
	return out;
}

/** 右栏用量计的分档：<60% 正常，<85% 警告，否则建议压缩。 */
export function contextLevel(percent: number | null): "unknown" | "ok" | "warn" | "high" {
	if (percent == null || !Number.isFinite(percent)) return "unknown";
	return percent < 60 ? "ok" : percent < 85 ? "warn" : "high";
}
