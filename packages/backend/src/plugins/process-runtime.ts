import { spawn } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type { PluginRuntimeFactory } from "@gyoungwe/plugin-api/runtime";
import { pluginRuntimeExecutable } from "../plugin-runtime-executable";
import type { HostNativeRuntimeFactory } from "./p5-owner-facade";
import { RuntimeProcess } from "./process-runtime-owner";
import { PROCESS_RUNTIME_WORKER } from "./process-runtime-worker";

export interface ProcessPluginRuntimeOptions {
	readonly pluginId: string;
	readonly entrypoint: string;
	readonly packageRoot: string;
	/** Archive-verified Node runtime already shipped by the host. */
	readonly runtimeDirectory?: string;
	/** Host-selected derived-data directory, never a path supplied by worker messages. */
	readonly resource?: { readonly storageDirectory: string; readonly parameters: unknown };
}

function staysInPackage(root: string, path: string): boolean {
	const pathRelative = relative(root, path);
	return pathRelative !== ".." && !pathRelative.startsWith(`..${sep}`) && !isAbsolute(pathRelative);
}

/** Node's read permission follows data symlinks; validate every grant target before launch. */
function checkPackageLinks(root: string, directory = root): void {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isSymbolicLink() && !staysInPackage(root, realpathSync(path))) {
			throw new Error("Plugin runtime package symlink escapes its read grant");
		}
		if (entry.isDirectory()) checkPackageLinks(root, path);
	}
}

/** Only called after registry authorization. No plugin import occurs in this process. */
export function createProcessPluginRuntime(
	options: ProcessPluginRuntimeOptions & { resource: NonNullable<ProcessPluginRuntimeOptions["resource"]> },
): PluginRuntimeFactory;
export function createProcessPluginRuntime(options: ProcessPluginRuntimeOptions): HostNativeRuntimeFactory;
export function createProcessPluginRuntime(options: ProcessPluginRuntimeOptions): HostNativeRuntimeFactory {
	return async (context) => {
		context.signal.throwIfAborted();
		const executable = pluginRuntimeExecutable(options.runtimeDirectory);
		const packageRoot = realpathSync(options.packageRoot);
		const entrypoint = realpathSync(options.entrypoint);
		if (!staysInPackage(packageRoot, entrypoint)) {
			throw new Error("Plugin runtime entrypoint escapes its package");
		}
		checkPackageLinks(packageRoot);
		const child = spawn(
			executable,
			[
				"--permission",
				// Node FS permissions do not cover node:sqlite; domain code must use host capabilities.
				...(options.resource ? [] : ["--no-experimental-sqlite"]),
				`--allow-fs-read=${packageRoot}`,
				...(options.resource
					? [
							`--allow-fs-read=${options.resource.storageDirectory}`,
							`--allow-fs-write=${options.resource.storageDirectory}`,
						]
					: []),
				"--input-type=module",
				"--eval",
				PROCESS_RUNTIME_WORKER,
				entrypoint,
			],
			{
				cwd: packageRoot,
				// No inherited secrets, PATH, NODE_OPTIONS, filesystem write, network or subprocess grants.
				env: {
					NODE_ENV: "production",
					...(process.versions.electron && !options.runtimeDirectory ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
				},
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
			},
		);
		return new RuntimeProcess(options.pluginId, child, context, options.resource).start();
	};
}
