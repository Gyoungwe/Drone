import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { PluginNativeSession } from "@gyoungwe/plugin-api/native";
import type { PluginNativeSessionFacts, PluginRuntimeClient } from "@gyoungwe/plugin-api/runtime";
import type { PluginNativeBootstrap, PluginRuntimeBridgeOptions, PluginRuntimeOwner } from "./coordinator";
import { NativeSessionDelivery } from "./native-delivery";
import { type PluginRuntimeSource, sameSource } from "./plugin-source";
import type { ManagedNativeSession, PluginRuntimeCaller, PluginRuntimeRegistry } from "./runtime";
import type { PluginSessionCallerContext } from "./session-caller";

export interface Runtime {
	readonly name: string;
	readonly source: PluginRuntimeSource;
	readonly registry: PluginRuntimeRegistry;
	readonly bindings: Set<Binding>;
	readonly activationOwner: PluginRuntimeOwner;
	active: boolean;
	stopping?: Promise<void>;
}
export interface Binding {
	readonly token: string;
	readonly name: string;
	readonly owner: PluginRuntimeOwner;
	readonly runtime: Runtime;
	readonly abort: AbortController;
	readonly pending: Set<Promise<unknown>>;
	readonly ready: Promise<PluginRuntimeClient>;
	readonly invocations: Map<
		string,
		{ selectionToken: string; abort: AbortController; pending: Promise<unknown> }
	>;
	unsubscribe?: () => void;
	nativeAbort?: () => Promise<void>;
}

interface NativeBootstrapHost {
	readonly options: Pick<
		PluginRuntimeBridgeOptions,
		"classifySelectedPath" | "source" | "enabled" | "sources" | "requiredSources" | "getSessionContext"
	>;
	bind(name: string, owner: PluginRuntimeOwner): Promise<string | undefined>;
	getBinding(token: string): Binding | undefined;
	caller(binding: Binding): PluginRuntimeCaller | undefined;
	selectSession(owner: PluginRuntimeOwner, sessionId: string): string;
	allowed(binding: Binding): boolean;
	stopBinding(binding: Binding): Promise<void>;
	removeSelection(owner: PluginRuntimeOwner): void;
	revoke(name: string | undefined, ownerId: number): Promise<void>;
	nextNativeId(): number;
}

interface NativeBootstrapState {
	readonly attachments: Set<PluginNativeSession>;
	readonly delivery: NativeSessionDelivery;
	readonly owners: Set<PluginRuntimeOwner>;
	readonly pending: Set<Promise<ExtensionFactory | undefined>>;
	readonly binders: Set<(session: PluginSessionCallerContext) => void>;
	bound: PluginSessionCallerContext | undefined;
	abortBound: (() => Promise<void>) | undefined;
	closed: boolean;
}

export function beginNativeBootstrap(
	host: NativeBootstrapHost,
	owner: PluginRuntimeOwner,
	findName: (path: string) => string | undefined,
	facts?: PluginNativeSessionFacts,
): PluginNativeBootstrap {
	const bootstrap: NativeBootstrapState = {
		attachments: new Set(),
		delivery: new NativeSessionDelivery(
			(path) => {
				if (host.options.classifySelectedPath) return host.options.classifySelectedPath(path);
				const name = findName(path);
				if (!name) return { kind: "unconfirmed" };
				const source = host.options.source(name);
				return source
					? { kind: "managed", source, state: host.options.enabled(name) ? "enabled" : "disabled" }
					: { kind: "unconfirmed" };
			},
			sameSource,
			() => host.options.sources?.() ?? host.options.requiredSources?.() ?? [],
		),
		owners: new Set(),
		pending: new Set(),
		binders: new Set(),
		bound: undefined,
		abortBound: undefined,
		closed: false,
	};
	return {
		delivery: bootstrap.delivery,
		bindSession: (sessionId, abort) => bindSession(host, bootstrap, facts, sessionId, abort),
		factoryForPath: (path) => {
			const creating = createFactory(host, bootstrap, owner, findName, path, facts);
			bootstrap.pending.add(creating);
			void creating.then(
				() => bootstrap.pending.delete(creating),
				() => bootstrap.pending.delete(creating),
			);
			return creating;
		},
		dispose: () => disposeBootstrap(host, bootstrap),
	};
}

function bindSession(
	host: NativeBootstrapHost,
	bootstrap: NativeBootstrapState,
	facts: PluginNativeSessionFacts | undefined,
	sessionId: string,
	abort?: () => Promise<void>,
): void {
	const session = host.options.getSessionContext(sessionId);
	if (
		facts &&
		(!session ||
			session.readOnly !== facts.readOnly ||
			session.nativeKind !== facts.kind ||
			(facts.kind === "child" && session.nativeChildFiles !== facts.files))
	)
		throw new Error("Native initial facts do not match the actual registered session");
	if (!session || bootstrap.closed || (bootstrap.bound && bootstrap.bound.identity !== session.identity))
		throw new Error("Native bootstrap requires its actual live session entry");
	bootstrap.bound = session;
	bootstrap.abortBound = abort;
	for (const bind of bootstrap.binders) bind(session);
}

