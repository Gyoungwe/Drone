import type { Stats } from "node:fs";
import { link, lstat, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type TObject, Type } from "typebox";
import type { PluginFileCapabilities, PluginFileInput, PluginFileVersion } from "./file-capabilities";
import { resolveRootPath, sameFile, version } from "./plugin-root-checks";
import type { PluginCapabilityHandler } from "./runtime-capabilities";

type Root = Parameters<typeof resolveRootPath>[0];

export interface PluginFileMoveInput {
	readonly root: string;
	readonly from: string;
	readonly to: string;
	readonly expectedVersion: PluginFileVersion;
}

async function locateFile(root: Root, relativePath: string) {
	const directory = dirname(relativePath);
	const parent = directory === "." ? "" : directory;
	const parentPath = await resolveRootPath(root, parent);
	const identity = await lstat(parentPath);
	if (!identity.isDirectory()) throw new Error("Plugin file move parent must be an existing directory");
	return { relativePath, parent, parentPath, identity, path: join(parentPath, basename(relativePath)) };
}

type Location = Awaited<ReturnType<typeof locateFile>>;

function sameInode(left: Stats, right: Stats): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}

async function checkParent(root: Root, location: Location): Promise<void> {
	const path = await resolveRootPath(root, location.parent);
	const current = await lstat(path);
	if (path !== location.parentPath || !current.isDirectory() || !sameInode(current, location.identity))
		throw new Error("Plugin file move parent changed");
}

async function inspectFile(root: Root, location: Location): Promise<Stats> {
	await resolveRootPath(root, location.relativePath);
	const stat = await lstat(location.path);
	if (!stat.isFile()) throw new Error("Plugin file move requires a regular file");
	await checkParent(root, location);
	return stat;
}

async function statIfPresent(path: string): Promise<Stats | undefined> {
	try {
		return await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return undefined;
	}
}

function verifyMovedVersion(stat: Stats, before: PluginFileVersion): PluginFileVersion {
	const current = version(stat);
	if (!sameFile(current, { ...before, ctimeMs: current.ctimeMs }))
		throw new Error("Plugin file changed during move");
	return current;
}

async function rollbackLink(root: Root, source: Location, target: Location, before: Stats): Promise<void> {
	await checkParent(root, source);
	await checkParent(root, target);
	const linked = await statIfPresent(target.path);
	if (!linked) return;
	const original = await lstat(source.path);
	if (!original.isFile() || !linked.isFile() || !sameInode(original, before) || !sameInode(linked, before))
		throw new Error("Plugin file move paths no longer identify the original link");
	await rm(target.path);
}

export async function moveFileWithinRoot(
	root: Root,
	input: Omit<PluginFileMoveInput, "root"> & { signal: AbortSignal },
): Promise<{ moved: true; version: PluginFileVersion }> {
	const source = await locateFile(root, input.from);
	const target = await locateFile(root, input.to);
	await checkParent(root, target);
	const before = await inspectFile(root, source);
	if (!sameFile(version(before), input.expectedVersion))
		throw new Error("Plugin file version conflict; reread before moving");
	input.signal.throwIfAborted();
	await link(source.path, target.path);
	try {
		const linked = await inspectFile(root, target);
		const linkedVersion = verifyMovedVersion(linked, input.expectedVersion);
		const current = await inspectFile(root, source);
		if (!sameFile(version(current), linkedVersion)) throw new Error("Plugin file changed during move");
		await rm(source.path);
	} catch (error) {
		try {
			await rollbackLink(root, source, target, before);
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				"Plugin file move failed and link cleanup was not confirmed",
			);
		}
		throw error;
	}
	await checkParent(root, source);
	if (await statIfPresent(source.path)) throw new Error("Plugin file source reappeared after move");
	const result = verifyMovedVersion(await inspectFile(root, target), input.expectedVersion);
	input.signal.throwIfAborted();
	return { moved: true, version: result };
}

export function fileMutationHandlers(ports: PluginFileCapabilities, fileVersion: TObject) {
	const expectedHash = Type.Union([Type.Null(), Type.String({ pattern: "^[a-f0-9]{64}$" })]);
	return {
		move: {
			inputSchema: Type.Object(
				{
					root: Type.String({ minLength: 1 }),
					from: Type.String({ minLength: 1 }),
					to: Type.String({ minLength: 1 }),
					expectedVersion: Type.Object(fileVersion.properties, { additionalProperties: false }),
				},
				{ additionalProperties: false },
			),
			resultSchema: Type.Object({ moved: Type.Literal(true), version: fileVersion }),
			effect: "write",
			approval: "always",
			execute: (input, call) => ports.moveFile(input as PluginFileMoveInput, call),
		},
		writeText: {
			inputSchema: Type.Object(
				{
					root: Type.String({ minLength: 1 }),
					path: Type.String({ minLength: 1 }),
					text: Type.String(),
					expectedHash,
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
		remove: {
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
		ensureDirectory: {
			inputSchema: Type.Object(
				{ root: Type.String({ minLength: 1 }), path: Type.String({ minLength: 1 }) },
				{ additionalProperties: false },
			),
			resultSchema: Type.Object({ created: Type.Boolean() }),
			effect: "write",
			approval: "always",
			execute: (input, call) => ports.ensureFileDirectory(input as PluginFileInput, call),
		},
	} satisfies Record<string, PluginCapabilityHandler>;
}
