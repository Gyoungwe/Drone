import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { JsonStore } from "@drone/backend";
import type {
	SkillRepositoryAddInput,
	SkillRepositoryCheckResult,
	SkillRepositoryRecord,
	SkillRepositoryUpdateResult,
} from "@drone/shared";

const execFile = promisify(execFileCallback);
const STORE_VERSION = 1 as const;
const MAX_REPOSITORIES = 100;
const MAX_SKILL_FILES = 500;
const MAX_SKILL_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_SKILL_BYTES = 80 * 1024 * 1024;
const MAX_SOURCE_PATH_BYTES = 4096;
const SAFE_ID = /^[a-z0-9-]{12,64}$/u;

interface SkillFile {
	path: string;
	hash: string;
	bytes: number;
}

interface StoredRepository extends SkillRepositoryRecord {
	installRoot: string;
	files: Record<string, string>;
	fingerprint: string;
}

interface RepositoryState {
	version: typeof STORE_VERSION;
	repositories: StoredRepository[];
}

interface SourceSnapshot {
	root: string;
	files: SkillFile[];
	fingerprint: string;
	cleanup: () => Promise<void>;
}

let configuredUserDataDir: string | null = null;

export function configureSkillRepositoryManager(userDataDir: string): void {
	configuredUserDataDir = userDataDir;
}

function requireUserDataDir(): string {
	if (!configuredUserDataDir) throw new Error("Skill repository manager is not configured");
	return configuredUserDataDir;
}

function repositoriesRoot(userDataDir: string): string {
	return join(userDataDir, "research-skills", "repositories");
}

function repositoryStore(userDataDir: string): JsonStore<RepositoryState> {
	return new JsonStore<RepositoryState>({
		path: join(userDataDir, "research-skills", "repositories.json"),
		storageId: "desktop-research-skill-repositories",
		defaultValue: () => ({ version: STORE_VERSION, repositories: [] }),
	});
}

function readState(userDataDir: string): RepositoryState {
	const value = repositoryStore(userDataDir).readSync();
	if (!value || value.version !== STORE_VERSION || !Array.isArray(value.repositories))
		return { version: STORE_VERSION, repositories: [] };
	return {
		version: STORE_VERSION,
		repositories: value.repositories.filter((repository) => isStoredRepository(repository)),
	};
}

function isStoredRepository(value: unknown): value is StoredRepository {
	if (!value || typeof value !== "object") return false;
	const repository = value as Partial<StoredRepository>;
	return (
		typeof repository.id === "string" &&
		SAFE_ID.test(repository.id) &&
		typeof repository.name === "string" &&
		(repository.kind === "git" || repository.kind === "local") &&
		typeof repository.source === "string" &&
		typeof repository.license === "string" &&
		typeof repository.installRoot === "string" &&
		!Array.isArray(repository.files) &&
		!!repository.files &&
		typeof repository.files === "object" &&
		typeof repository.fingerprint === "string"
	);
}

function publicRepository(repository: StoredRepository): SkillRepositoryRecord {
	const { installRoot: _installRoot, files: _files, fingerprint: _fingerprint, ...publicValue } = repository;
	return { ...publicValue };
}

function ensureText(value: unknown, label: string, max: number, required = true): string | undefined {
	if (typeof value !== "string") {
		if (!required && value === undefined) return undefined;
		throw new Error(`${label} must be text`);
	}
	const text = value.trim();
	if (required && !text) throw new Error(`${label} is required`);
	if (text.length > max) throw new Error(`${label} is too long`);
	return text || undefined;
}

function validateSubpath(value: string | undefined): string | undefined {
	const text = ensureText(value, "Skill repository subpath", 1024, false);
	if (!text) return undefined;
	const normalized = text.replaceAll("\\", "/");
	if (normalized.startsWith("/") || normalized.includes("//"))
		throw new Error("Skill repository subpath is invalid");
	const parts = normalized.split("/");
	if (parts.some((part) => !part || part === "." || part === ".."))
		throw new Error("Skill repository subpath must stay inside the repository");
	return parts.join("/");
}

