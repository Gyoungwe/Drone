import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";

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

	/** Register a host-discovered directory idempotently across sessions. */
	registerDiscoveredRoot(
		prefix: string,
		path: string,
		owner: string,
		sensitivity: StorageSensitivity,
		schema: number | string = 1,
	): StorageEntry {
		if (!path.trim()) throw new Error("Storage root path cannot be empty");
		const id = rootId(prefix, path);
		const existing = this.entries.get(id);
		if (existing) return existing;
		const entry: StorageEntry = { id, path, owner, schema, sensitivity };
		this.register(entry);
		return this.entries.get(id) as StorageEntry;
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
	/** Optional research-state ledger root registered by the inquiry host. */
	inquiryDir?: string;
	inquiryProjectsDir?: string;
	/** Read-only mount for the pre-v0.19 single desktop ledger. */
	legacyInquiryDir?: string;
	/** Optional non-JsonStore roots discovered by the host at startup. */
	logDir?: string;
	projectWorkRoots?: readonly string[];
	knowledgeVaultRoots?: readonly string[];
	researchResultsRoots?: readonly string[];
}

/**
 * Build a deterministic suffix for host-discovered roots without exposing the
 * raw path in diagnostics ids. The path itself is carried separately in the
 * redacted storage snapshot.
 */
function rootId(prefix: string, path: string): string {
	return `${prefix}-${createHash("sha256").update(path).digest("hex").slice(0, 12)}`;
}

function registerRoots(
	registry: StorageRegistry,
	paths: readonly string[] | undefined,
	prefix: string,
	owner: string,
	sensitivity: StorageSensitivity,
): void {
	const registered = new Set<string>();
	for (const path of paths ?? []) {
		if (!path.trim()) continue;
		const id = rootId(prefix, path);
		if (registered.has(id)) continue;
		registered.add(id);
		registry.registerDiscoveredRoot(prefix, path, owner, sensitivity);
	}
}

