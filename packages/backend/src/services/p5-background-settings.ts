import { Type } from "typebox";
import { Check } from "typebox/value";
import { JsonStore, JsonStoreCorruptedError } from "../json-store";
import { createLogger } from "../log";
import type { StorageEntry } from "../storage/registry";
import { P5_DEFAULT_DAILY_TOKEN_LIMIT } from "./p5-spend-ledger";

export const P5_BACKGROUND_SETTINGS_STORAGE = {
	id: "agent-p5-background-settings",
	owner: "services/p5-background-settings",
	schema: 1,
	sensitivity: "config",
} as const satisfies Omit<StorageEntry, "path">;

export interface P5BackgroundSetting {
	readonly enabled: boolean;
	readonly dailyTokenLimit: number;
}

export interface P5BackgroundSettings {
	get(workspaceId: string): P5BackgroundSetting;
	setEnabled(workspaceId: string, enabled: boolean): P5BackgroundSetting;
	setDailyTokenLimit(workspaceId: string, limit: number): P5BackgroundSetting;
	/** Scheduler port. */
	isEnabled(workspaceId: string): boolean;
	/** Ledger port: the workspace limit when enabled, undefined (deny) when disabled. */
	limitFor(workspaceId: string): number | undefined;
}

type WorkspaceSettings = Record<string, P5BackgroundSetting>;

const log = createLogger("p5-background-settings");
const settingsSchema = Type.Record(
	Type.String({ pattern: "[\\s\\S]*" }),
	Type.Object(
		{
			enabled: Type.Boolean(),
			dailyTokenLimit: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
		},
		{ additionalProperties: false },
	),
);

function parseSettings(text: string): WorkspaceSettings {
	const value: unknown = JSON.parse(text);
	if (!Check(settingsSchema, value)) throw new Error("Invalid P5 background settings");
	return value;
}

function getSetting(entries: WorkspaceSettings, workspaceId: string): P5BackgroundSetting {
	const setting = Object.hasOwn(entries, workspaceId) ? entries[workspaceId] : undefined;
	return setting ?? { enabled: false, dailyTokenLimit: P5_DEFAULT_DAILY_TOKEN_LIMIT };
}

export function createP5BackgroundSettings(options: { readonly path: string }): P5BackgroundSettings {
	const json = new JsonStore<WorkspaceSettings>({
		path: options.path,
		storageId: "agent-p5-background-settings",
		defaultValue: () => ({}),
		parse: parseSettings,
		mode: 0o600,
	});
	const get = (workspaceId: string) => getSetting(json.readStrictSync(), workspaceId);
	function update(workspaceId: string, change: Partial<P5BackgroundSetting>): P5BackgroundSetting {
		const updated = json.updateSync((entries) => {
			const setting = { ...getSetting(entries, workspaceId), ...change };
			if (!setting.enabled && setting.dailyTokenLimit === P5_DEFAULT_DAILY_TOKEN_LIMIT) {
				delete entries[workspaceId];
				return;
			}
			return { ...entries, [workspaceId]: setting };
		});
		return getSetting(updated, workspaceId);
	}
	function gatedSetting(workspaceId: string): P5BackgroundSetting | undefined {
		let entries: WorkspaceSettings;
		try {
			entries = json.readStrictSync();
		} catch (error) {
			if (!(error instanceof JsonStoreCorruptedError)) throw error;
			log.warn("Corrupted background settings; denying background work");
			return undefined;
		}
		return getSetting(entries, workspaceId);
	}
	return {
		get,
		setEnabled: (workspaceId, enabled) => update(workspaceId, { enabled }),
		setDailyTokenLimit(workspaceId, limit) {
			if (!Number.isSafeInteger(limit) || limit <= 0)
				throw new Error("Invalid P5 background daily token limit");
			return update(workspaceId, { dailyTokenLimit: limit });
		},
		isEnabled: (workspaceId) => gatedSetting(workspaceId)?.enabled === true,
		limitFor(workspaceId) {
			const setting = gatedSetting(workspaceId);
			return setting?.enabled ? setting.dailyTokenLimit : undefined;
		},
	};
}
