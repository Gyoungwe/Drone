import { stat } from "node:fs/promises";

export type StorageSensitivity = "public" | "config" | "private" | "secret";

export interface StorageEntry {
	readonly id: string;
	readonly path: string;
	readonly owner: string;
	readonly schema: number | string;
	readonly sensitivity: StorageSensitivity;
	readonly backup?: string;
	readonly migrate?: (from: number | string, to: number | string) => Promise<void>;
}

export interface StorageState {
	readonly id: string;
	readonly path: string;
	readonly owner: string;
	readonly schema: number | string;
	readonly sensitivity: StorageSensitivity;
	readonly status: "missing" | "ok" | "unreadable";
	readonly bytes?: number;
	readonly modifiedAt?: number;
}

/**
 * Explicit inventory for every durable state owned by Drone.
 * Registration is deliberately independent from the storage implementation so
 * JsonStore, SQLite, JSONL and generated directories can share one inventory.
 */
export class StorageRegistry {
	private readonly entries = new Map<string, StorageEntry>();

	register(entry: StorageEntry): this {
		if (!entry.id.trim()) throw new Error("Storage entry id cannot be empty");
		if (this.entries.has(entry.id)) throw new Error(`Storage entry already registered: ${entry.id}`);
		this.entries.set(entry.id, Object.freeze({ ...entry }));
		return this;
	}

	get(id: string): StorageEntry | undefined {
		return this.entries.get(id);
	}

	list(): StorageEntry[] {
		return [...this.entries.values()].sort((a, b) => a.id.localeCompare(b.id));
	}

	assertRegistered(id: string): StorageEntry {
		const entry = this.get(id);
		if (!entry) throw new Error(`Unregistered storage: ${id}`);
		return entry;
	}

	async inspect(): Promise<StorageState[]> {
		const states: StorageState[] = [];
		for (const entry of this.list()) {
			try {
				const info = await stat(entry.path);
				states.push({
					id: entry.id,
					path: entry.path,
					owner: entry.owner,
					schema: entry.schema,
					sensitivity: entry.sensitivity,
					status: "ok",
					bytes: info.size,
					modifiedAt: info.mtimeMs,
				});
			} catch (error) {
				const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
				states.push({
					id: entry.id,
					path: entry.path,
					owner: entry.owner,
					schema: entry.schema,
					sensitivity: entry.sensitivity,
					status: code === "ENOENT" ? "missing" : "unreadable",
				});
			}
		}
		return states;
	}
}

export interface DefaultStorageRegistryOptions {
	agentDir: string;
	userDataDir?: string;
	knowledgeDir?: string;
}

/** Register the durable paths shared by desktop and CLI hosts. */
export function createDefaultStorageRegistry(options: DefaultStorageRegistryOptions): StorageRegistry {
	const registry = new StorageRegistry();
	const { agentDir, userDataDir, knowledgeDir } = options;
	registry
		.register({
			id: "agent-auth",
			path: `${agentDir}/auth.json`,
			owner: "settings/login",
			schema: 1,
			sensitivity: "secret",
		})
		.register({
			id: "agent-models",
			path: `${agentDir}/models.json`,
			owner: "settings/settings",
			schema: 1,
			sensitivity: "secret",
		})
		.register({
			id: "agent-settings",
			path: `${agentDir}/settings.json`,
			owner: "settings/settings",
			schema: 1,
			sensitivity: "config",
		})
		.register({
			id: "agent-model-prefs",
			path: `${agentDir}/model-prefs.json`,
			owner: "settings/model-prefs",
			schema: 1,
			sensitivity: "config",
		})
		.register({
			id: "agent-permissions",
			path: `${agentDir}/permissions.json`,
			owner: "permissions/settings",
			schema: 1,
			sensitivity: "config",
		})
		.register({
			id: "agent-permission-audit",
			path: `${agentDir}/permission-audit.jsonl`,
			owner: "permissions/audit",
			schema: 1,
			sensitivity: "private",
		})
		.register({
			id: "agent-institutional",
			path: `${agentDir}/institutional.json`,
			owner: "institutional/config",
			schema: 1,
			sensitivity: "private",
		})
		.register({
			id: "agent-trust",
			path: `${agentDir}/trust.json`,
			owner: "project/trust",
			schema: 1,
			sensitivity: "private",
		})
		.register({
			id: "agent-workspaces",
			path: `${agentDir}/workspaces.json`,
			owner: "project/workspace-store",
			schema: 1,
			sensitivity: "private",
		})
		.register({
			id: "agent-sessions",
			path: `${agentDir}/sessions`,
			owner: "session-engine/sdk",
			schema: 1,
			sensitivity: "private",
		});
	if (knowledgeDir)
		registry.register({
			id: "knowledge-root",
			path: knowledgeDir,
			owner: "knowledge",
			schema: 1,
			sensitivity: "private",
		});
	if (userDataDir) {
		registry
			.register({
				id: "desktop-tabs",
				path: `${userDataDir}/tabs.json`,
				owner: "desktop/tabs",
				schema: 1,
				sensitivity: "private",
			})
			.register({
				id: "desktop-lan-config",
				path: `${userDataDir}/lan-observer.json`,
				owner: "desktop/lan",
				schema: 1,
				sensitivity: "config",
			})
			.register({
				id: "desktop-lan-audit",
				path: `${userDataDir}/lan-audit.jsonl`,
				owner: "desktop/lan",
				schema: 1,
				sensitivity: "private",
			})
			.register({
				id: "desktop-ui-state",
				path: `${userDataDir}/ui-state.json`,
				owner: "desktop/ui-state",
				schema: 1,
				sensitivity: "private",
			})
			.register({
				id: "desktop-backgrounds",
				path: `${userDataDir}/backgrounds`,
				owner: "desktop/background",
				schema: 1,
				sensitivity: "private",
			})
			.register({
				id: "desktop-logs",
				path: `${userDataDir}/logs`,
				owner: "desktop/logging",
				schema: 1,
				sensitivity: "private",
			});
	}
	return registry;
}
