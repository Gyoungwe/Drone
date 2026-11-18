import { join } from "node:path";
import {
	createP5FactStore,
	createP5ReceiptStore,
	type PluginCapabilityContext,
	type PluginCapabilityHandler,
	type PluginRuntimeCapabilitiesProvider,
	type PluginRuntimeSource,
	type PluginSessionCallerContext,
	p5FactCapabilityHandlers,
	p5ReceiptCapabilityHandlers,
	type StorageRegistry,
} from "@drone/backend";
import type { Scope } from "@gyoungwe/plugin-api/p5-receipts";

interface P5RuntimeOptions {
	readonly userDataDir: string;
	readonly storageRegistry: StorageRegistry;
	getSessionContext(sessionId: string): PluginSessionCallerContext | undefined;
}

function requireSession(options: P5RuntimeOptions, context: PluginCapabilityContext) {
	context.signal.throwIfAborted();
	if (context.bootstrap || context.scope.kind !== "session")
		throw new Error("Plugin capability requires a selected live session");
	// The broker does not yet project both source hashes for nested dispatch.
	if (context.providerChain?.length) throw new Error("P5 capability requires proven direct source lineage");
	const selected = options.getSessionContext(context.scope.sessionId);
	if (
		!selected ||
		selected.identity !== context.sessionIdentity ||
		selected.signal.aborted ||
		selected.scope.sessionId !== context.scope.sessionId ||
		selected.scope.workspaceId !== context.scope.workspaceId
	)
		throw new Error("Plugin capability caller is stale or belongs to another session");
	return selected.scope;
}

/** Profile path, host inventory and live session resolver are host inputs; pass a canonical installed source per provider. */
export function createP5RuntimeCapabilities(
	options: P5RuntimeOptions,
): (source: PluginRuntimeSource) => PluginRuntimeCapabilitiesProvider {
	const receipts = createP5ReceiptStore({
		path: join(options.userDataDir, "p5-receipts.json"),
		registry: options.storageRegistry,
	});
	const facts = createP5FactStore({
		path: join(options.userDataDir, "p5-facts.json"),
		registry: options.storageRegistry,
	});
	return (source) => (activation) => {
		activation.signal.throwIfAborted();
		const hash = source.contentHash;
		if (!hash) throw new Error("P5 reads require a current installed package content identity");
		if (activation.pluginId !== source.pluginId) throw new Error("P5 activation source does not match");
		const closed = new AbortController();
		const scopeOf = (context: PluginCapabilityContext): Scope => {
			activation.signal.throwIfAborted();
			closed.signal.throwIfAborted();
			if (context.pluginId !== activation.pluginId || context.applicationId !== activation.applicationId)
				throw new Error("P5 capability caller belongs to another activation");
			const selected = requireSession(options, context);
			return {
				workspaceId: selected.workspaceId,
				sessionId: selected.sessionId,
				callerSourceHash: hash,
				providerSourceHash: hash,
			};
		};
		const guarded = (handler: PluginCapabilityHandler): PluginCapabilityHandler => ({
			...handler,
			execute: async (input, context) => {
				const result = await handler.execute(input, context);
				scopeOf(context);
				return result;
			},
		});
		return {
			resources: [],
			handlers: {
				"receipts.read": guarded(p5ReceiptCapabilityHandlers(receipts, scopeOf)["receipts.read"]),
				"facts.read": guarded(p5FactCapabilityHandlers(facts, scopeOf)["facts.read"]),
			},
			dispose: async () => closed.abort(new Error("P5 capability activation disposed")),
		};
	};
}
