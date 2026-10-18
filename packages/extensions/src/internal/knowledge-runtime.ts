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
		// Both the generated `.pi/extensions` entry and the published
		// `pi-knowledge/dist` entry keep the worker one package-relative hop away.
		// Do not fall back to the host's `.pi/lib` compatibility tree: that would
		// make the production knowledge path depend on a legacy resource.
		const sibling = new URL("../lib/knowledge/runtime/worker.mjs", import.meta.url);
		if (sibling.protocol === "file:" && existsSync(fileURLToPath(sibling)))
			return new Worker(sibling, options as any);
		// Vitest and direct source imports execute this module from packages/extensions/src.
		// Keep that test-only/dev path explicit without putting a legacy fallback in the
		// emitted .pi/extensions or published plugin bundle.
		if (import.meta.url.includes("/packages/extensions/src/")) {
			const segments = ["..", "..", "..", "..", ".pi", "lib", "knowledge", "runtime", "worker.mjs"];
			const sourceWorker = pathToFileURL(
				resolve(dirname(fileURLToPath(import.meta.url)), segments.join("/")),
			);
			return new Worker(sourceWorker, options as any);
		}
		throw new Error("Knowledge worker resource is missing from the packaged extension");
	});
}
