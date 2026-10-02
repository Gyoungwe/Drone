import type { PermissionMode } from "@drone/shared";
import type { PermissionModeRef } from "../permissions/extension";

/**
 * Owns the in-memory permission mode attached to each live session.
 *
 * The mode is intentionally not persisted: closing a tab or restarting the
 * host returns the next session to `default`. SessionService still creates and
 * wires the SDK extension, while this service owns the host-facing mode map.
 */
export interface SessionPermissionServicePort {
	createMode(): PermissionModeRef;
	bind(sessionId: string, mode: PermissionModeRef): void;
	remove(sessionId: string): void;
	getMode(sessionId: string): PermissionMode;
	setMode(sessionId: string, mode: PermissionMode): void;
	dispose(): void;
}

export class SessionPermissionService implements SessionPermissionServicePort {
	private readonly modes = new Map<string, PermissionModeRef>();

	createMode(): PermissionModeRef {
		return { current: "default" };
	}

	bind(sessionId: string, mode: PermissionModeRef): void {
		this.modes.set(sessionId, mode);
	}

	remove(sessionId: string): void {
		this.modes.delete(sessionId);
	}

	getMode(sessionId: string): PermissionMode {
		return this.modes.get(sessionId)?.current ?? "default";
	}

	setMode(sessionId: string, mode: PermissionMode): void {
		const ref = this.modes.get(sessionId);
		if (!ref) throw new Error(`Session not found: ${sessionId}`);
		ref.current = mode;
	}

	dispose(): void {
		this.modes.clear();
	}
}
