import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { PluginRuntimeScope } from "@gyoungwe/plugin-api/runtime";
import { Type } from "typebox";
import { JsonStoreCorruptedError } from "../json-store";
import type { PluginCapabilityHandler } from "./runtime-capabilities";

export interface PluginRootGrant {
	readonly handle: string;
	/** Selected and authorized by the host; never supplied in a capability request. */
	readonly path: string;
	readonly kind: "state" | "files";
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

/** Read ports for one authorized activation. No OS path or caller identity is accepted from the plugin. */
export class PluginFileCapabilities {
	private constructor(
		private readonly roots: ReadonlyMap<string, Root>,
		private readonly cacheRoot: { path: string; identity: Stats },
	) {}

	static async create(
		grants: readonly PluginRootGrant[],
		privateCacheDirectory: string,
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
			roots.set(grant.handle, { ...grant, path, identity });
		}
		return new PluginFileCapabilities(roots, { path: cachePath, identity: cacheIdentity });
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

	async readText(input: PluginFileInput, call: PluginFileCall) {
		const root = this.grant(input, call, "files");
		const result = await this.snapshot(root, input);
		call.signal.throwIfAborted();
		return result;
	}

	async readJson(
		input: PluginFileInput,
		call: PluginFileCall,
	): Promise<{ kind: "missing" } | { kind: "value"; value: unknown }> {
		const root = this.grant(input, call, "state");
		// Missing state is allowed; a revoked/replaced root is never missing configuration.
		await this.checkRoot(root);
		let text: string;
		try {
			text = (await this.snapshot(root, input)).text;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			await this.checkRoot(root);
			call.signal.throwIfAborted();
			return { kind: "missing" };
		}
		call.signal.throwIfAborted();
		try {
			return { kind: "value", value: JSON.parse(text.replace(/^\uFEFF/, "")) };
		} catch (error) {
			// Preserve JsonStore corruption semantics; this read port never rewrites a broken file.
			throw new JsonStoreCorruptedError(join(root.path, input.path), error);
		}
	}

	async list(input: PluginFileInput, call: PluginFileCall) {
		const root = this.grant(input, call, "files");
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
	return {
		"roots.resolve": {
			inputSchema: Type.Object(
				{ path: Type.String(), kind: Type.Union([Type.Literal("state"), Type.Literal("files")]) },
				{ additionalProperties: false },
			),
			resultSchema: Type.Object({ handle: Type.String() }),
			effect: "read",
			bootstrap: true,
			execute: (input, call) => ports.resolveRoot(input as { path: string; kind: Root["kind"] }, call),
		},
		"state.readJson": {
			inputSchema: input,
			resultSchema: Type.Union([
				Type.Object({ kind: Type.Literal("missing") }),
				Type.Object({ kind: Type.Literal("value"), value: Type.Unknown() }),
			]),
			effect: "read",
			bootstrap: true,
			execute: (input, call) => ports.readJson(input as PluginFileInput, call),
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
