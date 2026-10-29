import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { withNativeSubagentSlot } from "../tools/subagent/slots";
import {
	runKnowledgeSpecialist,
	type SpecialistRequest,
	type SpecialistResult,
	type SpecialistRunnerDeps,
} from "./specialist-runner";

export type KnowledgeSpecialistHostRegistrar = (
	sessionId: string,
	run: (input: SpecialistRequest) => Promise<SpecialistResult>,
) => (() => void) | undefined;

/** Registered per parent session, not as a globally invokable model tool. */
export function makeKnowledgeSpecialistBridge(
	deps: SpecialistRunnerDeps & { registerKnowledgeSpecialistHost?: KnowledgeSpecialistHostRegistrar },
) {
	return (pi: ExtensionAPI) => {
		let unregister: (() => void) | undefined;
		const active = new Set<AbortController>();
		async function connect(_event: unknown, ctx: ExtensionContext) {
			if (!process.env.DRONE_KNOWLEDGE_DIR) return;
			unregister?.();
			const sessionId = ctx.sessionManager.getSessionId();
			const run = async (input: SpecialistRequest) => {
				const controller = new AbortController(),
					abort = () => controller.abort();
				active.add(controller);
				if (input.signal?.aborted) abort();
				else input.signal?.addEventListener("abort", abort, { once: true });
				try {
					return await withNativeSubagentSlot(ctx.cwd, controller.signal, () =>
						runKnowledgeSpecialist(deps, { ...input, signal: controller.signal }),
					);
				} finally {
					active.delete(controller);
					input.signal?.removeEventListener("abort", abort);
				}
			};
			// The installed knowledge package owns its registry. The host only receives
			// an optional local registrar for compatibility/test module graphs; the
			// standard process event below is the production cross-graph contract.
			unregister = deps.registerKnowledgeSpecialistHost?.(sessionId, run);
			// The generated runtime may be loaded through a separate ESM graph from the
			// host adapter. Re-announce over the stable process event so both graphs see
			// the same per-session callback without relying on module-local slot identity.
			(process as any).emit("drone:knowledge-specialist-host/v1", {
				action: "register",
				id: sessionId,
				run,
			});
			const release = unregister;
			unregister = () => {
				release?.();
				(process as any).emit("drone:knowledge-specialist-host/v1", {
					action: "unregister",
					id: sessionId,
					run,
				});
			};
		}
		pi.on("session_start", connect);
		pi.on("session_shutdown", async () => {
			unregister?.();
			unregister = undefined;
			for (const c of active) c.abort();
			active.clear();
		});
	};
}
