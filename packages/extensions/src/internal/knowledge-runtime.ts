import { Worker } from "node:worker_threads";
import { deliveryContract as researchDeliveryContract } from "@gyoungwe/pi-research/host";
import {
	configureKnowledgeRuntime,
	configureKnowledgeWorker,
	resolveKnowledgePackageWorkerMetadata,
	resolveKnowledgePackageWorkerUrl,
} from "@gyoungwe/pi-knowledge/host";
import { runRuntimeExclusive, runtimeSlot } from "@drone/tasks/runtime-bridge";
import { flowCardBuilder, toolMeta } from "@drone/tasks/tool-manifest-runtime";
import { bindAcceptanceVerifierEvents, registerAcceptanceVerifier } from "@drone/tasks/acceptance";
import { registerTool } from "@drone/tasks/tool-manifest-runtime";
import { configureKnowledgeExtensionHost } from "@gyoungwe/pi-knowledge/host";

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
	configureKnowledgeExtensionHost({
		bindAcceptanceVerifierEvents,
		registerAcceptanceVerifier,
		registerTool,
	});
	configureKnowledgeRuntime({
		runRuntimeExclusive,
		runtimeSlot: runtimeSlot as any,
		toolMeta: toolMeta as any,
		flowCardBuilder: flowCardBuilder as any,
		deliveryContract: researchDeliveryContract as any,
		emitProcessEvent: (event, payload) => (process as any).emit(event, payload),
	});
	configureKnowledgeWorker(
		(_url, options) => new Worker(resolveKnowledgePackageWorkerUrl(), options as any),
		() => resolveKnowledgePackageWorkerMetadata(),
	);
}
