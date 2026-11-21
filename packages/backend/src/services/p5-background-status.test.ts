import { expect, it } from "vitest";
import { readP5BackgroundStatus } from "./p5-background-status";

it.each([
	{ label: "disabled with usage", enabled: false, usedTokens: 7, exhausted: false, unknownUsage: false },
	{ label: "enabled under the limit", enabled: true, usedTokens: 9, exhausted: false, unknownUsage: false },
	{ label: "exactly at the limit", enabled: true, usedTokens: 10, exhausted: true, unknownUsage: false },
	{ label: "unknown usage", enabled: true, usedTokens: 8, exhausted: false, unknownUsage: true },
])("reports background status for $label", async ({ enabled, usedTokens, exhausted, unknownUsage }) => {
	const dailyTokenLimit = 10;
	const settings = { get: () => ({ enabled, dailyTokenLimit }) };
	const ledger = { today: async () => ({ tokens: usedTokens, unknownUsage }) };
	await expect(readP5BackgroundStatus(settings, ledger, "workspace-1")).resolves.toStrictEqual({
		enabled,
		dailyTokenLimit,
		usedTokens,
		exhausted,
		unknownUsage,
	});
});
