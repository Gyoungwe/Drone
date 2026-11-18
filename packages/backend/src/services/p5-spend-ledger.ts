import type { Usage } from "@gyoungwe/plugin-api/p5-receipts";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { JsonStore, JsonStoreCorruptedError } from "../json-store";
import { createLogger } from "../log";
import type { StorageEntry } from "../storage/registry";

export const P5_DEFAULT_DAILY_TOKEN_LIMIT = 10_000_000;

export const P5_SPEND_STORAGE = {
	id: "agent-p5-spend-ledger",
	owner: "services/p5-spend-ledger",
	schema: 1,
	sensitivity: "private",
} as const satisfies Omit<StorageEntry, "path">;

interface SpendScope {
	readonly workspaceId: string;
	readonly metered: boolean;
}

/** Workspace budgets count input + output + cache writes; cache reads are metadata only. */
export interface SpendGate {
	check(input: SpendScope): Promise<"allowed" | "denied">;
	record(usage: Usage & { readonly workspaceId: string }): Promise<void>;
}

interface LedgerEntry {
	workspaceId: string;
	dayKey: string;
	tokens: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	items: number;
	unknownUsage: boolean;
}

const log = createLogger("p5-spend-ledger");
const count = Type.Integer({ minimum: 0 });
const legacyEntrySchema = Type.Object(
	{
		workspaceId: Type.String({ minLength: 1 }),
		dayKey: Type.String({ minLength: 1 }),
		tokens: count,
		items: count,
		unknownUsage: Type.Boolean(),
	},
	{ additionalProperties: false },
);
const ledgerSchema = Type.Array(
	Type.Union([
		legacyEntrySchema,
		Type.Object(
			{
				...legacyEntrySchema.properties,
				inputTokens: count,
				outputTokens: count,
				cacheReadTokens: count,
				cacheWriteTokens: count,
			},
			{ additionalProperties: false },
		),
	]),
);

function parseLedger(text: string): LedgerEntry[] {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		// JSON parse diagnostics can contain disk contents; discard them at this boundary.
		throw new Error("Invalid P5 spend ledger JSON");
	}
	if (!Check(ledgerSchema, value)) throw new Error("Invalid P5 spend ledger metadata");
	const keys = new Set<string>();
	for (const { workspaceId, dayKey } of value) {
		const key = JSON.stringify([workspaceId, dayKey]);
		if (keys.has(key)) throw new Error("Duplicate P5 spend ledger day");
		keys.add(key);
	}
	// Retain pre-T150 schema-1 totals until those ledgers are retired; their breakdown is unavailable.
	return value.map((entry) =>
		"inputTokens" in entry
			? entry
			: {
					...entry,
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
	);
}

interface SpendLedgerOptions {
	readonly path: string;
	/** "default" requests 10M tokens/day; undefined denies metered work. */
	readonly limitFor: (workspaceId: string) => number | "default" | undefined;
	readonly clock: () => Date;
	readonly localDayKey: (date: Date) => string;
}

function recordUsage(
	entries: LedgerEntry[],
	usage: Usage & { readonly workspaceId: string },
	dayKey: string,
): void {
	const entry = entries.find((row) => row.workspaceId === usage.workspaceId && row.dayKey === dayKey);
	const next = entry ?? {
		workspaceId: usage.workspaceId,
		dayKey,
		tokens: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		items: 0,
		unknownUsage: false,
	};
	const inputTokens = usage.inputTokens ?? 0;
	const outputTokens = usage.outputTokens ?? 0;
	const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
	next.inputTokens += inputTokens;
	next.outputTokens += outputTokens;
	next.cacheReadTokens += usage.cacheReadTokens ?? 0;
	next.cacheWriteTokens += cacheWriteTokens;
	next.tokens += inputTokens + outputTokens + cacheWriteTokens;
	if (usage.state === "unknown") next.unknownUsage = true;
	next.items += 1;
	if (!entry) entries.push(next);
}

export function createP5SpendLedger(options: SpendLedgerOptions): SpendGate {
	const json = new JsonStore<LedgerEntry[]>({
		path: options.path,
		storageId: "agent-p5-spend-ledger",
		defaultValue: () => [],
		parse: parseLedger,
		mode: 0o600,
	});
	return {
		async check({ workspaceId, metered }) {
			if (!metered) return "allowed";
			const dayKey = options.localDayKey(options.clock());
			const configuredLimit = options.limitFor(workspaceId);
			const limit = configuredLimit === "default" ? P5_DEFAULT_DAILY_TOKEN_LIMIT : configuredLimit;
			if (limit === undefined) return "denied";
			// update supplies strict reads and shares the per-path queue with concurrent records.
			const entries = await json
				.update((current) => current)
				.catch((error: unknown) => {
					if (!(error instanceof JsonStoreCorruptedError)) throw error;
					log.warn("Corrupted token ledger; denying metered work");
					return undefined;
				});
			if (!entries) return "denied";
			const entry = entries.find((row) => row.workspaceId === workspaceId && row.dayKey === dayKey);
			return !entry?.unknownUsage && (entry?.tokens ?? 0) < limit ? "allowed" : "denied";
		},
		async record(usage) {
			if (!usage.metered) return;
			const dayKey = options.localDayKey(options.clock());
			await json.update((entries) => recordUsage(entries, usage, dayKey));
		},
	};
}
