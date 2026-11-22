import type { Scope } from "@gyoungwe/plugin-api/p5-receipts";
import {
	createP5FactStore as createFactStore,
	type createP5FactStore,
	P5_FACT_STORAGE,
} from "../plugins/p5-facts";
import type { P5ActiveFactOwner } from "../plugins/p5-host-delivery";
import type { P5OwnerAttachmentPort } from "../plugins/p5-owner-attachments";
import type { PluginRuntimeSource } from "../plugins/plugin-source";
import type { PluginSessionCallerContext } from "../plugins/session-caller";
import type { StorageRegistry } from "../storage/registry";

/**
 * Z2 — the P5 host composition.
 *
 * The P5 port modules are complete: the delivery mechanism, the owner
 * attachments, the fact journal and the receipt store all take their
 * dependencies as parameters and contain no host knowledge.  What is missing
 * is the one place that decides *which* real host object satisfies each
 * dependency, and hands the result to the coordinator.
 *
 * Until now `PluginRuntimeBridgeOptions.factOwners` was declared and read
 * (`coordinator-native.ts` binds the native owner through it) but never
 * supplied.  A port that is never filled is not a capability, and this module
 * is where it gets filled.
 *
 * The rules this composition follows:
 *
 * - **A scope comes from the live session, never from the plugin.**  The
 *   workspace and session IDs are the session's own, and the two source
 *   hashes are the *current* installed package's hash — the same hash for
 *   caller and provider, because the host is both ends of a direct call.
 * - **A source without a content identity gets no scope.**  `Scope` requires
 *   both hashes to be 64 hex characters, so a source that cannot prove one
 *   has no scope to give.  The composition refuses the attachment instead of
 *   inventing a scope it cannot justify — a fabricated scope would fail the
 *   schema check later, in a place that reads as a different bug.
 * - **Nothing here authorizes anything.**  `authorize` asks the host whether
 *   the effective S still covers this owner; it never grants.
 */

export interface P5HostCompositionOptions {
	/**
	 * Host-private directory for the P5 stores, used only when the storage
	 * registry has no entry for the fact journal yet.
	 */
	readonly userDataDir: string;
	readonly storageRegistry: StorageRegistry;
}

/**
 * The host's answer to "does the effective S still cover this owner?".
 *
 * The composition asks the host; it never decides.  A host that cannot prove
 * the current grant denies, because a delivery without authority is worse
 * than no delivery.
 */
export interface P5AdoptionAuthority {
	/** Whether the current adopted writer grant covers this owner right now. */
	authorize(attachment: P5ActiveFactOwner): Promise<boolean>;
}

export interface P5HostComposition {
	/** The port the coordinator binds a native fact owner through. */
	readonly factOwners: P5OwnerAttachmentPort;
	/** The scoped fact journal, for producers that append facts. */
	readonly facts: ReturnType<typeof createP5FactStore>;
}

/**
 * The scope of a direct host call.
 *
 * Both source hashes are the current installed package's hash.  The host is
 * the caller and the provider of a direct call, so there is one hash, and it
 * is the one the installed package currently has — not one carried in a
 * receipt, which a restore could have made stale.
 *
 * Returns `undefined` when the source cannot prove its identity.
 */
export function p5ScopeOf(
	source: PluginRuntimeSource,
	session: PluginSessionCallerContext,
): Scope | undefined {
	const hash = source.contentHash;
	if (!hash) return undefined;
	return {
		workspaceId: session.scope.workspaceId,
		sessionId: session.scope.sessionId,
		callerSourceHash: hash,
		providerSourceHash: hash,
	};
}

/**
 * Builds the P5 host composition.
 *
 * The returned `factOwners` port is what the coordinator needs to attach a
 * native owner's fact delivery.  It carries the fact journal (for both the
 * read and the committed-change subscription), the scope derivation, and the
 * host's authorization answer.
 */
export function createP5HostComposition(
	options: P5HostCompositionOptions,
	authority: P5AdoptionAuthority,
): P5HostComposition {
	const facts = createFactStore({
		// The journal lives where the host's storage ledger says it lives.
		// The ledger owns the path; the composition only falls back to its
		// own directory when the host registered nothing, so the journal can
		// never end up at a second, competing path.
		path: options.storageRegistry.get(P5_FACT_STORAGE.id)?.path ?? `${options.userDataDir}/p5-facts.json`,
		registry: options.storageRegistry,
	});
	const factOwners: P5OwnerAttachmentPort = {
		scopeOf: (source, session) => {
			const scope = p5ScopeOf(source, session);
			// The port's signature cannot express "no scope", so the refusal
			// is an exception.  It is the honest answer: a scope here would
			// have to invent one of the two source hashes.
			if (!scope) throw new Error("P5 fact ownership requires a current installed package identity");
			return scope;
		},
		facts,
		authorize: (attachment) => authority.authorize(attachment),
	};
	return { factOwners, facts };
}
