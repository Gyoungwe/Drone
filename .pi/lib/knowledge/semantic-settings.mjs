import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { knowledgeDirectory } from "./config.mjs";
import { validateSemanticConfig } from "./semantic-provider.mjs";

const MAX_FILE_BYTES = 256 * 1024;
const SETTINGS_KEYS = new Set([
	"version",
	"revision",
	"updatedAt",
	"enabled",
	"provider",
	"baseUrl",
	"model",
	"credentialEnv",
	"remoteConsent",
	"timeoutMs",
	"chunkChars",
	"minSimilarity",
]);
const locks = new Map();
const defaultUpdatedAt = new Map();

function pathFor(vaultId) {
	if (!/^[a-f0-9]{24}$/.test(vaultId || "")) throw new Error("Invalid Vault binding");
	const dir = knowledgeDirectory();
	if (!dir) throw new Error("Application knowledge directory is not configured");
	return join(dir, vaultId, "semantic.json");
}

async function assertDirectory(path) {
	try {
		const stat = await lstat(path);
		if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Semantic settings path is unsafe");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		await mkdir(path, { recursive: true, mode: 0o700 });
		const stat = await lstat(path);
		if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Semantic settings path is unsafe");
	}
	let ancestor = path;
	for (let depth = 0; depth < 8 && ancestor !== dirname(ancestor); depth++) {
		try {
			const stat = await lstat(ancestor);
			if (stat.isSymbolicLink()) throw new Error("Semantic settings ancestor is unsafe");
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		ancestor = dirname(ancestor);
	}
}

async function assertFile(path) {
	try {
		const stat = await lstat(path);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES)
			throw new Error("Semantic settings file is unsafe or too large");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
}

function lockFor(path, task) {
	const previous = locks.get(path) || Promise.resolve();
	const current = previous.catch(() => {}).then(task);
	const held = current
		.catch(() => {})
		.finally(() => {
			if (locks.get(path) === held) locks.delete(path);
		});
	locks.set(path, held);
	return current;
}

function normalize(value, revision, updatedAt = null) {
	if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1)
		throw new Error("Invalid or future semantic settings schema");
	for (const key of Object.keys(value))
		if (!SETTINGS_KEYS.has(key)) throw new Error(`Unknown semantic setting: ${key}`);
	if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("Invalid semantic settings revision");
	const config = validateSemanticConfig({
		enabled: value.enabled,
		provider: value.provider,
		baseUrl: value.baseUrl,
		model: value.model,
		credentialEnv: value.credentialEnv,
		remoteConsent: value.remoteConsent,
		timeoutMs: value.timeoutMs,
		chunkChars: value.chunkChars,
		minSimilarity: value.minSimilarity,
	});
	if (updatedAt !== null && (typeof updatedAt !== "string" || Number.isNaN(Date.parse(updatedAt))))
		throw new Error("Invalid semantic settings updatedAt");
	return {
		version: 1,
		revision,
		...config,
		updatedAt: updatedAt ?? new Date().toISOString(),
	};
}

async function readUnlocked(path) {
	await assertDirectory(dirname(path));
	await assertFile(path);
	try {
		const raw = await readFile(path, { encoding: "utf8", flag: "r" });
		if (Buffer.byteLength(raw) > MAX_FILE_BYTES) throw new Error("Semantic settings file is too large");
		const value = JSON.parse(raw);
		return normalize(value, value.revision, value.updatedAt);
	} catch (error) {
		if (error.code === "ENOENT") {
			const updatedAt = defaultUpdatedAt.get(path) || new Date().toISOString();
			defaultUpdatedAt.set(path, updatedAt);
			return { version: 1, revision: 0, ...validateSemanticConfig({}), updatedAt };
		}
		if (error instanceof SyntaxError) throw new Error("Semantic settings cannot be read: invalid JSON");
		throw new Error(`Semantic settings cannot be read: ${error.message}`);
	}
}

export async function readSemanticSettings(vaultId) {
	const path = pathFor(vaultId);
	return lockFor(path, () => readUnlocked(path));
}

export async function saveSemanticSettings(vaultId, input, expectedRevision) {
	const path = pathFor(vaultId);
	return lockFor(path, async () => {
		const current = await readUnlocked(path);
		if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision)
			throw new Error("Semantic settings revision is stale");
		const value = normalize({ version: 1, ...input }, current.revision + 1);
		const dir = dirname(path);
		await assertDirectory(dir);
		for (const entry of await readdir(dir))
			if (/^semantic\.[a-f0-9-]+\.tmp$/.test(entry)) await unlink(join(dir, entry)).catch(() => {});
		const temp = join(dir, `semantic.${randomUUID()}.tmp`);
		try {
			await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
			await rename(temp, path);
		} finally {
			await unlink(temp).catch(() => {});
		}
		return value;
	});
}
