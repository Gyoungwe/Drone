import { createHash, randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import {
	MAX_BINARY_BASE64,
	readBinaryStateFile,
	writeBinaryStateFile,
} from "@gyoungwe/plugin-api/node/binary-state";
import { PluginResourceReservations } from "@gyoungwe/plugin-api/node/reservations";
import type {
	PluginBinaryStateReadResult,
	PluginBinaryStateWriteInput,
	PluginRuntimeRootDescription,
	PluginRuntimeScope,
	PluginStateReadResult,
	PluginStateRemoveInput,
	PluginStateWriteInput,
} from "@gyoungwe/plugin-api/runtime";
import { Type } from "typebox";
import { JsonStore, JsonStoreCorruptedError } from "../json-store";
import type { StorageRegistry } from "../storage/registry";
import type { PluginCapabilityHandler } from "./runtime-capabilities";
import { MAX_FILE_BINARY_BASE64, MAX_FILE_BINARY_BYTES, readStableFileBytes } from "./stable-file-bytes";

export interface PluginRootGrant {
	readonly handle: string;
	/** Selected and authorized by the host; never supplied in a capability request. */
	readonly path: string;
	readonly kind: "state" | "files" | "binary-state";
	/** A separate host-approved JSON write grant. Read-only selections omit this entirely. */
	/** Selected independently from read-only data access; never inferred from stored paths. */
	readonly fileWrite?: true;
	readonly binaryStateWrite?: { readonly registry: StorageRegistry; readonly storageId: string };
	readonly stateWrite?: { readonly registry: StorageRegistry; readonly storageId: string };
	readonly scope:
		| { readonly kind: "application" }
		| { readonly kind: "workspace"; readonly workspaceId: string };
}

export interface PluginFileCall {
	readonly scope: PluginRuntimeScope;
	readonly signal: AbortSignal;
	readonly bootstrap: boolean;
}

export interface PluginFileInput {
	readonly root: string;
	readonly path: string;
}

export interface PluginFileVersion {
	readonly dev: number;
	readonly ino: number;
	readonly size: number;
	readonly mtimeMs: number;
	readonly ctimeMs: number;
}

export class PluginStateConflictError extends Error {
	readonly code = "ESTATECONFLICT";
	constructor() {
		super("Plugin state version conflict; read current state before writing");
	}
}

type FileKind = "file" | "directory" | "symlink" | "other";
type Root = PluginRootGrant & { readonly identity: Stats };
const MAX_TEXT_BYTES = 1024 * 1024;

function version(stat: Stats): PluginFileVersion {
	return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}

function sameFile(left: PluginFileVersion, right: PluginFileVersion): boolean {
	return (
		left.dev === right.dev &&
		left.ino === right.ino &&
		left.size === right.size &&
		left.mtimeMs === right.mtimeMs &&
		left.ctimeMs === right.ctimeMs
	);
}

function kind(stat: Pick<Stats, "isFile" | "isDirectory" | "isSymbolicLink">): FileKind {
	if (stat.isFile()) return "file";
	if (stat.isDirectory()) return "directory";
	if (stat.isSymbolicLink()) return "symlink";
	return "other";
}

/** File/state ports for one authorized activation. No OS path or caller identity is accepted from the plugin. */
export class PluginFileCapabilities {
	private mutationTail: Promise<void> = Promise.resolve();
	private cleanupFailure: unknown;
	private constructor(
		private readonly roots: ReadonlyMap<string, Root>,
		private readonly cacheRoot: { path: string; identity: Stats },
		private readonly reservations: PluginResourceReservations,
	) {}

	static async create(
		grants: readonly PluginRootGrant[],
		privateCacheDirectory: string,
		/** Internal test seam; production shares the default same-user lease namespace with native Pi. */
		leaseDirectory?: string,
	): Promise<PluginFileCapabilities> {
		// This directory belongs to the host profile, not a user-selected state/Vault root.
		// Resource children receive only individual leaves and cannot replace this parent.
		const cachePath = await realpath(privateCacheDirectory);
		const cacheIdentity = await lstat(cachePath);
		if (!cacheIdentity.isDirectory()) throw new Error("Plugin cache root must be a private host directory");
		const roots = new Map<string, Root>();
		for (const grant of grants) {
			if (roots.has(grant.handle)) throw new Error("Duplicate plugin root handle");
			const path = await realpath(grant.path);
			const identity = await lstat(path);
			if (!identity.isDirectory()) throw new Error("Plugin root must be a directory");
			if (grant.stateWrite) {
				const entry = grant.stateWrite.registry.assertRegistered(grant.stateWrite.storageId);
				if (grant.kind !== "state" || (await realpath(entry.path)) !== path)
					throw new Error("State write grant must match its registered state root");
			}
			if (grant.binaryStateWrite) {
				const entry = grant.binaryStateWrite.registry.assertRegistered(grant.binaryStateWrite.storageId);
				if (grant.kind !== "binary-state" || (await realpath(entry.path)) !== path)
					throw new Error("Binary state write grant must match its registered binary root");
			}
			roots.set(grant.handle, { ...grant, path, identity });
		}
		return new PluginFileCapabilities(
			roots,
			{ path: cachePath, identity: cacheIdentity },
			new PluginResourceReservations(leaseDirectory),
		);
	}

	private grant(input: PluginFileInput, call: PluginFileCall, expected: Root["kind"]): Root {
		call.signal.throwIfAborted();
		const root = this.roots.get(input.root);
		if (!root || root.kind !== expected) throw new Error("Plugin root capability was not granted");
		if (call.bootstrap && root.kind !== "state") throw new Error("Bootstrap may only read approved state");
		if (
			root.scope.kind === "workspace" &&
			(call.scope.kind === "application" || call.scope.workspaceId !== root.scope.workspaceId)
		) {
			throw new Error("Plugin root belongs to another workspace");
		}
		if (
			isAbsolute(input.path) ||
			input.path.includes("\\") ||
			input.path.includes("\0") ||
			(input.path !== "" && input.path.split("/").some((part) => !part || part === "." || part === ".."))
		) {
			throw new Error("Expected a root-relative path without traversal");
		}
		return root;
	}

	private async checkRoot(root: Root): Promise<void> {
		let current: Stats;
		try {
			current = await lstat(root.path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			throw new Error("Plugin root disappeared after authorization", { cause: error });
		}
		if (!current.isDirectory() || current.dev !== root.identity.dev || current.ino !== root.identity.ino) {
			throw new Error("Plugin root changed after authorization");
		}
	}

	private async path(root: Root, relativePath: string): Promise<string> {
		await this.checkRoot(root);
		let path = root.path;
		for (const part of relativePath === "" ? [] : relativePath.split("/")) {
			path = join(path, part);
			if ((await lstat(path)).isSymbolicLink()) throw new Error("Plugin file reads do not follow symlinks");
		}
		const actual = await realpath(path);
		const suffix = relative(root.path, actual);
		if (isAbsolute(suffix) || suffix === ".." || suffix.startsWith(`..${sep}`)) {
			throw new Error("Plugin file escaped its granted root");
		}
		return actual;
	}

	private async snapshot(
		root: Root,
		input: PluginFileInput,
	): Promise<{
		text: string;
		sha256: string;
		bytes: number;
		version: PluginFileVersion;
	}> {
		const path = await this.path(root, input.path);
		const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const before = await file.stat();
			if (!before.isFile()) throw new Error("Plugin text read requires a regular file");
			if (before.size > MAX_TEXT_BYTES) throw new Error("Plugin text read exceeds the 1 MiB limit");
			const buffer = Buffer.alloc(before.size + 1);
			let offset = 0;
			while (offset < buffer.length) {
				const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
				if (!bytesRead) break;
				offset += bytesRead;
			}
			const after = await file.stat();
			const current = await lstat(await this.path(root, input.path));
			if (!sameFile(before, after) || !sameFile(after, current) || offset !== before.size) {
				throw new Error("Plugin file changed during read");
			}
			return {
				text: buffer.subarray(0, offset).toString("utf8"),
				sha256: createHash("sha256").update(buffer.subarray(0, offset)).digest("hex"),
				bytes: offset,
				version: version(after),
			};
		} finally {
			await file.close();
		}
	}

	/** Resolve an existing approval; a path from plugin state never creates a new grant. */
	async resolveRoot(input: { path: string; kind: Root["kind"] }, call: PluginFileCall) {
		const root = [...this.roots.values()].find(
			(root) => root.path === input.path && root.kind === input.kind,
		);
		if (!root) throw new Error("Plugin root path was not granted");
		this.grant({ root: root.handle, path: "" }, call, root.kind);
		await this.checkRoot(root);
		call.signal.throwIfAborted();
		return { handle: root.handle };
	}

	/** Only the private host cache is writable; state.root contributes identity and authorization. */
	async storageDirectory(input: { root: string; key: string }, resourceId: string, call: PluginFileCall) {
		const root = this.grant({ root: input.root, path: "" }, call, "state");
		await this.checkRoot(root);
		const key = createHash("sha256")
			.update(JSON.stringify([root.path, resourceId, input.key]))
			.digest("hex");
		const cache = this.cacheRoot;
		const current = await lstat(cache.path);
		if (!current.isDirectory() || current.dev !== cache.identity.dev || current.ino !== cache.identity.ino)
			throw new Error("Private plugin cache root changed");
		const directory = join(cache.path, key);
		try {
			await mkdir(directory, { mode: 0o700 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
		const target = await lstat(directory);
		if (!target.isDirectory() || target.isSymbolicLink())
			throw new Error("Plugin resource cache must be a real directory");
		const actual = await realpath(directory);
		if (actual !== directory) throw new Error("Plugin resource cache escaped the private directory");
		call.signal.throwIfAborted();
		return actual;
	}

	/** Canonical identity for a resource reservation inside an already approved root. */
	async reservationPath(input: PluginFileInput, call: PluginFileCall): Promise<string> {
		const registered = this.roots.get(input.root);
		if (!registered) throw new Error("Plugin root capability was not granted");
		const root = this.grant(input, call, registered.kind);
		const result = await this.path(root, input.path);
		call.signal.throwIfAborted();
		return result;
	}

	/** Describe this activation's approved roots only, without authorizing any new path. */
	async describeRoots(call: PluginFileCall): Promise<readonly PluginRuntimeRootDescription[]> {
		call.signal.throwIfAborted();
		const descriptions: PluginRuntimeRootDescription[] = [];
		for (const root of this.roots.values()) {
			if (call.bootstrap && root.kind !== "state") continue;
			if (
				root.scope.kind === "workspace" &&
				(call.scope.kind === "application" || root.scope.workspaceId !== call.scope.workspaceId)
			)
				continue;
			await this.checkRoot(root);
			descriptions.push({
				handle: root.handle,
				kind: root.kind,
				path: root.path,
				access: root.stateWrite || root.binaryStateWrite || root.fileWrite ? "read-write" : "read",
			});
		}
		call.signal.throwIfAborted();
		return descriptions;
	}

	/** Reserve an already approved JSON state directory, without creating a resource process. */
	reserveState(input: PluginFileInput, call: PluginFileCall): Promise<{ reserved: true }> {
		return this.mutate(call, async () => {
			const registered = this.roots.get(input.root);
			if (!registered || (registered.kind !== "state" && registered.kind !== "binary-state"))
				throw new Error("Plugin state writer access was not granted");
			const root = this.grant(input, call, registered.kind);
			if (call.bootstrap || !(root.stateWrite || root.binaryStateWrite))
				throw new Error("Plugin state writer access was not granted");
			const directory = await this.path(root, input.path);
			if (!(await lstat(directory)).isDirectory())
				throw new Error("State writer requires an existing directory");
			call.signal.throwIfAborted();
			this.reservations.reserve("state-writers", [directory]);
			return { reserved: true };
		});
	}

	/** Drain accepted filesystem mutations and prove cleanup before any activation lease is released. */
	async drain(): Promise<void> {
		await this.mutationTail;
		this.assertCleanupComplete();
	}

	private assertCleanupComplete(): void {
		if (this.cleanupFailure)
			throw new Error("Plugin file cleanup failed; writer reservations retained", {
				cause: this.cleanupFailure,
			});
	}

	/** Host final-release hook; call only after successful domain and resource cleanup. */
	releaseReservations(): void {
		this.assertCleanupComplete();
		this.reservations.dispose();
	}

	async readBinary(input: PluginFileInput, call: PluginFileCall): Promise<PluginBinaryStateReadResult> {
		const root = this.grant(input, call, "binary-state");
		const result = await readBinaryStateFile(input.path, {
			resolvePath: (path) => this.path(root, path),
			checkRoot: () => this.checkRoot(root),
		});
		call.signal.throwIfAborted();
		return result;
	}
	writeBinary(
		input: PluginBinaryStateWriteInput,
		call: PluginFileCall,
	): Promise<PluginBinaryStateReadResult> {
		return writeBinaryStateFile(input, {
			signal: call.signal,
			serialize: (operation) => this.mutate(call, operation),
			prepare: () => {
				const root = this.grant(input, call, "binary-state");
				if (call.bootstrap || !root.binaryStateWrite)
					throw new Error("Binary state write access was not granted");
				const writeGrant = root.binaryStateWrite;
				if (!input.path) throw new Error("Binary state requires a child path");
				for (const path of input.assertAbsent) {
					this.grant({ root: input.root, path }, call, "binary-state");
					if (!path || path === input.path)
						throw new Error("Binary absence conditions must name other child paths");
				}
				return {
					resolvePath: (path) => this.path(root, path),
					checkRoot: () => this.checkRoot(root),
					checkWrite: async () => {
						this.grant(input, call, "binary-state");
						const entry = writeGrant.registry.assertRegistered(writeGrant.storageId);
						if ((await realpath(entry.path)) !== root.path)
							throw new Error("Registered binary state root changed");
					},
					assertReserved: (parent) => this.reservations.assertReserved("state-writers", parent),
					conflictError: () => new PluginStateConflictError(),
					cleanupFailed: (error) => {
						this.cleanupFailure = error;
					},
				};
			},
		});
	}

	async readFileBinary(input: PluginFileInput, call: PluginFileCall) {
		const root = this.grant(input, call, "files");
		return readStableFileBytes(() => this.path(root, input.path), call.signal);
	}

	async readText(input: PluginFileInput, call: PluginFileCall) {
		const root = this.grant(input, call, "files");
		const result = await this.snapshot(root, input);
		call.signal.throwIfAborted();
		return result;
	}

	private mutate<T>(call: PluginFileCall, execute: () => Promise<T>): Promise<T> {
		// One activation queue also covers case-insensitive names and overlapping granted roots.
		const pending = this.mutationTail.then(() => {
			call.signal.throwIfAborted();
			return execute();
		});
		// Errors stay on the caller's promise; the settled tail lets later approved work proceed.
		this.mutationTail = pending.then(
			() => {},
			() => {},
		);
		return pending;
	}

	private mutateFile<T>(
		input: PluginFileInput,
		call: PluginFileCall,
		execute: (root: Root) => Promise<T>,
	): Promise<T> {
		return this.mutate(call, () => {
			const root = this.grant(input, call, "files");
			if (call.bootstrap || !root.fileWrite) throw new Error("Plugin data write access was not granted");
			if (!input.path) throw new Error("Data mutation requires a child path");
			return execute(root);
		});
	}

	private async currentText(root: Root, input: PluginFileInput) {
		try {
			return await this.snapshot(root, input);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			await this.checkRoot(root);
			return null;
		}
	}

	async writeText(
		input: PluginFileInput & { text: string; expectedHash: string | null },
		call: PluginFileCall,
	) {
		if (/\.json[cl]?$/i.test(input.path))
			throw new Error("JSON persistence requires a JSON state capability");
		if (Buffer.byteLength(input.text) > MAX_TEXT_BYTES)
			throw new Error("Plugin text write exceeds the 1 MiB limit");
		return this.mutateFile(input, call, async (root) => {
			const parentRelative = dirname(input.path) === "." ? "" : dirname(input.path);
			const parent = await this.path(root, parentRelative);
			const identity = await lstat(parent);
			const target = join(root.path, input.path);
			const check = async () => {
				const currentParent = await lstat(await this.path(root, parentRelative));
				if (currentParent.dev !== identity.dev || currentParent.ino !== identity.ino)
					throw new Error("Plugin data parent changed during write");
				const current = await this.currentText(root, input);
				if ((current?.sha256 ?? null) !== input.expectedHash)
					throw new Error("Plugin file version conflict; reread before writing");
				call.signal.throwIfAborted();
			};
			await check();
			const mode = input.expectedHash === null ? 0o600 : (await lstat(target)).mode & 0o777;
			const temporary = join(parent, `.${basename(target)}.${randomUUID()}.tmp`);
			try {
				await writeFile(temporary, input.text, { flag: "wx", mode });
				await check();
				if (input.expectedHash === null) await link(temporary, target);
				else await rename(temporary, target);
			} catch (error) {
				const [cleanup] = await Promise.allSettled([rm(temporary, { force: true })]);
				if (cleanup.status === "rejected") {
					this.cleanupFailure = cleanup.reason;
					throw new AggregateError([error, cleanup.reason], "Text write and temporary cleanup failed");
				}
				throw error;
			}
			await rm(temporary, { force: true }).catch((error) => {
				this.cleanupFailure = error;
				throw error;
			});
			const result = await this.snapshot(root, input);
			if (result.sha256 !== createHash("sha256").update(input.text).digest("hex"))
				throw new Error("Plugin data changed after atomic write");
			call.signal.throwIfAborted();
			return result;
		});
	}

	async removeText(input: PluginFileInput & { expectedHash: string }, call: PluginFileCall) {
		if (/\.json[cl]?$/i.test(input.path)) throw new Error("JSON removal requires a JSON state capability");
		return this.mutateFile(input, call, async (root) => {
			const current = await this.snapshot(root, input);
			if (current.sha256 !== input.expectedHash)
				throw new Error("Plugin file version conflict; reread before removing");
			call.signal.throwIfAborted();
			await rm(join(root.path, input.path));
			if (await this.currentText(root, input)) throw new Error("Plugin data reappeared after removal");
			call.signal.throwIfAborted();
			return { removed: true };
		});
	}

	async ensureFileDirectory(input: PluginFileInput, call: PluginFileCall): Promise<{ created: boolean }> {
		return this.mutateFile(input, call, (root) => this.ensureDirectory(root, input, call));
	}

	async readJson(input: PluginFileInput, call: PluginFileCall): Promise<PluginStateReadResult> {
		const root = this.grant(input, call, "state");
		// Missing state is allowed; a revoked/replaced root is never missing configuration.
		await this.checkRoot(root);
		let snapshot: Awaited<ReturnType<PluginFileCapabilities["snapshot"]>>;
		try {
			snapshot = await this.snapshot(root, input);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			await this.checkRoot(root);
			call.signal.throwIfAborted();
			return { kind: "missing", version: null };
		}
		call.signal.throwIfAborted();
		try {
			return {
				kind: "value",
				value: JSON.parse(snapshot.text.replace(/^\uFEFF/, "")),
				version: snapshot.sha256,
			};
		} catch (error) {
			// Preserve JsonStore corruption semantics; this read port never rewrites a broken file.
			throw new JsonStoreCorruptedError(join(root.path, input.path), error);
		}
	}

	writeJson(input: PluginStateWriteInput, call: PluginFileCall): Promise<PluginStateReadResult> {
		return this.mutate(call, () => this.writeJsonNow(input, call));
	}

	private async writeJsonNow(
		input: PluginStateWriteInput,
		call: PluginFileCall,
	): Promise<PluginStateReadResult> {
		const root = this.grant(input, call, "state");
		if (call.bootstrap || !root.stateWrite) throw new Error("Plugin state JSON write access was not granted");
		if (!input.path.endsWith(".json")) throw new Error("State writes require a .json file");
		const serialized = `${JSON.stringify(input.value, null, 2)}\n`;
		if (Buffer.byteLength(serialized) > MAX_TEXT_BYTES)
			throw new Error("Plugin state write exceeds the 1 MiB limit");
		const parentRelative = dirname(input.path) === "." ? "" : dirname(input.path);
		const parent = await this.path(root, parentRelative);
		const parentIdentity = await lstat(parent);
		if (!parentIdentity.isDirectory()) throw new Error("State write parent must be an existing directory");
		const target = join(root.path, input.path);
		const check = async () => {
			this.grant(input, call, "state");
			const currentParent = await lstat(await this.path(root, parentRelative));
			if (currentParent.dev !== parentIdentity.dev || currentParent.ino !== parentIdentity.ino)
				throw new Error("Plugin state parent changed after authorization");
			const current = await this.readJson(input, call);
			if (current.version !== input.expectedVersion) throw new PluginStateConflictError();
		};
		const expectedHash = createHash("sha256").update(serialized).digest("hex");
		const store = new JsonStore<unknown>({
			path: target,
			storageId: root.stateWrite.registry.assertRegistered(root.stateWrite.storageId).id,
			defaultValue: () => null,
			mode: 0o600,
		});
		return store
			.writeChecked(input.value, {
				check,
				readBack: async () => {
					const result = await this.readJson(input, call);
					if (result.kind !== "value" || result.version !== expectedHash)
						throw new Error("Plugin state changed after atomic write");
					return result;
				},
			})
			.catch((error) => {
				if (error instanceof AggregateError) this.cleanupFailure = error;
				throw error;
			});
	}

	removeJson(input: PluginStateRemoveInput, call: PluginFileCall): Promise<PluginStateReadResult> {
		return this.mutate(call, () => this.removeJsonNow(input, call));
	}

	private async removeJsonNow(
		input: PluginStateRemoveInput,
		call: PluginFileCall,
	): Promise<PluginStateReadResult> {
		const root = this.grant(input, call, "state");
		if (call.bootstrap || !root.stateWrite) throw new Error("Plugin state JSON write access was not granted");
		if (!input.path.endsWith(".json")) throw new Error("State removal requires a .json file");
		const store = new JsonStore<unknown>({
			path: join(root.path, input.path),
			storageId: root.stateWrite.registry.assertRegistered(root.stateWrite.storageId).id,
			defaultValue: () => null,
		});
		return store.removeChecked({
			check: async () => {
				const current = await this.readJson(input, call);
				if (current.version !== input.expectedVersion) throw new PluginStateConflictError();
			},
			readBack: async () => {
				const result = await this.readJson(input, call);
				if (result.kind !== "missing") throw new Error("Plugin state reappeared after removal");
				return result;
			},
		});
	}

	/** Create one state directory after explicit write approval; reads never initialize state. */
	ensureStateDirectory(input: PluginFileInput, call: PluginFileCall): Promise<{ created: boolean }> {
		return this.mutate(call, () => this.ensureStateDirectoryNow(input, call));
	}

	private async ensureStateDirectoryNow(
		input: PluginFileInput,
		call: PluginFileCall,
	): Promise<{ created: boolean }> {
		const root = this.grant(input, call, "state");
		if (call.bootstrap || !root.stateWrite)
			throw new Error("Plugin state directory write access was not granted");
		if (!input.path) throw new Error("State directory creation requires a child path");
		return this.ensureDirectory(root, input, call);
	}

	private async ensureDirectory(
		root: Root,
		input: PluginFileInput,
		call: PluginFileCall,
	): Promise<{ created: boolean }> {
		const parentRelative = dirname(input.path) === "." ? "" : dirname(input.path);
		const parent = await this.path(root, parentRelative);
		const parentIdentity = await lstat(parent);
		call.signal.throwIfAborted();
		let created = true;
		try {
			await mkdir(join(parent, basename(input.path)), { mode: 0o700 });
		} catch (error) {
			// An existing entry is accepted only after the confined directory readback below.
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			created = false;
		}
		const currentParent = await lstat(await this.path(root, parentRelative));
		if (currentParent.dev !== parentIdentity.dev || currentParent.ino !== parentIdentity.ino)
			throw new Error("Plugin parent changed during directory creation");
		const target = await lstat(await this.path(root, input.path));
		if (!target.isDirectory()) throw new Error("Plugin entry is not a directory");
		call.signal.throwIfAborted();
		return { created };
	}

	async listState(input: PluginFileInput, call: PluginFileCall) {
		return this.listRoot(this.grant(input, call, "state"), input, call);
	}

	async list(input: PluginFileInput, call: PluginFileCall) {
		return this.listRoot(this.grant(input, call, "files"), input, call);
	}

	private async listRoot(root: Root, input: PluginFileInput, call: PluginFileCall) {
		const path = await this.path(root, input.path);
		const before = await lstat(path);
		const entries = await readdir(path, { withFileTypes: true });
		const after = await lstat(await this.path(root, input.path));
		if (!sameFile(before, after)) throw new Error("Plugin directory changed during listing");
		call.signal.throwIfAborted();
		return entries.map((entry) => ({ name: entry.name, kind: kind(entry) }));
	}

	async stat(input: PluginFileInput, call: PluginFileCall) {
		const root = this.grant(input, call, "files");
		const info = await lstat(await this.path(root, input.path));
		const current = await lstat(await this.path(root, input.path));
		if (!sameFile(info, current)) throw new Error("Plugin file changed during stat");
		call.signal.throwIfAborted();
		return { kind: kind(info), version: version(info) };
	}
}

/** Registry schema validation runs before these handlers receive plugin JSON. */
export function fileCapabilityHandlers(
	ports: PluginFileCapabilities,
): Readonly<Record<string, PluginCapabilityHandler>> {
	const input = Type.Object(
		{ root: Type.String({ minLength: 1 }), path: Type.String() },
		{ additionalProperties: false },
	);
	const fileVersion = Type.Object({
		dev: Type.Number(),
		ino: Type.Number(),
		size: Type.Number(),
		mtimeMs: Type.Number(),
		ctimeMs: Type.Number(),
	});
	const fileKind = Type.Union([
		Type.Literal("file"),
		Type.Literal("directory"),
		Type.Literal("symlink"),
		Type.Literal("other"),
	]);
	const stateVersion = Type.Union([Type.Null(), Type.String({ pattern: "^[a-f0-9]{64}$" })]);
	const stateResult = Type.Union([
		Type.Object({ kind: Type.Literal("missing"), version: Type.Null() }),
		Type.Object({
			kind: Type.Literal("value"),
			value: Type.Unknown(),
			version: Type.String({ pattern: "^[a-f0-9]{64}$" }),
		}),
	]);
	const json = Type.Cyclic(
		{
			Json: Type.Union([
				Type.Null(),
				Type.Boolean(),
				Type.Number(),
				Type.String(),
				Type.Array(Type.Ref("Json")),
				Type.Record(Type.String(), Type.Ref("Json")),
			]),
		},
		"Json",
	);
	return {
		"roots.describe": {
			inputSchema: Type.Null(),
			resultSchema: Type.Array(
				Type.Object(
					{
						handle: Type.String(),
						kind: Type.Union([Type.Literal("state"), Type.Literal("files"), Type.Literal("binary-state")]),
						path: Type.String(),
						access: Type.Union([Type.Literal("read"), Type.Literal("read-write")]),
					},
					{ additionalProperties: false },
				),
			),
			effect: "read",
			bootstrap: true,
			execute: (_input, call) => ports.describeRoots(call),
		},
		"state.readBinary": {
			inputSchema: Type.Object(
				{
					root: Type.String({ minLength: 1, maxLength: 128 }),
					path: Type.String({ minLength: 1, maxLength: 4096 }),
				},
				{ additionalProperties: false },
			),
			resultSchema: Type.Union([
				Type.Object({ kind: Type.Literal("missing"), version: Type.Null() }, { additionalProperties: false }),
				Type.Object(
					{
						kind: Type.Literal("value"),
						base64: Type.String({ maxLength: MAX_BINARY_BASE64 }),
						version: Type.String({ pattern: "^[a-f0-9]{64}$" }),
					},
					{ additionalProperties: false },
				),
			]),
			effect: "read",
			execute: (input, call) => ports.readBinary(input as PluginFileInput, call),
		},
		"state.writeBinary": {
			inputSchema: Type.Object(
				{
					root: Type.String({ minLength: 1, maxLength: 128 }),
					path: Type.String({ minLength: 1, maxLength: 4096 }),
					base64: Type.String({
						maxLength: MAX_BINARY_BASE64,
						pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
					}),
					expectedVersion: stateVersion,
					assertAbsent: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), {
						maxItems: 8,
						uniqueItems: true,
					}),
				},
				{ additionalProperties: false },
			),
			resultSchema: Type.Object(
				{
					kind: Type.Literal("value"),
					base64: Type.String({ maxLength: MAX_BINARY_BASE64 }),
					version: Type.String({ pattern: "^[a-f0-9]{64}$" }),
				},
				{ additionalProperties: false },
			),
			effect: "write",
			approval: "own",
			execute: (input, call) => ports.writeBinary(input as PluginBinaryStateWriteInput, call),
		},
		"state.reserve": {
			inputSchema: input,
			resultSchema: Type.Object({ reserved: Type.Literal(true) }),
			effect: "write",
			approval: "own",
			execute: (input, call) => ports.reserveState(input as PluginFileInput, call),
		},
		"state.list": {
			inputSchema: input,
			resultSchema: Type.Array(Type.Object({ name: Type.String(), kind: fileKind })),
			effect: "read",
			bootstrap: true,
			execute: (input, call) => ports.listState(input as PluginFileInput, call),
		},
		"state.removeJson": {
			inputSchema: Type.Object(
				{
					root: Type.String({ minLength: 1 }),
					path: Type.String({ minLength: 1 }),
					expectedVersion: Type.String({ pattern: "^[a-f0-9]{64}$" }),
				},
				{ additionalProperties: false },
			),
			resultSchema: stateResult,
			effect: "write",
			approval: "own",
			execute: (input, call) => ports.removeJson(input as PluginStateRemoveInput, call),
		},
		"state.ensureDirectory": {
			inputSchema: Type.Object(
				{ root: Type.String({ minLength: 1 }), path: Type.String({ minLength: 1 }) },
				{ additionalProperties: false },
			),
			resultSchema: Type.Object({ created: Type.Boolean() }),
			effect: "write",
			approval: "own",
			execute: (input, call) => ports.ensureStateDirectory(input as PluginFileInput, call),
		},
		"state.writeJson": {
			inputSchema: Type.Object(
				{
					root: Type.String({ minLength: 1 }),
					path: Type.String({ minLength: 1 }),
					value: json,
					expectedVersion: stateVersion,
				},
				{ additionalProperties: false },
			),
			resultSchema: stateResult,
			effect: "write",
			approval: "own",
			execute: (input, call) => ports.writeJson(input as PluginStateWriteInput, call),
		},
		"roots.resolve": {
			inputSchema: Type.Object(
				{
					path: Type.String(),
					kind: Type.Union([Type.Literal("state"), Type.Literal("files"), Type.Literal("binary-state")]),
				},
				{ additionalProperties: false },
			),
			resultSchema: Type.Object({ handle: Type.String() }),
			effect: "read",
			bootstrap: true,
			execute: (input, call) => ports.resolveRoot(input as { path: string; kind: Root["kind"] }, call),
		},
		"state.readJson": {
			inputSchema: input,
			resultSchema: stateResult,
			effect: "read",
			bootstrap: true,
			execute: (input, call) => ports.readJson(input as PluginFileInput, call),
		},
		"files.writeText": {
			inputSchema: Type.Object(
				{
					root: Type.String({ minLength: 1 }),
					path: Type.String({ minLength: 1 }),
					text: Type.String(),
					expectedHash: stateVersion,
				},
				{ additionalProperties: false },
			),
			resultSchema: Type.Object({
				text: Type.String(),
				sha256: Type.String(),
				bytes: Type.Number(),
				version: fileVersion,
			}),
			effect: "write",
			approval: "always",
			execute: (input, call) =>
				ports.writeText(input as PluginFileInput & { text: string; expectedHash: string | null }, call),
		},
		"files.remove": {
			inputSchema: Type.Object(
				{
					root: Type.String({ minLength: 1 }),
					path: Type.String({ minLength: 1 }),
					expectedHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
				},
				{ additionalProperties: false },
			),
			resultSchema: Type.Object({ removed: Type.Literal(true) }),
			effect: "write",
			approval: "always",
			execute: (input, call) => ports.removeText(input as PluginFileInput & { expectedHash: string }, call),
		},
		"files.ensureDirectory": {
			inputSchema: Type.Object(
				{ root: Type.String({ minLength: 1 }), path: Type.String({ minLength: 1 }) },
				{ additionalProperties: false },
			),
			resultSchema: Type.Object({ created: Type.Boolean() }),
			effect: "write",
			approval: "always",
			execute: (input, call) => ports.ensureFileDirectory(input as PluginFileInput, call),
		},
		"files.readBinary": {
			inputSchema: input,
			resultSchema: Type.Object(
				{
					base64: Type.String({ maxLength: MAX_FILE_BINARY_BASE64 }),
					sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
					bytes: Type.Integer({ minimum: 0, maximum: MAX_FILE_BINARY_BYTES }),
					version: fileVersion,
				},
				{ additionalProperties: false },
			),
			effect: "read",
			execute: (input, call) => ports.readFileBinary(input as PluginFileInput, call),
		},
		"files.readText": {
			inputSchema: input,
			resultSchema: Type.Object({
				text: Type.String(),
				sha256: Type.String(),
				bytes: Type.Number(),
				version: fileVersion,
			}),
			effect: "read",
			execute: (input, call) => ports.readText(input as PluginFileInput, call),
		},
		"files.list": {
			inputSchema: input,
			resultSchema: Type.Array(Type.Object({ name: Type.String(), kind: fileKind })),
			effect: "read",
			execute: (input, call) => ports.list(input as PluginFileInput, call),
		},
		"files.stat": {
			inputSchema: input,
			resultSchema: Type.Object({ kind: fileKind, version: fileVersion }),
			effect: "read",
			execute: (input, call) => ports.stat(input as PluginFileInput, call),
		},
	};
}
