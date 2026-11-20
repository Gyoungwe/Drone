import type { P5BackgroundSettings } from "./p5-background-settings";
import type { P5SpendLedger } from "./p5-spend-ledger";

export interface P5BackgroundStatus {
	readonly enabled: boolean;
	readonly dailyTokenLimit: number;
	readonly usedTokens: number;
	/** usedTokens >= dailyTokenLimit */
	readonly exhausted: boolean;
	readonly unknownUsage: boolean;
}

export async function readP5BackgroundStatus(
	settings: Pick<P5BackgroundSettings, "get">,
	ledger: Pick<P5SpendLedger, "today">,
	workspaceId: string,
): Promise<P5BackgroundStatus> {
	const { enabled, dailyTokenLimit } = settings.get(workspaceId);
	const { tokens: usedTokens, unknownUsage } = await ledger.today(workspaceId);
	return { enabled, dailyTokenLimit, usedTokens, exhausted: usedTokens >= dailyTokenLimit, unknownUsage };
}
