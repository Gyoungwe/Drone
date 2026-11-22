import {
	type PluginRuntimeCapabilitiesOptions,
	type PluginRuntimeCapabilitiesProvider,
	type PluginRuntimeSource,
	type PluginSessionCallerContext,
	type StorageRegistry,
} from "@drone/backend";
import { createP5ByteRuntimeCapabilities } from "./p5-byte-runtime-capabilities";
import { createP5RuntimeCapabilities } from "./p5-runtime-capabilities";

/**
 * Z1d — the P5 capabilities the host contributes to a plugin activation.
 *
 * The two providers are separate on purpose.  The receipts and facts are
 * *reads* the host keeps on the plugin's behalf, and the byte staging is a
 * *write* the plugin asks the user to grant a directory for.  Composing them
 * here keeps the composition rule in one place:
 *
 * - a provider that does not apply to the source contributes nothing at all;
 * - the handlers of two providers never collide, because each provider owns
 *   its own namespace (`receipts.*`, `facts.*`, `bytes.*`);
 * - every provider is disposed, and a provider that fails to dispose does not
 *   cost the others their disposal.
 *
 * The providers gate themselves, but only in part.  The byte provider returns
 * an empty set of handlers unless the source declared the `staged-output`
 * opt-in.  The reads provider has no such opt-in: it applies to every source,
 * and it *throws* when the source is not an installed package with a content
 * identity.  So the host applies the one prerequisite the provider assumes:
 * a source without a content identity gets no P5 capability at all, rather
 * than an activation that fails.
 */

/** The activation a capability provider is given. */
type P5Activation = Parameters<PluginRuntimeCapabilitiesProvider>[0];

interface P5CompositionOptions {
	readonly userDataDir: string;
	readonly profileDirectory: string;
	readonly storageRegistry: StorageRegistry;
	getSessionContext(sessionId: string): PluginSessionCallerContext | undefined;
	selectStagedOutputDirectory(signal: AbortSignal): Promise<readonly string[]>;
}

/** The P5 capabilities of one activation. */
export interface P5CapabilityComposition {
	readonly handlers: PluginRuntimeCapabilitiesOptions["handlers"];
	dispose(): Promise<void>;
}

/**
 * Builds the P5 capabilities for one activation.
 *
 * The source decides which of them apply; the host never adds a capability
 * the source did not ask for.
 */
export async function composeP5Capabilities(
	options: P5CompositionOptions,
	source: PluginRuntimeSource,
	activation: P5Activation,
): Promise<P5CapabilityComposition> {
	// The P5 reads are the host's reads of the plugin's own records, and they
	// are scoped by the source's content identity.  A source without one is
	// not an installed package, and the reads provider rejects it — so the
	// host offers nothing rather than failing the activation.
	if (!source.contentHash) return { handlers: {}, dispose: async () => undefined };
	const receipts = await createP5RuntimeCapabilities({
		userDataDir: options.userDataDir,
		storageRegistry: options.storageRegistry,
		getSessionContext: options.getSessionContext,
	})(source)(activation);
	let bytes: PluginRuntimeCapabilitiesOptions;
	try {
		bytes = await createP5ByteRuntimeCapabilities({
			profileDirectory: options.profileDirectory,
			getSessionContext: options.getSessionContext,
			selectStagedOutputDirectory: options.selectStagedOutputDirectory,
		})(source)(activation);
	} catch (error) {
		// The byte provider can refuse the activation — the user cancels the
		// directory picker, or the selection is not exactly one directory.
		// The reads provider was already built at that point, and it owns an
		// open store, so it is released before the refusal is passed on.
		await receipts.dispose?.();
		throw error;
	}
	const ports = [receipts, bytes];
	return {
		handlers: { ...receipts.handlers, ...bytes.handlers },
		dispose: async () => {
			// Every provider is disposed even when one of them fails: the byte
			// provider removes a staging directory and the receipts provider
			// aborts its activation, and neither may be skipped because the
			// other threw.
			const results = await Promise.allSettled(ports.map((port) => port.dispose?.()));
			const failures = results.filter((result) => result.status === "rejected");
			if (failures.length)
				throw new AggregateError(
					failures.map((result) => result.reason),
					"P5 capability cleanup failed",
				);
		},
	};
}
