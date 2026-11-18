import type { Stats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { PluginResourceReservations } from "@gyoungwe/plugin-api/node/reservations";
import type { PluginFileCall, PluginFileInput, PluginRootGrant } from "./file-capabilities";

type Root = PluginRootGrant & { readonly identity: Stats };

export function grantRoot(
	roots: ReadonlyMap<string, Root>,
	input: PluginFileInput,
	call: PluginFileCall,
	expected: Root["kind"],
): Root {
	call.signal.throwIfAborted();
	const root = roots.get(input.root);
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

export async function checkRoot(root: Root): Promise<void> {
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

export async function resolveRootPath(root: Root, relativePath: string): Promise<string> {
	await checkRoot(root);
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

export async function reservationPath(
	roots: ReadonlyMap<string, Root>,
	input: PluginFileInput,
	call: PluginFileCall,
): Promise<string> {
	const registered = roots.get(input.root);
	if (!registered) throw new Error("Plugin root capability was not granted");
	const root = grantRoot(roots, input, call, registered.kind);
	const result = await resolveRootPath(root, input.path);
	call.signal.throwIfAborted();
	return result;
}

export async function reserveState(
	roots: ReadonlyMap<string, Root>,
	reservations: PluginResourceReservations,
	input: PluginFileInput,
	call: PluginFileCall,
): Promise<{ reserved: true }> {
	const registered = roots.get(input.root);
	if (!registered || (registered.kind !== "state" && registered.kind !== "binary-state"))
		throw new Error("Plugin state writer access was not granted");
	const root = grantRoot(roots, input, call, registered.kind);
	if (call.bootstrap || !(root.stateWrite || root.binaryStateWrite))
		throw new Error("Plugin state writer access was not granted");
	const directory = await resolveRootPath(root, input.path);
	if (!(await lstat(directory)).isDirectory()) throw new Error("State writer requires an existing directory");
	call.signal.throwIfAborted();
	reservations.reserve("state-writers", [directory]);
	return { reserved: true };
}

export function assertCleanupComplete(cleanupFailure: unknown): void {
	if (cleanupFailure)
		throw new Error("Plugin file cleanup failed; writer reservations retained", {
			cause: cleanupFailure,
		});
}
