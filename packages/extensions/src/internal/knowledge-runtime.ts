import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
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
		// The generated `.pi/extensions` graph ships a sibling worker resource;
		// this is the production path for CLI and desktop hosts. Published
		// `pi-knowledge` keeps its own package-relative worker as a fallback.
		const bundled = new URL("knowledge-worker.mjs", import.meta.url);
		if (bundled.protocol === "file:" && existsSync(fileURLToPath(bundled)))
			return new Worker(bundled, options as any);
		const packageWorker = new URL("../lib/knowledge/runtime/worker.mjs", import.meta.url);
		if (packageWorker.protocol === "file:" && existsSync(fileURLToPath(packageWorker)))
			return new Worker(packageWorker, options as any);
		// Vitest and direct source imports execute this module from packages/extensions/src.
		// Use the committed generated worker for those tests without reaching into
		// the deleted `.pi/lib/knowledge` compatibility tree.
		const developmentRoots = [
			process.env.DRONE_RESEARCH_WORKBENCH_ROOT,
			resolve(process.cwd(), ".pi", "extensions"),
			resolve(process.cwd(), "..", ".pi", "extensions"),
			resolve(process.cwd(), "..", "..", ".pi", "extensions"),
		].filter(Boolean);
		for (const root of developmentRoots) {
			const sourceWorker = pathToFileURL(join(root, "knowledge-worker.mjs"));
			if (existsSync(fileURLToPath(sourceWorker))) return new Worker(sourceWorker, options as any);
		}
		throw new Error("Knowledge worker resource is missing from the packaged extension");
	});
}
