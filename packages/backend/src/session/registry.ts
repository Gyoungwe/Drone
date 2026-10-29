import { statSync } from "node:fs";
import type { SessionMeta } from "@drone/shared";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { NativeSessionDelivery } from "../plugins/native-delivery";
import type { AskGate } from "./ask-gate";

export interface RegisteredSession {
	readonly questionGate?: AskGate;
	readonly nativeKind?: "primary" | "child";
	/** Host-only child policy fact; this is not a filesystem grant. */
	readonly nativeChildFiles?: "none" | "read";
	readonly nativeDelivery?: NativeSessionDelivery;
	session: AgentSession;
	unsubscribe: () => void;
	cwd: string;
	/** 只读会话（subagent 产物检视）：prompt/fork/recall/setModel 等写操作全部拒绝 */
	readOnly?: boolean;
}

/** The live entries plugin capabilities may resolve: primary sessions and running read-only children. */
export interface SessionDirectory {
	get(sessionId: string): RegisteredSession | undefined;
	signalFor(entry: RegisteredSession): AbortSignal;
}

/** Children stay out of the primary registry (listing, reopen, close, reload) but resolve for plugin capabilities. */
export function combinedSessionDirectory(
	primary: SessionRegistry,
	children: SessionRegistry,
): SessionDirectory {
	return {
		get: (sessionId) => primary.get(sessionId) ?? children.get(sessionId),
		signalFor: (entry) =>
			(primary.get(entry.session.sessionId) === entry ? primary : children).signalFor(entry),
	};
}

/** 维护 sessionId → AgentSession 实例 */
export class SessionRegistry {
	private readonly sessions = new Map<string, RegisteredSession>();
	private readonly lifetimes = new WeakMap<RegisteredSession, AbortController>();

	add(entry: RegisteredSession): void {
		const previous = this.sessions.get(entry.session.sessionId);
		if (previous && previous !== entry) this.revoke(entry.session.sessionId);
		if (!this.lifetimes.has(entry)) this.lifetimes.set(entry, new AbortController());
		this.sessions.set(entry.session.sessionId, entry);
	}

	get(sessionId: string): RegisteredSession | undefined {
		return this.sessions.get(sessionId);
	}

	has(sessionId: string): boolean {
		return this.sessions.has(sessionId);
	}

	/** Revoke capabilities before asynchronous SDK shutdown or replacement starts. */
	revoke(sessionId: string): void {
		const entry = this.sessions.get(sessionId);
		if (entry) this.lifetime(entry).abort(new Error("Session caller revoked"));
	}

	private lifetime(entry: RegisteredSession): AbortController {
		const lifetime = this.lifetimes.get(entry);
		if (!lifetime) throw new Error("Session identity is not registered");
		return lifetime;
	}

	signalFor(entry: RegisteredSession): AbortSignal {
		return this.lifetime(entry).signal;
	}

	delete(sessionId: string): void {
		const entry = this.sessions.get(sessionId);
		if (!entry) return;
		this.revoke(sessionId);
		entry.unsubscribe();
		this.sessions.delete(sessionId);
	}

	list(): RegisteredSession[] {
		return [...this.sessions.values()];
	}

	toMeta(entry: RegisteredSession): SessionMeta {
		const { session, cwd } = entry;
		// createdAt 用会话文件创建时刻（fork = fork 时刻，语义真实）；SDK 无活跃会话 created 访问器
		let createdAt = Date.now();
		if (session.sessionFile) {
			try {
				createdAt = statSync(session.sessionFile).birthtimeMs;
			} catch {
				// 文件不存在/异常回退当前时刻
			}
		}
		return {
			sessionId: session.sessionId,
			sessionFile: session.sessionFile,
			cwd,
			name: session.sessionName,
			modelLabel: session.model?.name,
			model: session.model ? { provider: session.model.provider, modelId: session.model.id } : null,
			thinkingLevel: session.thinkingLevel,
			active: true,
			messageCount: session.messages.length,
			createdAt,
			readOnly: entry.readOnly || undefined,
		};
	}

	async disposeAll(dispose: (session: AgentSession) => Promise<void>): Promise<void> {
		const results = await Promise.allSettled(
			[...this.sessions].map(async ([sessionId, entry]) => {
				this.revoke(sessionId);
				await dispose(entry.session);
				this.delete(sessionId);
			}),
		);
		const failures = results.filter((result) => result.status === "rejected");
		if (failures.length)
			throw new AggregateError(
				failures.map((result) => result.reason),
				"Session shutdown failed",
			);
	}
}

export type EventForwarder = (sessionId: string, event: AgentSessionEvent) => void;
