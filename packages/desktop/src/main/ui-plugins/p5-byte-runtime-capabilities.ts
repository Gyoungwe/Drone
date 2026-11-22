import { createHash, randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import {
	createP5StagingOwners,
	measuredEnvelopeBytes,
	P5ByteStaging,
	P5ByteTransaction,
	type PluginCapabilityContext,
	type PluginRuntimeCapabilitiesOptions,
	type PluginRuntimeCapabilitiesProvider,
	type PluginRuntimeSource,
	type PluginSessionCallerContext,
	p5ByteCapabilityHandlers,
} from "@drone/backend";
import { type P5ResourceRootLease, selectP5ResourceRoot } from "./p5-resource-roots";
import { requireSession } from "./p5-runtime-capabilities";

interface P5ByteRuntimeOptions {
	readonly profileDirectory: string;
	getSessionContext(sessionId: string): PluginSessionCallerContext | undefined;
	selectStagedOutputDirectory(signal: AbortSignal): Promise<readonly string[]>;
}

type Activation = Parameters<PluginRuntimeCapabilitiesProvider>[0];
type Owner = NonNullable<ReturnType<ReturnType<typeof createP5StagingOwners>["ownerFor"]>>;
type GrantOf = Parameters<typeof p5ByteCapabilityHandlers>[0];

function selectWhileActive(options: P5ByteRuntimeOptions, signal: AbortSignal): Promise<readonly string[]> {
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
		void Promise.resolve()
			.then(() => {
				signal.throwIfAborted();
				return options.selectStagedOutputDirectory(signal);
			})
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", abort));
	});
}

function contains(parent: string, child: string): boolean {
	const path = relative(parent, child);
	return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function createStagingRoot(profileDirectory: string, pluginId: string, outputRoot: string) {
	const staging = join(realpathSync.native(profileDirectory), "p5-staging");
	const output = realpathSync.native(outputRoot);
	if (contains(output, staging) || contains(staging, output))
		throw new Error("P5 staged output must be separate from host-private staging");
	const pluginDirectory = join(staging, createHash("sha256").update(pluginId).digest("hex"));
	for (const directory of [staging, pluginDirectory]) {
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		if (realpathSync.native(directory) !== directory)
			throw new Error("P5 staging must remain in the host profile");
		chmodSync(directory, 0o700);
	}
	const path = mkdtempSync(join(pluginDirectory, "activation-"));
	const identity = lstatSync(path);
	const root = () => {
		const current = lstatSync(path);
		if (current.dev !== identity.dev || current.ino !== identity.ino || realpathSync.native(path) !== path)
			throw new Error("P5 staging root changed after creation");
		return path;
	};
	root();
	return root;
}

function createGrantResolver(
	options: P5ByteRuntimeOptions,
	activation: Activation,
	disposed: AbortSignal,
	contentHash: string,
	stagingRoot: () => string,
	lease: P5ResourceRootLease,
): GrantOf {
	const owners = createP5StagingOwners(randomUUID);
	const grants = new Map<Owner, NonNullable<ReturnType<GrantOf>>>();
	return (context: PluginCapabilityContext) => {
		const { callerIdentity, sessionIdentity } = context;
		if (
			disposed.aborted ||
			activation.signal.aborted ||
			!callerIdentity ||
			!sessionIdentity ||
			context.pluginId !== activation.pluginId ||
			context.applicationId !== activation.applicationId
		)
			return undefined;
		const selected = requireSession(options, context);
		const owner = owners.ownerFor(
			{
				identity: callerIdentity,
				sessionIdentity,
				workspaceId: selected.scope.workspaceId,
				sessionId: selected.scope.sessionId,
				callerSourceHash: contentHash,
				providerSourceHash: contentHash,
				signals: [activation.signal, disposed, selected.signal],
			},
			"bytes",
		);
		if (!owner) return undefined;
		const existing = grants.get(owner);
		if (existing) return existing;
		const outputRoot = lease.root();
		const ownerDirectory = join(stagingRoot(), owner.callerId);
		mkdirSync(ownerDirectory, { mode: 0o700 });
		const liveOwner = () => (owner.signal.aborted ? undefined : owner);
		const staging = new P5ByteStaging(ownerDirectory, liveOwner);
		const grant = {
			staging,
			transaction: new P5ByteTransaction(outputRoot, staging, liveOwner, lease.reservations),
		};
		grants.set(owner, grant);
		owner.signal.addEventListener("abort", () => grants.delete(owner), { once: true });
		return grant;
	};
}

function createBytePorts(
	options: P5ByteRuntimeOptions,
	activation: Activation,
	contentHash: string,
	stagingRoot: () => string,
	lease: P5ResourceRootLease,
	pluginId: string,
): PluginRuntimeCapabilitiesOptions {
	const disposed = new AbortController();
	const grantOf = createGrantResolver(options, activation, disposed.signal, contentHash, stagingRoot, lease);
	const handlers = p5ByteCapabilityHandlers(grantOf, measuredEnvelopeBytes);
	const write = handlers["bytes.write"];
	if (!write) throw new Error("Missing P5 byte write handler");
	let cleanupFailed = false;
	let stagingRemoved = false;
	handlers["bytes.write"] = {
		...write,
		approvalReview: (input, facts) => ({
			kind: "byte-write",
			pluginId: facts.pluginId || pluginId,
			root: lease.root(),
			file: {
				path: String((input as { path?: unknown }).path ?? ""),
				bytes: Number((input as { source?: { bytes?: unknown } }).source?.bytes ?? 0),
				sha256: String((input as { source?: { sha256?: unknown } }).source?.sha256 ?? ""),
			},
		}),
		execute: async (input, context) => {
			const result = await write.execute(input, context);
			if (
				typeof result === "object" &&
				result !== null &&
				"status" in result &&
				result.status === "failed" &&
				"code" in result &&
				result.code === "CLEANUP_FAILED"
			)
				cleanupFailed = true;
			return result;
		},
	};
	return {
		resources: [],
		handlers,
		dispose: async () => {
			disposed.abort();
			await lease.close(async () => {
				if (!stagingRemoved) {
					rmSync(stagingRoot(), { recursive: true });
					stagingRemoved = true;
				}
				if (cleanupFailed) throw new Error("P5 byte transaction: CLEANUP_FAILED");
			});
		},
	};
}

export function createP5ByteRuntimeCapabilities(
	options: P5ByteRuntimeOptions,
): (source: PluginRuntimeSource) => PluginRuntimeCapabilitiesProvider {
	return (source) => async (activation) => {
		if (source.p5?.bytes !== "staged-output") return { resources: [], handlers: {} };
		const contentHash = source.contentHash;
		if (!contentHash) throw new Error("P5 bytes require a current installed package content identity");
		if (activation.pluginId !== source.pluginId) throw new Error("P5 activation source does not match");
		activation.signal.throwIfAborted();
		const paths = await selectWhileActive(options, activation.signal);
		activation.signal.throwIfAborted();
		const [path] = paths;
		if (path === undefined) throw new Error("P5 staged output directory selection was canceled");
		if (paths.length !== 1) throw new Error("P5 staged output requires exactly one directory");
		const grant = { kind: "staged-output", handle: randomUUID(), path };
		const selection = selectP5ResourceRoot([grant], grant, activation.signal);
		const lease = selection.acquire();
		let stagingRoot: () => string;
		try {
			stagingRoot = createStagingRoot(options.profileDirectory, source.pluginId, lease.root());
		} catch (error) {
			await lease.close(async () => undefined);
			throw error;
		}
		return createBytePorts(options, activation, contentHash, stagingRoot, lease, source.pluginId);
	};
}
