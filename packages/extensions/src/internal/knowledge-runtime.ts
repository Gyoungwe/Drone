import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { configureKnowledgeRuntime, configureKnowledgeWorker } from "@drone/knowledge/runtime-host";
import { runRuntimeExclusive, runtimeSlot } from "@drone/tasks/runtime-bridge";
import { flowCardBuilder, toolMeta } from "@drone/tasks/tool-manifest-runtime";

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
		toolMeta: toolMeta as any,
		flowCardBuilder: flowCardBuilder as any,
		emitProcessEvent: (event, payload) => (process as any).emit(event, payload),
	});
	configureKnowledgeWorker((_url, options) => {
		// Built extension entries resolve their sibling runtime. Source tests use
		// the checked-in generated worker owned by this extensions package.
		const sibling = new URL("../lib/knowledge/runtime/worker.mjs", import.meta.url);
		const workerUrl = sibling.protocol === "file:" && !existsSync(fileURLToPath(sibling))
			? pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.pi/lib/knowledge/runtime/worker.mjs"))
			: sibling;
		return new Worker(workerUrl, options as any);
	});
}
