import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import type { PluginRuntimeInstance } from "@gyoungwe/plugin-api/runtime";
import { type Static, Type } from "typebox";
import type { PluginFileCapabilities } from "./file-capabilities";
import { createProcessPluginRuntime } from "./process-runtime";
import { PluginResourceReservations } from "./resource-reservations";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";

const label = Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,63}$" });
const createSchema = Type.Object(
	{
		resource: Type.String({ minLength: 1 }),
		storage: Type.Object(
			{ root: Type.String({ minLength: 1 }), key: Type.String({ minLength: 1 }) },
			{ additionalProperties: false },
		),
		parameters: Type.Unknown(),
		reservation: Type.Object(
			{
				namespace: label,
				roots: Type.Array(
					Type.Object(
						{ root: Type.String({ minLength: 1 }), path: Type.String(), kind: label },
						{ additionalProperties: false },
					),
					{ minItems: 1 },
				),
				storage: Type.Object(
					{ path: Type.String({ minLength: 1 }), kind: label },
					{ additionalProperties: false },
				),
			},
			{ additionalProperties: false },
		),
	},
	{ additionalProperties: false },
);
type ResourceInput = Static<typeof createSchema>;
interface ResourceEntry {
	readonly handle: string;
	readonly key: string;
	readonly parameters: string;
	readonly exclusiveKeys: readonly string[];
	readonly ready: Promise<PluginRuntimeInstance>;
	readonly pending: Set<Promise<unknown>>;
	closing?: Promise<void>;
}
export interface PluginResourceManagerOptions {
	readonly pluginId: string;
	readonly applicationId: string;
	readonly packageRoot: string;
	/** Canonical paths read from this exact package's validated manifest. */
	readonly entries: Readonly<Record<string, string>>;
	readonly runtimeDirectory?: string;
	readonly files: PluginFileCapabilities;
	readonly signal: AbortSignal;
	readonly events: { changed(): void };
	readonly leaseDirectory?: string;
}

async function storageIdentity(directory: string, path: string): Promise<string> {
	if (
		isAbsolute(path) ||
		path.includes("\\") ||
		path.includes("\0") ||
		path.split("/").some((part) => !part || part === "." || part === "..")
	)
		throw new Error("Expected a cache-relative resource filename");
	const file = join(directory, path);
	const parent = await realpath(dirname(file));
	const suffix = relative(directory, parent);
	if (isAbsolute(suffix) || suffix === ".." || suffix.startsWith(`..${sep}`))
		throw new Error("Resource reservation escaped its cache");
	try {
		const stat = await lstat(file);
		if (!stat.isFile() || stat.isSymbolicLink())
			throw new Error("Resource reservation requires a regular cache file");
		return await realpath(file);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return join(parent, basename(file));
	}
}

/** One activation's resource children and writer reservations; no process-global ledger. */
export class PluginResourceManager {
	private readonly entries = new Map<string, ResourceEntry>();
	private readonly handles = new Map<string, ResourceEntry>();
	private readonly activeKeys = new Map<string, string>();
	private readonly reservations: PluginResourceReservations;
	private stopped = false;
	private closing: Promise<void> | undefined;
	constructor(private readonly options: PluginResourceManagerOptions) {
		this.reservations = new PluginResourceReservations(options.leaseDirectory);
	}

	private check(context: PluginCapabilityContext): void {
		context.signal.throwIfAborted();
		this.options.signal.throwIfAborted();
		if (this.stopped) throw new Error("Plugin resource owner is stopping");
		if (context.pluginId !== this.options.pluginId || context.applicationId !== this.options.applicationId)
			throw new Error("Plugin resource belongs to another activation");
	}