function createNativeOwner(
	host: NativeBootstrapHost,
	bootstrap: NativeBootstrapState,
	owner: PluginRuntimeOwner,
): PluginRuntimeOwner {
	const nativeOwner: PluginRuntimeOwner = {
		id: host.nextNativeId(),
		approvalOwner: owner,
		isDestroyed: () =>
			bootstrap.closed || (bootstrap.bound ? bootstrap.bound.signal.aborted : owner.isDestroyed()),
		isSessionBound: () => bootstrap.bound !== undefined,
	};
	bootstrap.owners.add(nativeOwner);
	return nativeOwner;
}

async function createFactory(
	host: NativeBootstrapHost,
	bootstrap: NativeBootstrapState,
	owner: PluginRuntimeOwner,
	findName: (path: string) => string | undefined,
	path: string,
	facts?: PluginNativeSessionFacts,
): Promise<ExtensionFactory | undefined> {
	if (bootstrap.closed) throw new Error("Native plugin bootstrap is closed");
	const name = findName(path);
	if (!name) return undefined;
	const nativeOwner = createNativeOwner(host, bootstrap, owner);
	const token = await host.bind(name, nativeOwner);
	if (!token) throw new Error("Managed native plugin source is unavailable");
	const binding = host.getBinding(token);
	if (!binding) throw new Error("Native plugin binding was revoked");
	let boundSession: PluginSessionCallerContext | undefined;
	const resolveNativeCaller = () => {
		if (!boundSession) return undefined;
		const current = host.options.getSessionContext(boundSession.scope.sessionId);
		if (current?.identity !== boundSession.identity) return undefined;
		return host.caller(binding);
	};
	binding.nativeAbort = async () => {
		if (!boundSession || !bootstrap.abortBound) return;
		const current = host.options.getSessionContext(boundSession.scope.sessionId);
		if (current?.identity !== boundSession.identity) return;
		const { abortBound } = bootstrap;
		await abortBound();
	};
	const bind = (session: PluginSessionCallerContext) => {
		boundSession = session;
		host.selectSession(nativeOwner, session.scope.sessionId);
	};
	bootstrap.binders.add(bind);
	if (bootstrap.bound) bind(bootstrap.bound);
	let native: ManagedNativeSession;
	try {
		native = await binding.runtime.registry.attachNative(
			binding.runtime.source.pluginId,
			(ctx) => {
				if (ctx.sessionManager.getSessionId() !== boundSession?.scope.sessionId) return undefined;
				return resolveNativeCaller();
			},
			resolveNativeCaller,
			facts,
		);
	} catch (error) {
		await host.stopBinding(binding);
		throw error;
	}
	const adopted = adoptNative(host, bootstrap, binding, nativeOwner, native, bind);
	if (bootstrap.closed) {
		await adopted.dispose();
		throw new Error("Native plugin bootstrap was revoked");
	}
	return adopted.extension;
}

function adoptNative(
	host: NativeBootstrapHost,
	bootstrap: NativeBootstrapState,
	binding: Binding,
	nativeOwner: PluginRuntimeOwner,
	native: ManagedNativeSession,
	bind: (session: PluginSessionCallerContext) => void,
): PluginNativeSession {
	const detachDelivery = bootstrap.delivery.attach(binding.runtime.source, native, () =>
		host.allowed(binding),
	);
	let stopping: Promise<void> | undefined;
	const dispose = () => {
		stopping ??= (async () => {
			detachDelivery?.();
			binding.abort.abort(new Error("Native plugin session closed"));
			const [released] = await Promise.allSettled([native.dispose()]);
			const [stopped] = await Promise.allSettled([host.stopBinding(binding)]);
			host.removeSelection(nativeOwner);
			bootstrap.attachments.delete(adopted);
			bootstrap.binders.delete(bind);
			const failures = [released, stopped].filter((result) => result.status === "rejected");
			if (failures.length)
				throw new AggregateError(
					failures.map((result) => result.reason),
					"Native plugin session disposal failed",
				);
		})();
		return stopping;
	};
	const adopted: PluginNativeSession = {
		...native,
		dispose,
		extension: async (pi) => {
			await native.extension(pi);
			pi.on("session_shutdown", dispose);
		},
	};
	bootstrap.attachments.add(adopted);
	return adopted;
}

async function disposeBootstrap(host: NativeBootstrapHost, bootstrap: NativeBootstrapState): Promise<void> {
	bootstrap.closed = true;
	const revoked = await Promise.allSettled(
		[...bootstrap.owners].map((owner) => host.revoke(undefined, owner.id)),
	);
	// Each loader retains its error; disposal waits for all pending registration cleanup.
	await Promise.allSettled([...bootstrap.pending]);
	const results = [
		...revoked,
		...(await Promise.allSettled([bootstrap.delivery.dispose()])),
		...(await Promise.allSettled([...bootstrap.attachments].map((native) => native.dispose()))),
	];
	const failures = results.filter((result) => result.status === "rejected");
	if (failures.length)
		throw new AggregateError(
			failures.map((result) => result.reason),
			"Native plugin bootstrap disposal failed",
		);
}
