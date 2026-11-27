import { createHash, randomUUID } from "node:crypto";
import { link, lstat, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Type } from "typebox";
import type { PluginFileCall, PluginFileCapabilities } from "./file-capabilities";
import { resolveRootPath } from "./plugin-root-checks";
import type { PluginCapabilityHandler } from "./runtime-capabilities";

const INDEX_PATH = "results/index.json";
const MAX_INDEX_BYTES = 1024 * 1024;
const purposes = ["input", "draft", "intermediate", "deliverable", "evidence"] as const;

export interface PluginFileIndexEntry {
	readonly artifactId: string;
	readonly sourcePath: string;
	readonly resultPath: string;
	readonly sha256: string;
	readonly bytes: number;
	readonly purpose: (typeof purposes)[number];
}

export interface PluginFileIndexInput {
	readonly root: string;
	readonly entries: readonly PluginFileIndexEntry[];
	readonly expectedHash: string | null;
}

type Root = Parameters<typeof resolveRootPath>[0];
type CurrentIndex = { readonly sha256: string } | null;

function validatePath(value: string, field: "sourcePath" | "resultPath"): void {
	if (
		value.startsWith("/") ||
		value.includes("\\") ||
		value.split("/").some((part) => !part || part === "." || part === ".." || part === ".drone")
	) {
		throw new Error(`Plugin index ${field} must be a safe root-relative path`);
	}
	if (field === "resultPath" && !value.startsWith("results/"))
		throw new Error("Plugin index resultPath must start with results/");
}

function validateEntries(entries: readonly PluginFileIndexEntry[]): void {
	const artifactIds = new Set<string>();
	const resultPaths = new Set<string>();
	for (const entry of entries) {
		validatePath(entry.sourcePath, "sourcePath");
		validatePath(entry.resultPath, "resultPath");
		if (artifactIds.has(entry.artifactId)) throw new Error("Plugin index artifactId values must be unique");
		if (resultPaths.has(entry.resultPath)) throw new Error("Plugin index resultPath values must be unique");
		artifactIds.add(entry.artifactId);
		resultPaths.add(entry.resultPath);
	}
}

async function indexDirectory(root: Root) {
	const directory = await resolveRootPath(root, "results");
	const identity = await lstat(directory);
	if (!identity.isDirectory()) throw new Error("Plugin index parent must be an existing directory");
	return { directory, identity };
}

export async function writeIndexWithinRoot(
	root: Root,
	input: PluginFileIndexInput,
	call: PluginFileCall,
	readCurrent: () => Promise<CurrentIndex>,
	cleanupFailed: (error: unknown) => void,
): Promise<{ written: true; sha256: string; bytes: number; entries: number }> {
	validateEntries(input.entries);
	const serialized = `${JSON.stringify(input.entries, null, 2)}\n`;
	const bytes = Buffer.byteLength(serialized);
	if (bytes > MAX_INDEX_BYTES) throw new Error("Plugin index write exceeds the 1 MiB limit");
	const parent = await indexDirectory(root);
	const target = join(parent.directory, basename(INDEX_PATH));
	const check = async () => {
		const currentParent = await indexDirectory(root);
		if (
			currentParent.directory !== parent.directory ||
			currentParent.identity.dev !== parent.identity.dev ||
			currentParent.identity.ino !== parent.identity.ino
		)
			throw new Error("Plugin index parent changed during write");
		if (((await readCurrent())?.sha256 ?? null) !== input.expectedHash)
			throw new Error("Plugin index version conflict; reread before writing");
		call.signal.throwIfAborted();
	};
	await check();
	const mode = input.expectedHash === null ? 0o600 : (await lstat(target)).mode & 0o777;
	const temporary = join(parent.directory, `.${basename(target)}.${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, serialized, { flag: "wx", mode });
		await check();
		if (input.expectedHash === null) await link(temporary, target);
		else await rename(temporary, target);
	} catch (error) {
		const [cleanup] = await Promise.allSettled([rm(temporary, { force: true })]);
		if (cleanup.status === "rejected") {
			cleanupFailed(cleanup.reason);
			throw new AggregateError([error, cleanup.reason], "Index write and temporary cleanup failed");
		}
		throw error;
	}
	await rm(temporary, { force: true }).catch((error) => {
		cleanupFailed(error);
		throw error;
	});
	const sha256 = createHash("sha256").update(serialized).digest("hex");
	if ((await readCurrent())?.sha256 !== sha256) throw new Error("Plugin index changed after atomic write");
	call.signal.throwIfAborted();
	return { written: true, sha256, bytes, entries: input.entries.length };
}

export function fileIndexCapabilityHandler(
	ports: Pick<PluginFileCapabilities, "writeIndex">,
): PluginCapabilityHandler {
	const entry = Type.Object(
		{
			artifactId: Type.String({ minLength: 1 }),
			sourcePath: Type.String({ minLength: 1 }),
			resultPath: Type.String({ minLength: 1 }),
			sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
			bytes: Type.Integer({ minimum: 0 }),
			purpose: Type.Union(purposes.map((purpose) => Type.Literal(purpose))),
		},
		{ additionalProperties: false },
	);
	return {
		inputSchema: Type.Object(
			{
				root: Type.String({ minLength: 1 }),
				entries: Type.Array(entry),
				expectedHash: Type.Union([Type.Null(), Type.String({ pattern: "^[a-f0-9]{64}$" })]),
			},
			{ additionalProperties: false },
		),
		resultSchema: Type.Object(
			{
				written: Type.Literal(true),
				sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
				bytes: Type.Integer({ minimum: 0 }),
				entries: Type.Integer({ minimum: 0 }),
			},
			{ additionalProperties: false },
		),
		effect: "write",
		approval: "always",
		execute: (input, call) => ports.writeIndex(input as PluginFileIndexInput, call),
	};
}