/** Register the durable paths shared by desktop and CLI hosts. */
export function createDefaultStorageRegistry(options: DefaultStorageRegistryOptions): StorageRegistry {
	const registry = new StorageRegistry();
	const {
		agentDir,
		userDataDir,
		knowledgeDir,
		inquiryDir,
		inquiryProjectsDir,
		legacyInquiryDir,
		logDir,
		projectWorkRoots,
		knowledgeVaultRoots,
		researchResultsRoots,
	} = options;
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
			id: "agent-zotero-web",
			path: `${agentDir}/zotero-web.json`,
			owner: "zotero/web-credentials",
			schema: 1,
			sensitivity: "secret",
		})
		.register({
			id: "agent-knowledge-webdav",
			path: `${agentDir}/knowledge-webdav.json`,
			owner: "knowledge/webdav-credentials",
			schema: 1,
			sensitivity: "secret",
		})
		.register({
			id: "agent-zotero-local",
			path: `${agentDir}/zotero-local.json`,
			owner: "zotero/local-write",
			schema: 1,
			sensitivity: "secret",
		})
		.register({
			id: "agent-daily-discovery",
			path: `${agentDir}/daily-discovery.json`,
			owner: "knowledge/daily-discovery",
			schema: 1,
			sensitivity: "private",
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
			id: "agent-mcp",
			path: `${agentDir}/mcp.json`,
			owner: "mcp/service",
			schema: 1,
			sensitivity: "private",
		})
		.register({
			id: "agent-compute-root",
			path: `${agentDir}/compute`,
			owner: "compute/service",
			schema: 1,
			sensitivity: "private",
		})
		.register({
			id: "agent-compute-hosts",
			path: `${agentDir}/compute/hosts.json`,
			owner: "compute/hosts",
			schema: 1,
			sensitivity: "config",
		})
		.register({
			id: "agent-compute-projection-hosts",
			path: `${agentDir}/compute/desktop-hosts.json`,
			owner: "compute/desktop-projection",
			schema: 1,
			sensitivity: "config",
		})
		.register({
			id: "agent-compute-jobs-root",
			path: `${agentDir}/compute/jobs`,
			owner: "compute/jobs",
			schema: 1,
			sensitivity: "private",
		})
		.register({
			id: "agent-compute-events-root",
			path: `${agentDir}/compute/events`,
			owner: "compute/events",
			schema: 1,
			sensitivity: "private",
		})
		.register({
			id: "agent-compute-data-design",
			path: `${agentDir}/compute/data-design.json`,
			owner: "compute/data-design",
			schema: 1,
			sensitivity: "private",
		})
		.register({
			id: "agent-discovery-root",
			path: `${agentDir}/discovery`,
			owner: "discovery/service",
			schema: 1,
			sensitivity: "private",
		})
		.register({
			id: "agent-discovery-sessions",
			path: `${agentDir}/discovery/sessions.json`,
			owner: "discovery/sessions",
			schema: 1,
			sensitivity: "private",
		})
		.register({
			id: "agent-discovery-critics",
			path: `${agentDir}/discovery/critics.json`,
			owner: "discovery/critics",
			schema: 1,
			sensitivity: "private",
		})
		.register({
			id: "agent-discovery-multipath",
			path: `${agentDir}/discovery/multipath.json`,
			owner: "discovery/multipath",
			schema: 1,
			sensitivity: "private",
		})
		.register({
			id: "agent-discovery-plans",
			path: `${agentDir}/discovery/plans.json`,
			owner: "discovery/plans",
			schema: 1,
			sensitivity: "private",
		})
		.register({
			id: "agent-discovery-evaluations",
			path: `${agentDir}/discovery/evaluations.json`,
			owner: "discovery/evaluations",
			schema: 1,
			sensitivity: "private",
		})
		.register({
			id: "agent-discovery-baselines",
			path: `${agentDir}/discovery/baselines.json`,
			owner: "discovery/baselines",
			schema: 1,
			sensitivity: "private",
		})
		.register({
			id: "agent-sessions",
			path: `${agentDir}/sessions`,
			owner: "session-engine/sdk",
			schema: 1,
			sensitivity: "private",
		})
		.register({
			id: "agent-session-traces",
			path: `${agentDir}/sessions`,
			owner: "session/traces",
			schema: 1,
			sensitivity: "private",
		})
		.register({
			id: "agent-subagent-sessions",
			path: `${agentDir}/sessions-subagents`,
			owner: "subagents/session-engine",
			schema: 1,
			sensitivity: "private",
		});
	if (logDir)
		registry.register({
			id: "agent-logs",
			path: logDir,
			owner: "backend/logging",
			schema: 1,
			sensitivity: "private",
		});
	if (knowledgeDir) {
		registry
			.register({
				id: "knowledge-root",
				path: knowledgeDir,
				owner: "knowledge",
				schema: 1,
				sensitivity: "private",
			})
			.register({
				id: "knowledge-binding",
				path: `${knowledgeDir}/binding.json`,
				owner: "knowledge/config",
				schema: 1,
				sensitivity: "private",
			})
			.register({
				id: "knowledge-review-policy",
				path: `${knowledgeDir}/review-policy.json`,
				owner: "knowledge/review-policy",
				schema: 1,
				sensitivity: "config",
			})
			.register({
				id: "knowledge-specialists",
				path: `${knowledgeDir}/specialists.json`,
				owner: "knowledge/specialist-host",
				schema: 1,
				sensitivity: "config",
			});
	}
	if (inquiryDir) {
		registry
			.register({
				id: "inquiry-root",
				path: inquiryDir,
				owner: "inquiry",
				schema: 1,
				sensitivity: "private",
			})
			.register({
				id: "inquiry-ledger",
				path: `${inquiryDir}/ledger.sqlite`,
				owner: "inquiry/ledger",
				schema: 2,
				sensitivity: "private",
			});
	}
	if (inquiryProjectsDir)
		registry.register({
			id: "inquiry-projects",
			path: inquiryProjectsDir,
			owner: "inquiry/projects",
			schema: 2,
			sensitivity: "private",
		});
	if (legacyInquiryDir) {
		registry
			.register({
				id: "inquiry-legacy-root",
				path: legacyInquiryDir,
				owner: "inquiry/legacy-readonly",
				schema: "preserve",
				sensitivity: "private",
			})
			.register({
				id: "inquiry-legacy-ledger",
				path: join(legacyInquiryDir, "ledger.sqlite"),
				owner: "inquiry/legacy-readonly",
				schema: "preserve",
				sensitivity: "private",
			});
	}
	// These roots are selected after binding/project discovery. Registering the
	// parent directory keeps SQLite, JSONL and generated review artifacts in the
	// same inventory without reading their contents into diagnostics.
	registerRoots(registry, projectWorkRoots, "project-work", "tools/channel-watch", "private");
	registerRoots(registry, knowledgeVaultRoots, "knowledge-vault", "knowledge/wiki-review", "private");
	registerRoots(registry, researchResultsRoots, "research-results", "research/provenance", "private");
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
				id: "desktop-figure-annotations",
				path: `${userDataDir}/figure-annotations.json`,
				owner: "desktop/figure-annotations",
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
			})
			.register({
				id: "desktop-ui-plugins-config",
				path: `${userDataDir}/ui-plugins.json`,
				owner: "desktop/ui-plugins",
				schema: 1,
				sensitivity: "config",
			})
			.register({
				id: "desktop-ui-plugins",
				path: `${userDataDir}/ui-plugins`,
				owner: "desktop/ui-plugins",
				schema: 1,
				sensitivity: "private",
			});
	}
	return registry;
}
