import { Worker } from "node:worker_threads";
import { configureKnowledgeRuntime, configureKnowledgeWorker } from "@drone/knowledge/runtime-host";
import { runRuntimeExclusive, runtimeSlot } from "@drone/tasks/runtime-bridge";

let configured = false;

/**
 * Install the host seams needed by the bundled extension graph.
 *
 * The knowledge service is bundled into each extension entry, while its
 * worker remains a separate resource. Resolving the worker relative to the
 * emitted `.pi/extensions` entry keeps CLI and desktop hosts on the same
 * compiled worker without importing source TypeScript at runtime.
 */
export function configureKnowledgeExtensionRuntime(): void {
	if (configured) return;
	configured = true;
	configureKnowledgeRuntime({
		runRuntimeExclusive,
		runtimeSlot: runtimeSlot as any,
		emitProcessEvent: (event, payload) => (process as any).emit(event, payload),
	});
	configureKnowledgeWorker((_url, options) =>
		new Worker(new URL("../lib/knowledge/runtime/worker.mjs", import.meta.url), options as any),
	);
}
