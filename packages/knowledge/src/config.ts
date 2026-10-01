import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

export type KnowledgeProfile = "project" | "literature" | "hybrid";
export type KnowledgeDepositMode = "run-only" | "verified" | "rich";
export type KnowledgeSubagentPolicy = "none" | "read-local";

export interface KnowledgeBinding {
	version: 1;
	vault: string;
	vaultId: string;
	revision: number;
	profile: KnowledgeProfile;
	depositMode: KnowledgeDepositMode;
	subagentPolicy: KnowledgeSubagentPolicy;
	updatedAt: string;
}

export interface KnowledgeBindingInput {
	vault: string;
	profile: KnowledgeProfile;
	depositMode: KnowledgeDepositMode;
	subagentPolicy: KnowledgeSubagentPolicy;
}

export interface ReadKnowledgeBindingOptions {
	fresh?: boolean;
}

type BindingOperation<T> = () => T | Promise<T>;

const local = new AsyncLocalStorage<KnowledgeBinding>();
const queues = new Map<string, Promise<unknown>>();

function errorCode(error: unknown): unknown {
	return error && typeof error === "object" && "code" in error
		? (error as { code?: unknown }).code
		: undefined;
}

/** Resolve the host-owned application directory without silently falling back to a project path. */
export function knowledgeDirectory(): string | null {
	const value = process.env.DRONE_KNOWLEDGE_DIR;
	if (!value) return null;
	if (!isAbsolute(value)) throw new Error("DRONE_KNOWLEDGE_DIR must be absolute");
	return resolve(value);
}

/** Derive a stable, filesystem-safe project identity when the workspace has no configured slug. */
export function projectIdentity(cwd: string, configured?: unknown): string {
	if (typeof configured === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(configured)) return configured;
	const path = resolve(cwd);
	const stem =
		basename(path)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 40) || "project";
	return `${stem}-${createHash("sha256").update(path).digest("hex").slice(0, 10)}`;
}

function validateBinding(value: unknown): asserts value is KnowledgeBinding {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		(value as { version?: unknown }).version !== 1 ||
		!isAbsolute(String((value as { vault?: unknown }).vault || "")) ||
		!/^[a-f0-9]{24}$/.test(String((value as { vaultId?: unknown }).vaultId || "")) ||
		!Number.isSafeInteger((value as { revision?: unknown }).revision) ||
		Number((value as { revision?: unknown }).revision) < 1 ||
		!["project", "literature", "hybrid"].includes(String((value as { profile?: unknown }).profile)) ||
		!["run-only", "verified", "rich"].includes(String((value as { depositMode?: unknown }).depositMode)) ||
		!["none", "read-local"].includes(String((value as { subagentPolicy?: unknown }).subagentPolicy)) ||
		typeof (value as { updatedAt?: unknown }).updatedAt !== "string"
	)
		throw new Error("Invalid application knowledge binding; no project fallback was used");
}

/** Read the current app binding, or null when the desktop binding directory is not configured. */
export async function readKnowledgeBinding({
	fresh = false,
}: ReadKnowledgeBindingOptions = {}): Promise<KnowledgeBinding | null> {
	if (!fresh && local.getStore()) return local.getStore() ?? null;
	const directory = knowledgeDirectory();
	if (!directory) return null;
	let value: unknown;
	try {
		value = JSON.parse((await readFile(join(directory, "binding.json"), "utf8")).replace(/^\uFEFF/, ""));
	} catch (error) {
		if (errorCode(error) === "ENOENT") return null;
		throw new Error(
			`Knowledge binding cannot be read: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	validateBinding(value);
	return value;
}

/** Save an app binding atomically, with an optional optimistic revision check. */
export async function saveKnowledgeBinding(
	input: KnowledgeBindingInput,
	expectedRevision: number | null = null,
): Promise<KnowledgeBinding> {
	const directory = knowledgeDirectory();
	if (!directory) throw new Error("Application knowledge directory is not configured");
	const previous = queues.get(directory) || Promise.resolve();
	const operation = previous
		.catch(() => {})
		.then(async () => {
			const current = await readKnowledgeBinding({ fresh: true });
			if (expectedRevision !== null && (current?.revision || 0) !== expectedRevision)
				throw new Error("Knowledge binding changed while confirming; review the new binding");
			const vault = await realpath(input.vault);
			const value: KnowledgeBinding = {
				version: 1,
				vault,
				vaultId: createHash("sha256").update(vault).digest("hex").slice(0, 24),
				revision: (current?.revision || 0) + 1,
				profile: input.profile,
				depositMode: input.depositMode,
				subagentPolicy: input.subagentPolicy,
				updatedAt: new Date().toISOString(),
			};
			validateBinding(value);
			await mkdir(directory, { recursive: true, mode: 0o700 });
			const temporary = join(directory, `binding.${randomUUID()}.tmp`);
			await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
			await rename(temporary, join(directory, "binding.json"));
			return value;
		});
	queues.set(directory, operation);
	try {
		return await operation;
	} finally {
		if (queues.get(directory) === operation) queues.delete(directory);
	}
}

/** Run a binding-scoped operation only when the persisted binding still matches the caller's revision. */
export async function withKnowledgeBinding<T>(
	binding: KnowledgeBinding,
	operation: BindingOperation<T>,
): Promise<T> {
	const current = await readKnowledgeBinding({ fresh: true });
	if (!binding || current?.vaultId !== binding.vaultId || current?.revision !== binding.revision)
		throw new Error("Knowledge binding changed; start a new turn before reading or writing");
	return local.run(binding, operation);
}