	async create(input: ResourceInput, context: PluginCapabilityContext): Promise<{ handle: string }> {
		this.check(context);
		const entrypoint = Object.hasOwn(this.options.entries, input.resource)
			? this.options.entries[input.resource]
			: undefined;
		if (!entrypoint) throw new Error("Plugin resource is not declared");
		const storageDirectory = await this.options.files.storageDirectory(
			input.storage,
			input.resource,
			context,
		);
		const canonicalKeys = await Promise.all(
			input.reservation.roots.map(
				async (root) => `${root.kind}:${await this.options.files.reservationPath(root, context)}`,
			),
		);
		canonicalKeys.push(
			`${input.reservation.storage.kind}:${await storageIdentity(storageDirectory, input.reservation.storage.path)}`,
		);
		const exclusiveKeys = canonicalKeys.map((key) => `${input.reservation.namespace}:${key}`).sort();
		this.check(context);
		const key = JSON.stringify([input.resource, storageDirectory]);
		const parameters = JSON.stringify([input.parameters, exclusiveKeys]);
		let entry = this.entries.get(key);
		if (entry) {
			if (entry.closing) throw new Error("Plugin resource is closing");
			if (entry.parameters !== parameters)
				throw new Error("Plugin resource is already active with different parameters");
		} else {
			for (const exclusive of exclusiveKeys)
				if (this.activeKeys.has(exclusive))
					throw new Error("Another resource in this owner already holds this writer reservation");
			this.reservations.reserve(input.reservation.namespace, canonicalKeys);
			const handle = randomUUID();
			for (const exclusive of exclusiveKeys) this.activeKeys.set(exclusive, handle);
			const ready = createProcessPluginRuntime({
				pluginId: this.options.pluginId,
				packageRoot: this.options.packageRoot,
				entrypoint,
				runtimeDirectory: this.options.runtimeDirectory,
				resource: { storageDirectory, parameters: input.parameters },
			})({
				applicationId: this.options.applicationId,
				signal: this.options.signal,
				resources: [],
				capabilities: context.capabilities,
				events: this.options.events,
			});
			entry = { key, handle, parameters, exclusiveKeys, ready, pending: new Set() };
			this.entries.set(key, entry);
			this.handles.set(handle, entry);
		}
		try {
			await entry.ready;
		} catch (error) {
			this.forget(entry);
			throw error;
		}
		this.check(context);
		if (entry.closing) throw new Error("Plugin resource is closing");
		return { handle: entry.handle };
	}

	async invoke(
		input: { handle: string; operation: string; input: unknown },
		context: PluginCapabilityContext,
	): Promise<unknown> {
		this.check(context);
		const entry = this.handles.get(input.handle);
		if (!entry) throw new Error("Plugin resource handle was not granted");
		const runtime = await entry.ready;
		this.check(context);
		if (entry.closing) throw new Error("Plugin resource is closing");
		const request = runtime.operations.request;
		if (!request) throw new Error("Resource process did not declare its request operation");
		const operation = Promise.resolve().then(() =>
			request.execute({ operation: input.operation, input: input.input }, context),
		);
		entry.pending.add(operation);
		try {
			const result = await operation;
			this.check(context);
			return result;
		} finally {
			entry.pending.delete(operation);
		}
	}

	async close(input: { handle: string }, context: PluginCapabilityContext): Promise<null> {
		this.check(context);
		const entry = this.handles.get(input.handle);
		if (!entry) throw new Error("Plugin resource handle was not granted");
		await this.closeEntry(entry);
		this.check(context);
		return null;
	}

	private forget(entry: ResourceEntry): void {
		if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
		this.handles.delete(entry.handle);
		for (const key of entry.exclusiveKeys)
			if (this.activeKeys.get(key) === entry.handle) this.activeKeys.delete(key);
	}

	private closeEntry(entry: ResourceEntry): Promise<void> {
		if (entry.closing) return entry.closing;
		entry.closing = Promise.resolve().then(async () => {
			try {
				const runtime = await entry.ready;
				await Promise.allSettled([...entry.pending]);
				// Both startup rejection and dispose settle only after the actual child exits.
				await runtime.dispose();
			} finally {
				this.forget(entry);
			}
		});
		return entry.closing;
	}

	dispose(): Promise<void> {
		if (this.closing) return this.closing;
		this.stopped = true;
		this.closing = (async () => {
			const results = await Promise.allSettled(
				[...this.entries.values()].map((entry) => this.closeEntry(entry)),
			);
			results.push(
				...(await Promise.allSettled([Promise.resolve().then(() => this.reservations.dispose())])),
			);
			const failures = results.filter((result) => result.status === "rejected");
			if (failures.length)
				throw new AggregateError(
					failures.map((result) => result.reason),
					"Plugin resource disposal failed",
				);
		})();
		return this.closing;
	}

	handlers(): Readonly<Record<string, PluginCapabilityHandler>> {
		return {
			"resource.create": {
				inputSchema: createSchema,
				resultSchema: Type.Object({ handle: Type.String() }),
				effect: "read",
				execute: (input, context) => this.create(input as ResourceInput, context),
			},
			"resource.invoke": {
				inputSchema: Type.Object(
					{ handle: Type.String(), operation: Type.String(), input: Type.Unknown() },
					{ additionalProperties: false },
				),
				resultSchema: Type.Unknown(),
				effect: "read",
				execute: (input, context) =>
					this.invoke(input as { handle: string; operation: string; input: unknown }, context),
			},
			"resource.dispose": {
				inputSchema: Type.Object({ handle: Type.String() }, { additionalProperties: false }),
				resultSchema: Type.Null(),
				effect: "read",
				execute: (input, context) => this.close(input as { handle: string }, context),
			},
		};
	}
}
