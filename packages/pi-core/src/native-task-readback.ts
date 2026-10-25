import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PiCoreContext } from "./index";

interface TaskJournal {
	scope(): string;
	snapshot(): { id: string } | null;
	readRoots(): string[];
}

interface ReadRequest {
	cwd: string;
	path: string;
	sessionId: string;
	claim(): void;
	resolve(allowed: boolean): void;
}

const contains = (root: string, file: string): boolean => {
	const path = relative(root, file);
	return path !== "" && !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
};

/** Native Pi reuses the current task's approved output scope for host readback.
 * Desktop's permission engine remains authoritative when it announces its runtime.
 * The event seam also supports pi-knowledge 0.2.1 / pi-research 0.2.0 journals,
 * whose configure method predates native readback options. */
export function registerNativeTaskReadback(
	pi: any,
	journal: TaskJournal,
	currentContext: () => PiCoreContext | undefined,
): void {
	let desktopOwnsPermissions = false;
	pi.events.on("drone:runtime/v1", (event: { version?: number } | null | undefined) => {
		if (event?.version === 1) desktopOwnsPermissions = true;
	});
	pi.events.on("drone:task-read-check", (raw: unknown) => {
		const ctx = currentContext();
		const request = raw as ReadRequest | null;
		// Requests cross an extension event boundary; never answer for a different session.
		if (
			desktopOwnsPermissions ||
			!ctx ||
			!request ||
			typeof request.sessionId !== "string" ||
			request.sessionId !== ctx.sessionManager?.getSessionId() ||
			typeof request.cwd !== "string" ||
			request.cwd !== ctx.cwd ||
			typeof request.path !== "string" ||
			typeof request.claim !== "function" ||
			typeof request.resolve !== "function"
		)
			return;
		request.claim();
		const scope = createHash("sha256")
			.update(`${request.sessionId}\0${resolve(request.cwd)}`)
			.digest("hex");
		const taskId = journal.snapshot()?.id;
		const current = () =>
			!desktopOwnsPermissions &&
			currentContext() === ctx &&
			ctx.sessionManager?.getSessionId() === request.sessionId &&
			ctx.cwd === request.cwd &&
			ctx.hasUI !== false &&
			!!ctx.ui?.select &&
			!ctx.signal?.aborted &&
			journal.scope() === scope &&
			journal.snapshot()?.id === taskId;
		const check = async () => {
			if (!current()) return false;
			const roots = journal.readRoots();
			const root = roots.find((candidate) => contains(candidate, resolve(request.cwd, request.path)));
			if (!root) return false;
			const canonicalRoot = await realpath(root);
			// Consent binds the approved root. The task runtime then checks the file
			// realpath, private-path policy and hash before returning any contents.
			return current() && journal.readRoots().includes(root) && canonicalRoot === root;
		};
		void check().then(request.resolve, (error: unknown) => {
			console.warn("Native task artifact readback is unavailable.", error);
			request.resolve(false);
		});
	});
	pi.events.emit("drone:runtime/request/v1", { version: 1 });
}
