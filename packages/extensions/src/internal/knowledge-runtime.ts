import { Worker } from "node:worker_threads";
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
		// Both the generated `.pi/extensions` entry and the published
		// `pi-knowledge/dist` entry keep the worker one package-relative hop away.
		// Do not fall back to the host's `.pi/lib` compatibility tree: that would
		// make the production knowledge path depend on a legacy resource.
		const sibling = new URL("../lib/knowledge/runtime/worker.mjs", import.meta.url);
		return new Worker(sibling, options as any);
	});
}
