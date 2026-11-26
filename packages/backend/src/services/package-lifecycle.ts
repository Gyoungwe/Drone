import {
	isPackageVersion,
	NPM_NOT_FOUND_SENTINEL,
	npmPackageName,
	type PackageLifecycleEvent,
	type PackageLifecycleReceipt,
} from "@drone/shared";
import type { RegisteredSession, SessionRegistry } from "../session/registry";
import type { SessionTraces } from "../session/traces";
import { affectsPackageSession } from "./session-package-versions";

export function packageEvent(
	type: PackageLifecycleEvent["type"],
	sessionId?: string,
	detail?: string,
): PackageLifecycleEvent {
	return { type, at: Date.now(), ...(sessionId ? { sessionId } : {}), ...(detail ? { detail } : {}) };
}

export function relevantPackageSessions(
	registry: SessionRegistry,
	receipt: PackageLifecycleReceipt,
	workspace: string,
): RegisteredSession[] {
	return registry
		.list()
		.filter(
			(entry) =>
				!registry.signalFor(entry).aborted &&
				affectsPackageSession(entry, receipt.packageName, receipt.scope, workspace),
		);
}

export function deferPackageSessions(
	receipt: PackageLifecycleReceipt,
	sessions: readonly RegisteredSession[],
): void {
	if (receipt.effect !== "app-restart") receipt.effect = "next-session";
	if (!sessions.length) return;
	receipt.deferredSessionIds = sessions.map(({ session }) => session.sessionId);
	for (const sessionId of receipt.deferredSessionIds)
		receipt.events.push(packageEvent("reload_deferred", sessionId));
}

function observedVersion(receipt: PackageLifecycleReceipt, event: PackageLifecycleEvent): string | null {
	const verified = receipt.events.find(({ type }) => type === "verified")?.detail;
	const version =
		event.type === "drained" || event.type === "disabled"
			? receipt.previousVersion
			: event.type === "rolled_back" || event.type === "reloaded" || event.type === "reload_deferred"
				? (receipt.version ?? receipt.previousVersion)
				: isPackageVersion(verified)
					? verified
					: receipt.version;
	return isPackageVersion(version) ? version : null;
}

export function recordPackageLifecycle(
	traces: Pick<SessionTraces, "recordCustom">,
	receipt: PackageLifecycleReceipt,
	sessions: readonly RegisteredSession[],
	observed: Map<RegisteredSession, number>,
): void {
	const packageName = npmPackageName(receipt.source);
	if (!packageName || receipt.packageName !== packageName) return;
	for (const entry of sessions) {
		if (entry.readOnly) continue;
		const { sessionId } = entry.session;
		for (const event of receipt.events.slice(observed.get(entry) ?? 0)) {
			if (event.sessionId && event.sessionId !== sessionId) continue;
			traces.recordCustom(sessionId, "package_lifecycle", {
				package: packageName,
				version: observedVersion(receipt, event),
				stage: event.type,
			});
		}
		observed.set(entry, receipt.events.length);
	}
}

/** GUI-launched npm may be absent from PATH (issue #18). */
export function isNpmSpawnEnoent(error: unknown): boolean {
	if (
		/(^|\b)spawn(\s+[^\s]+)*\s+npm(\.\w+)?\s+ENOENT\b/.test(
			error instanceof Error ? error.message : String(error),
		)
	)
		return true;
	const { code, syscall } = (error as { code?: unknown; syscall?: unknown } | null) ?? {};
	return code === "ENOENT" && typeof syscall === "string" && /\bnpm\b/.test(syscall);
}

function normalizePackageError(error: unknown): NonNullable<PackageLifecycleReceipt["error"]>["code"] {
	const explicit = (error as { code?: unknown } | null)?.code;
	if (
		explicit === "invalid-source" ||
		explicit === "builtin" ||
		explicit === "not-installed" ||
		explicit === "unavailable"
	)
		return explicit;
	const message = error instanceof Error ? error.message : String(error);
	if (/invalid package name|unsupported .*source/iu.test(message)) return "invalid-source";
	if (/not installed/iu.test(message)) return "not-installed";
	if (/updates are unavailable|npm.*not found|network|fetch|registry/iu.test(message)) return "unavailable";
	return "operation-failed";
}

export function failPackageOperation(
	receipt: PackageLifecycleReceipt,
	error: unknown,
): PackageLifecycleReceipt {
	const missingNpm = isNpmSpawnEnoent(error);
	const code = missingNpm ? "unavailable" : normalizePackageError(error);
	const message = missingNpm
		? `${NPM_NOT_FOUND_SENTINEL}: npm executable not found on PATH (install Node.js, then restart the app)`
		: (error instanceof Error ? error.message : String(error))
				.replace(/([A-Z_]*(?:TOKEN|PASSWORD|SECRET|API[_-]?KEY)[A-Z_]*\s*[=:]\s*)\S+/giu, "$1[redacted]")
				.slice(0, 1000);
	receipt.status = "failed";
	receipt.effect = "current-session";
	receipt.error = { code, message, retryable: code === "unavailable" || code === "operation-failed" };
	receipt.events.push(packageEvent("failed"));
	return receipt;
}
