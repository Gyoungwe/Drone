import type { SessionMeta } from "@drone/shared";
import type { RegisteredSession, SessionRegistry } from "../session/registry";
import type { SessionEngine } from "../session-engine/engine";
import { isSubagentSessionPath } from "../tools/subagent";

export interface SessionLifecycleCloseHooks {
	/** Cleanup owned by the host before disposing the SDK session. */
	beforeDispose?: (sessionId: string, entry: RegisteredSession) => void | Promise<void>;
	/** Cleanup that historically ran after SDK dispose but before registry removal. */
	afterEngineDispose?: (sessionId: string) => void | Promise<void>;
	/** Cleanup that must happen after the registry entry has been removed. */
	afterDispose?: (sessionId: string) => void | Promise<void>;
}

export interface SessionLifecycleServicePort {
	list(cwd?: string): Promise<SessionMeta[]>;
	listAll(): Promise<SessionMeta[]>;
	close(sessionId: string, hooks?: SessionLifecycleCloseHooks): Promise<boolean>;
}

/**
 * Host-owned coordination for session discovery and disposal.
 *
 * Session creation/opening still needs SessionService's project resource and
 * extension setup. This boundary therefore starts with the low-risk list and
 * close operations, while keeping their registry/SDK ordering in one place.
 */
export class SessionLifecycleService implements SessionLifecycleServicePort {
	constructor(
		private readonly registry: SessionRegistry,
		private readonly engine: SessionEngine,
		private readonly defaultCwd?: string,
	) {}

	async list(cwd?: string): Promise<SessionMeta[]> {
		const target = cwd || this.defaultCwd || process.cwd();
		const infos = await this.engine.list(target);
		const activeIds = new Set(this.registry.list().map((entry) => entry.session.sessionId));
		return infos
			.filter((info) => !activeIds.has(info.id))
			.map((info) => ({
				sessionId: info.id,
				sessionFile: info.path,
				cwd: info.cwd || target,
				name: info.name,
				active: false,
				messageCount: info.messageCount,
				createdAt: info.created.getTime(),
				modifiedAt: info.modified.getTime(),
			}));
	}

	async listAll(): Promise<SessionMeta[]> {
		const infos = await this.engine.listAll();
		const activeIds = new Set(this.registry.list().map((entry) => entry.session.sessionId));
		return infos
			.filter((info) => info.cwd)
			.map((info) => ({
				sessionId: info.id,
				sessionFile: info.path,
				cwd: info.cwd || "",
				name: info.name,
				active: activeIds.has(info.id),
				readOnly: isSubagentSessionPath(info.path) || undefined,
				messageCount: info.messageCount,
				createdAt: info.created.getTime(),
				modifiedAt: info.modified.getTime(),
			}));
	}

	async close(sessionId: string, hooks: SessionLifecycleCloseHooks = {}): Promise<boolean> {
		const entry = this.registry.get(sessionId);
		if (!entry) return false;
		await hooks.beforeDispose?.(sessionId, entry);
		this.engine.dispose(entry.session);
		await hooks.afterEngineDispose?.(sessionId);
		this.registry.delete(sessionId);
		await hooks.afterDispose?.(sessionId);
		return true;
	}
}