function validateGitSource(value: string): string {
	if (
		value.length > MAX_SOURCE_PATH_BYTES ||
		value.includes("\0") ||
		value.includes("\r") ||
		value.includes("\n")
	)
		throw new Error("Git URL is invalid");
	// Permit the standard SSH scp form as well as URL form, but never credentials.
	if (/^[\w.-]+@[\w.-]+:[^/\\\s].*$/u.test(value)) return value;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Git source must be an HTTPS or SSH URL");
	}
	if (!new Set(["https:", "ssh:", "git:"]).has(url.protocol) || url.username || url.password || url.hash)
		throw new Error("Git source must be an HTTPS or SSH URL without credentials");
	if (!url.hostname || url.pathname === "/") throw new Error("Git URL must include a repository path");
	return value;
}

async function realDirectory(path: string): Promise<string> {
	if (!isAbsolute(path) || path.length > MAX_SOURCE_PATH_BYTES)
		throw new Error("Local skill source must be an absolute directory");
	const resolved = await realpath(path).catch(() => {
		throw new Error("Local skill source does not exist");
	});
	const info = await stat(resolved);
	if (!info.isDirectory()) throw new Error("Local skill source must be a directory");
	return resolved;
}

function isWithin(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function safeRelativePath(path: string): string | null {
	const normalized = path.replaceAll("\\", "/");
	const parts = normalized.split("/");
	if (!parts.length || parts.some((part) => !part || part === "." || part === ".." || part.includes(":")))
		return null;
	return parts.join("/");
}

async function scanSkillFiles(root: string, subpath?: string): Promise<SkillFile[]> {
	const realRoot = await realpath(root);
	const base = await realpath(resolve(realRoot, subpath ?? ".")).catch(() => {
		throw new Error("Skill repository path does not exist");
	});
	if (!isWithin(realRoot, base)) throw new Error("Skill repository path escapes its root");
	const files: SkillFile[] = [];
	let totalBytes = 0;
	const visit = async (directory: string): Promise<void> => {
		const entries = await readdir(directory, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
			const full = join(directory, entry.name);
			if (entry.isDirectory()) {
				await visit(full);
				continue;
			}
			if (!entry.isFile() || entry.name !== "SKILL.md") continue;
			const real = await realpath(full);
			if (!isWithin(realRoot, real)) throw new Error("Skill file escapes repository root");
			const info = await stat(real);
			if (info.size > MAX_SKILL_FILE_BYTES || totalBytes + info.size > MAX_TOTAL_SKILL_BYTES)
				throw new Error("Skill repository exceeds the file size limit");
			const relativePath = safeRelativePath(relative(realRoot, real));
			if (!relativePath) throw new Error("Skill file path is invalid");
			const bytes = await readFile(real);
			files.push({
				path: relativePath,
				hash: createHash("sha256").update(bytes).digest("hex"),
				bytes: info.size,
			});
			totalBytes += info.size;
			if (files.length > MAX_SKILL_FILES)
				throw new Error("Skill repository contains too many SKILL.md files");
		}
	};
	await visit(base);
	if (!files.length) throw new Error("Skill repository contains no SKILL.md files");
	return files.sort((a, b) => a.path.localeCompare(b.path));
}

function fingerprint(files: readonly SkillFile[]): string {
	return createHash("sha256")
		.update(files.map((file) => `${file.path}\0${file.hash}`).join("\n"))
		.digest("hex");
}

function changedFiles(previous: StoredRepository, files: readonly SkillFile[]): string[] {
	const next = new Map(files.map((file) => [file.path, file.hash]));
	const paths = new Set([...Object.keys(previous.files), ...next.keys()]);
	return [...paths].filter((path) => previous.files[path] !== next.get(path)).sort();
}

async function cloneGit(input: SkillRepositoryAddInput, destination: string): Promise<void> {
	const args = ["clone", "--depth", "1", "--single-branch", "--no-tags"];
	if (input.ref) args.push("--branch", input.ref);
	args.push("--", input.source, destination);
	try {
		await execFile("git", args, {
			timeout: 120_000,
			maxBuffer: 2 * 1024 * 1024,
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Git source could not be fetched: ${message.slice(0, 500)}`);
	}
}

async function sourceSnapshot(input: SkillRepositoryAddInput): Promise<SourceSnapshot> {
	if (input.kind === "local") {
		const root = await realDirectory(input.source);
		const files = await scanSkillFiles(root, input.subpath);
		return { root, files, fingerprint: fingerprint(files), cleanup: async () => {} };
	}
	const temporary = await mkdtemp(join(tmpdir(), "drone-skill-repository-"));
	try {
		await cloneGit(input, temporary);
		const files = await scanSkillFiles(temporary, input.subpath);
		return {
			root: temporary,
			files,
			fingerprint: fingerprint(files),
			cleanup: async () => rm(temporary, { recursive: true, force: true }),
		};
	} catch (error) {
		await rm(temporary, { recursive: true, force: true });
		throw error;
	}
}

async function copySnapshot(root: string, files: readonly SkillFile[], target: string): Promise<void> {
	for (const file of files) {
		const source = join(root, file.path);
		const resolved = await realpath(source);
		if (!isWithin(root, resolved)) throw new Error("Skill file escapes repository root");
		const destination = join(target, file.path);
		const parent = dirname(destination);
		await mkdir(parent, { recursive: true });
		await copyFile(resolved, destination);
	}
}

function normalizeInput(input: SkillRepositoryAddInput): SkillRepositoryAddInput {
	if (!input || typeof input !== "object") throw new Error("Skill repository input is required");
	if (input.kind !== "git" && input.kind !== "local") throw new Error("Skill repository kind is invalid");
	const source = ensureText(input.source, "Skill repository source", MAX_SOURCE_PATH_BYTES);
	const license = ensureText(input.license, "Skill repository license", 256);
	const ref = ensureText(input.ref, "Skill repository ref", 256, false);
	const name = ensureText(input.name, "Skill repository name", 256, false);
	const licenseEvidence = ensureText(input.licenseEvidence, "License evidence", MAX_SOURCE_PATH_BYTES, false);
	const subpath = validateSubpath(input.subpath);
	if (!source || !license) throw new Error("Skill repository source and license are required");
	if (input.kind === "git") validateGitSource(source);
	return {
		kind: input.kind,
		source,
		license,
		...(ref ? { ref } : {}),
		...(subpath ? { subpath } : {}),
		...(name ? { name } : {}),
		...(licenseEvidence ? { licenseEvidence } : {}),
	};
}

function displayName(input: SkillRepositoryAddInput): string {
	if (input.name) return input.name;
	if (input.kind === "local") return basename(input.source);
	const source = input.source.replace(/\.git$/u, "").replace(/[\\/]$/u, "");
	return source.split(/[/:]/u).pop() || "Skill repository";
}

function installPathIsSafe(userDataDir: string, path: string): boolean {
	return isWithin(resolve(repositoriesRoot(userDataDir)), resolve(path));
}

function filesRecord(files: readonly SkillFile[]): Record<string, string> {
	return Object.fromEntries(files.map((file) => [file.path, file.hash]));
}

function nextStoredRepository(
	input: SkillRepositoryAddInput,
	snapshot: SourceSnapshot,
	installRoot: string,
	now: string,
): StoredRepository {
	return {
		id: randomUUID().replaceAll("-", "").slice(0, 24),
		name: displayName(input),
		kind: input.kind,
		source: input.source,
		...(input.ref ? { ref: input.ref } : {}),
		...(input.subpath ? { subpath: input.subpath } : {}),
		license: input.license,
		...(input.licenseEvidence ? { licenseEvidence: input.licenseEvidence } : {}),
		status: "ready",
		skillCount: snapshot.files.length,
		lastCheckedAt: now,
		lastAppliedAt: now,
		updateAvailable: false,
		installRoot,
		files: filesRecord(snapshot.files),
		fingerprint: snapshot.fingerprint,
	};
}

function toInput(repository: StoredRepository): SkillRepositoryAddInput {
	return {
		kind: repository.kind,
		source: repository.source,
		...(repository.ref ? { ref: repository.ref } : {}),
		...(repository.subpath ? { subpath: repository.subpath } : {}),
		license: repository.license,
		...(repository.licenseEvidence ? { licenseEvidence: repository.licenseEvidence } : {}),
		name: repository.name,
	};
}

async function markError(userDataDir: string, id: string, error: unknown): Promise<void> {
	const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
	await repositoryStore(userDataDir).update((state) => {
		const repository = state.repositories.find((item) => item.id === id);
		if (repository) {
			repository.status = "error";
			repository.lastError = message;
			repository.lastCheckedAt = new Date().toISOString();
		}
	});
}

export function listSkillRepositories(userDataDir = requireUserDataDir()): SkillRepositoryRecord[] {
	return readState(userDataDir).repositories.map(publicRepository);
}

export async function addSkillRepository(
	input: SkillRepositoryAddInput,
	userDataDir = requireUserDataDir(),
): Promise<SkillRepositoryRecord> {
	const normalized = normalizeInput(input);
	const state = readState(userDataDir);
	if (state.repositories.length >= MAX_REPOSITORIES) throw new Error("Too many Skill repositories");
	if (
		state.repositories.some(
			(repository) =>
				repository.kind === normalized.kind &&
				repository.source === normalized.source &&
				repository.subpath === normalized.subpath &&
				repository.ref === normalized.ref,
		)
	)
		throw new Error("This Skill repository is already added");
	const snapshot = await sourceSnapshot(normalized);
	const id = randomUUID().replaceAll("-", "").slice(0, 24);
	const root = repositoriesRoot(userDataDir);
	const stage = join(root, `.stage-${id}-${randomUUID()}`);
	const target = join(root, `${id}-${randomUUID()}`);
	await mkdir(stage, { recursive: true });
	await rename(stage, target);
	try {
		await copySnapshot(snapshot.root, snapshot.files, target);
		const now = new Date().toISOString();
		const repository = nextStoredRepository(normalized, snapshot, target, now);
		repository.id = id;
		await repositoryStore(userDataDir).update((current) => {
			current.repositories.push(repository);
			return current;
		});
		return publicRepository(repository);
	} catch (error) {
		await rm(target, { recursive: true, force: true });
		throw error;
	} finally {
		await snapshot.cleanup();
	}
}

export async function checkSkillRepository(
	id: string,
	userDataDir = requireUserDataDir(),
): Promise<SkillRepositoryCheckResult> {
	if (!SAFE_ID.test(id)) throw new Error("Skill repository id is invalid");
	const state = readState(userDataDir);
	const current = state.repositories.find((repository) => repository.id === id);
	if (!current) throw new Error("Skill repository not found");
	try {
		const snapshot = await sourceSnapshot(toInput(current));
		const changed = changedFiles(current, snapshot.files);
		const now = new Date().toISOString();
		const updated = await repositoryStore(userDataDir).update((draft) => {
			const repository = draft.repositories.find((item) => item.id === id);
			if (repository) {
				repository.status = changed.length ? "update-available" : "ready";
				repository.updateAvailable = changed.length > 0;
				repository.lastCheckedAt = now;
				delete repository.lastError;
			}
			return draft;
		});
		await snapshot.cleanup();
		const repository = updated.repositories.find((item) => item.id === id);
		if (!repository) throw new Error("Skill repository disappeared during check");
		return { repository: publicRepository(repository), changedFiles: changed };
	} catch (error) {
		await markError(userDataDir, id, error);
		throw error;
	}
}

export async function updateSkillRepository(
	id: string,
	userDataDir = requireUserDataDir(),
): Promise<SkillRepositoryUpdateResult> {
	if (!SAFE_ID.test(id)) throw new Error("Skill repository id is invalid");
	const state = readState(userDataDir);
	const current = state.repositories.find((repository) => repository.id === id);
	if (!current) throw new Error("Skill repository not found");
	let snapshot: SourceSnapshot | null = null;
	let target: string | null = null;
	try {
		snapshot = await sourceSnapshot(toInput(current));
		const changed = changedFiles(current, snapshot.files);
		if (!changed.length) {
			const now = new Date().toISOString();
			const updated = await repositoryStore(userDataDir).update((draft) => {
				const repository = draft.repositories.find((item) => item.id === id);
				if (repository) {
					repository.status = "ready";
					repository.updateAvailable = false;
					repository.lastCheckedAt = now;
					delete repository.lastError;
				}
				return draft;
			});
			const repository = updated.repositories.find((item) => item.id === id);
			if (!repository) throw new Error("Skill repository disappeared during update");
			return { repository: publicRepository(repository), changedFiles: [], restartedRequired: true };
		}
		const root = repositoriesRoot(userDataDir);
		target = join(root, `${id}-${randomUUID()}`);
		await mkdir(target, { recursive: true });
		await copySnapshot(snapshot.root, snapshot.files, target);
		const now = new Date().toISOString();
		const replacement: StoredRepository = {
			...current,
			status: "ready",
			skillCount: snapshot.files.length,
			lastCheckedAt: now,
			lastAppliedAt: now,
			updateAvailable: false,
			lastError: undefined,
			installRoot: target,
			files: filesRecord(snapshot.files),
			fingerprint: snapshot.fingerprint,
		};
		const updated = await repositoryStore(userDataDir).update((draft) => {
			const index = draft.repositories.findIndex((item) => item.id === id);
			if (index < 0) throw new Error("Skill repository disappeared during update");
			draft.repositories[index] = replacement;
			return draft;
		});
		// The new pointer is already durable. A failed cleanup leaves the old
		// snapshot recoverable and must not turn a successful update into an
		// error (or remove the newly active target in the catch block).
		await rm(current.installRoot, { recursive: true, force: true }).catch(() => undefined);
		const repository = updated.repositories.find((item) => item.id === id);
		if (!repository) throw new Error("Skill repository disappeared during update");
		return { repository: publicRepository(repository), changedFiles: changed, restartedRequired: true };
	} catch (error) {
		if (target) await rm(target, { recursive: true, force: true });
		await markError(userDataDir, id, error);
		throw error;
	} finally {
		if (snapshot) await snapshot.cleanup();
	}
}

export async function removeSkillRepository(id: string, userDataDir = requireUserDataDir()): Promise<void> {
	if (!SAFE_ID.test(id)) throw new Error("Skill repository id is invalid");
	const state = readState(userDataDir);
	const current = state.repositories.find((repository) => repository.id === id);
	if (!current) throw new Error("Skill repository not found");
	await repositoryStore(userDataDir).update((draft) => {
		draft.repositories = draft.repositories.filter((repository) => repository.id !== id);
		return draft;
	});
	if (installPathIsSafe(userDataDir, current.installRoot))
		await rm(current.installRoot, { recursive: true, force: true });
}

/** Load only hash-verified snapshots into the Pi loader during host startup. */
export function readSkillRepositoryInstall(userDataDir: string): { paths: string[]; warnings: string[] } {
	const root = resolve(repositoriesRoot(userDataDir));
	const paths: string[] = [];
	const warnings: string[] = [];
	for (const repository of readState(userDataDir).repositories) {
		const installRoot = resolve(repository.installRoot);
		if (!installPathIsSafe(userDataDir, installRoot)) {
			warnings.push(`Skill repository ${repository.name} has an unsafe install path`);
			continue;
		}
		if (!isWithin(root, installRoot)) {
			warnings.push(`Skill repository ${repository.name} is outside its managed root`);
			continue;
		}
		try {
			for (const [path, hash] of Object.entries(repository.files)) {
				const target = resolve(installRoot, path);
				if (!isWithin(installRoot, target)) throw new Error(`Skill path escapes install root: ${path}`);
				const bytes = readFileSync(target);
				const actual = createHash("sha256").update(bytes).digest("hex");
				if (actual !== hash) throw new Error(`Modified skill: ${path}`);
				paths.push(target);
			}
		} catch (error) {
			warnings.push(
				`Skill repository ${repository.name} not loaded: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return { paths, warnings };
}
