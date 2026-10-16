import { createHash, randomUUID } from "node:crypto";
import {
	createReadStream,
	createWriteStream,
	existsSync,
	promises as fs,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { createLogger } from "@drone/backend";
import {
	type BuiltinResearchSkillSource,
	RESEARCH_SKILL_SOURCES,
	type ResearchSkillSource,
	type ResearchSkillUpdatePack,
	type ResearchSkillUpdateState,
} from "@drone/shared";
import { app } from "electron";

const log = createLogger("research-skill-updater");
const MAX_ARCHIVE_BYTES = 350 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 150 * 1024 * 1024;
const BUILTIN_IDS: BuiltinResearchSkillSource[] = ["nature", "scientific"];
const COMMIT_RE = /^[0-9a-f]{40}$/u;
const HASH_RE = /^[0-9a-f]{64}$/u;

type PackPin = { commit: string; archiveSha256: string };
type Manifest = { version: 1; packs: Partial<Record<BuiltinResearchSkillSource, PackPin>> };
type Listener = (state: ResearchSkillUpdateState) => void;

let config: { userDataDir: string } | null = null;
const listeners = new Set<Listener>();
let available: ResearchSkillUpdatePack[] = [];

export function configureResearchSkillUpdater(userDataDir: string): void {
	config = { userDataDir };
}

export function onResearchSkillUpdateState(cb: Listener): void {
	listeners.add(cb);
}

function emit(state: ResearchSkillUpdateState): void {
	for (const listener of listeners) listener(state);
}

function source(id: BuiltinResearchSkillSource) {
	const value = RESEARCH_SKILL_SOURCES.find((entry) => entry.id === id);
	if (!value) throw new Error(`Missing built-in research skill source: ${id}`);
	return value;
}

function installRoot(userDataDir: string): string {
	return join(userDataDir, "research-skills");
}

function readManifest(userDataDir: string): Manifest | null {
	try {
		const value = JSON.parse(
			readFileSync(join(installRoot(userDataDir), "manifest.json"), "utf8"),
		) as Manifest;
		if (value.version !== 1 || !value.packs || typeof value.packs !== "object") return null;
		return value;
	} catch {
		return null;
	}
}

/** Resolve user-installed packs only after validating their commit/path identity. */
export function readResearchSkillPackInstall(userDataDir: string): {
	sourceRoots: Partial<Record<ResearchSkillSource, string>>;
	sourcePins: Partial<Record<ResearchSkillSource, PackPin>>;
} {
	const sourceRoots: Partial<Record<ResearchSkillSource, string>> = {};
	const sourcePins: Partial<Record<ResearchSkillSource, PackPin>> = {};
	const manifest = readManifest(userDataDir);
	if (!manifest) return { sourceRoots, sourcePins };
	const root = realpathOrNull(installRoot(userDataDir));
	if (!root) return { sourceRoots, sourcePins };
	for (const id of BUILTIN_IDS) {
		const pin = manifest.packs[id];
		if (!pin || !COMMIT_RE.test(pin.commit) || !HASH_RE.test(pin.archiveSha256)) continue;
		const directory = join(root, `${id}-${pin.commit}`);
		const realDirectory = realpathOrNull(directory);
		if (!realDirectory || !isWithin(root, realDirectory)) continue;
		sourceRoots[id] = realDirectory;
		sourcePins[id] = pin;
	}
	return { sourceRoots, sourcePins };
}

function realpathOrNull(path: string): string | null {
	try {
		return realpathSync(path);
	} catch {
		return null;
	}
}

function isWithin(root: string, path: string): boolean {
	const rel = relative(root, path);
	return (
		rel === "" ||
		(!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.includes("\\") ? "\\" : "/"}`))
	);
}

async function githubCommit(id: BuiltinResearchSkillSource): Promise<string> {
	const entry = source(id);
	const response = await fetch(`https://api.github.com/repos/${entry.repository}/commits/main`, {
		headers: { Accept: "application/vnd.github+json", "User-Agent": "Drone-research-skills/1" },
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) throw new Error(`${id}: GitHub check failed (${response.status})`);
	const value = (await response.json()) as { sha?: unknown };
	if (typeof value.sha !== "string" || !COMMIT_RE.test(value.sha))
		throw new Error(`${id}: invalid upstream commit`);
	return value.sha;
}

function currentPins(userDataDir: string): Partial<Record<BuiltinResearchSkillSource, PackPin>> {
	return readResearchSkillPackInstall(userDataDir).sourcePins;
}

function currentCommit(
	id: BuiltinResearchSkillSource,
	pins: Partial<Record<BuiltinResearchSkillSource, PackPin>>,
): string {
	return pins[id]?.commit ?? source(id).commit;
}

export async function checkResearchSkillUpdates(): Promise<void> {
	if (!config) return;
	emit({ phase: "checking" });
	try {
		const pins = currentPins(config.userDataDir);
		const packs: ResearchSkillUpdatePack[] = [];
		for (const id of BUILTIN_IDS) {
			const latestCommit = await githubCommit(id);
			const current = currentCommit(id, pins);
			if (latestCommit !== current) packs.push({ id, currentCommit: current, latestCommit });
		}
		available = packs;
		emit(packs.length ? { phase: "available", packs } : { phase: "up-to-date" });
	} catch (error) {
		available = [];
		const message = error instanceof Error ? error.message : String(error);
		log.warn("research skill update check failed", message);
		emit({ phase: "error", message });
	}
}

async function downloadArchive(
	id: BuiltinResearchSkillSource,
	commit: string,
	target: string,
	onProgress: (percent: number) => void,
): Promise<{ sha256: string; bytes: number }> {
	const entry = source(id);
	const response = await fetch(`https://codeload.github.com/${entry.repository}/tar.gz/${commit}`, {
		headers: { "User-Agent": "Drone-research-skills/1" },
		signal: AbortSignal.timeout(10 * 60_000),
	});
	if (!response.ok || !response.body) throw new Error(`${id}: archive download failed (${response.status})`);
	const total = Number(response.headers.get("content-length") ?? 0);
	const hash = createHash("sha256");
	let bytes = 0;
	await fs.mkdir(dirname(target), { recursive: true });
	const output = createWriteStream(target, { flags: "wx" });
	try {
		for await (const chunk of Readable.fromWeb(response.body as never)) {
			const block = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			bytes += block.length;
			if (bytes > MAX_ARCHIVE_BYTES) throw new Error(`${id}: archive exceeds size limit`);
			hash.update(block);
			if (!output.write(block)) await new Promise<void>((resolve) => output.once("drain", resolve));
			if (total > 0) onProgress(Math.min(95, Math.round((bytes / total) * 95)));
		}
		await new Promise<void>((resolve, reject) =>
			output.end((error?: Error) => (error ? reject(error) : resolve())),
		);
	} catch (error) {
		output.destroy();
		throw error;
	}
	return { sha256: hash.digest("hex"), bytes };
}

function safeRelativePath(path: string): string | null {
	const parts = path.split("/");
	if (
		!parts.length ||
		parts.some((part) => !part || part === "." || part === ".." || part.includes("\\") || part.includes(":"))
	)
		return null;
	return parts.join("/");
}

function archiveRelativePath(raw: string): string | null {
	const parts = raw.split("/");
	if (parts.length < 2) return null;
	return safeRelativePath(parts.slice(1).join("/"));
}

function tarString(header: Buffer, start: number, end: number): string {
	return header.subarray(start, end).toString("utf8").replace(/\0.*$/u, "");
}

function tarSize(header: Buffer): number {
	const text = tarString(header, 124, 136).trim().replace(/\0/g, "");
	return text ? Number.parseInt(text, 8) : 0;
}

async function extractSelected(
	sourceEntry: ReturnType<typeof source>,
	archive: string,
	stage: string,
): Promise<Record<string, string>> {
	const expected = new Set([
		...sourceEntry.licenseFiles,
		...sourceEntry.skills.filter((skill) => skill.bundled).map((skill) => skill.path),
	]);
	const hashes: Record<string, string> = {};
	const stream = createReadStream(archive).pipe(createGunzip());
	let buffer = Buffer.alloc(0);
	let fileRemaining = 0;
	let paddingRemaining = 0;
	let filePath: string | null = null;
	let fileChunks: Buffer[] = [];
	let fileSize = 0;
	let extractedBytes = 0;
	const seen = new Set<string>();

	const finishFile = async () => {
		if (!filePath) return;
		const bytes = Buffer.concat(fileChunks);
		extractedBytes += bytes.length;
		if (extractedBytes > MAX_EXTRACTED_BYTES)
			throw new Error(`${sourceEntry.id}: extracted files exceed size limit`);
		if (seen.has(filePath.toLowerCase()))
			throw new Error(`${sourceEntry.id}: duplicate archive path ${filePath}`);
		seen.add(filePath.toLowerCase());
		const target = join(stage, ...filePath.split("/"));
		await fs.mkdir(dirname(target), { recursive: true });
		await fs.writeFile(target, bytes, { flag: "wx" });
		hashes[filePath] = createHash("sha256").update(bytes).digest("hex");
		filePath = null;
		fileChunks = [];
		fileSize = 0;
	};

	for await (const chunk of stream) {
		buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
		while (true) {
			if (fileRemaining > 0) {
				const take = Math.min(fileRemaining, buffer.length);
				if (!take) break;
				if (filePath) fileChunks.push(buffer.subarray(0, take));
				buffer = buffer.subarray(take);
				fileRemaining -= take;
				if (fileRemaining === 0) {
					const completedFileSize = fileSize;
					await finishFile();
					paddingRemaining = (512 - (completedFileSize % 512)) % 512;
				}
				continue;
			}
			if (paddingRemaining > 0) {
				const take = Math.min(paddingRemaining, buffer.length);
				if (!take) break;
				buffer = buffer.subarray(take);
				paddingRemaining -= take;
				continue;
			}
			if (buffer.length < 512) break;
			const header = buffer.subarray(0, 512);
			buffer = buffer.subarray(512);
			if (header.every((byte) => byte === 0)) {
				buffer = Buffer.alloc(0);
				break;
			}
			const rawPath = tarString(header, 0, 100);
			const relative = archiveRelativePath(rawPath);
			const size = tarSize(header);
			const type = header[156];
			fileRemaining = size;
			fileSize = size;
			paddingRemaining = 0;
			filePath = type === 0 || type === 48 ? (relative && expected.has(relative) ? relative : null) : null;
			fileChunks = [];
		}
	}
	await finishFile();
	for (const required of expected)
		if (!hashes[required]) throw new Error(`${sourceEntry.id}: missing ${required} in archive`);
	return hashes;
}

async function writeManifest(
	userDataDir: string,
	packs: Partial<Record<BuiltinResearchSkillSource, PackPin>>,
): Promise<void> {
	const root = installRoot(userDataDir);
	await fs.mkdir(root, { recursive: true });
	const temporary = join(root, `.manifest-${randomUUID()}.tmp`);
	const target = join(root, "manifest.json");
	await fs.writeFile(temporary, `${JSON.stringify({ version: 1, packs }, null, 2)}\n`, "utf8");
	try {
		await fs.rename(temporary, target);
	} catch (error) {
		// Windows does not replace an existing file with rename; the manifest is
		// only a pointer to already staged immutable directories, so this brief
		// replacement remains fail-closed if the process is interrupted.
		if (
			!(
				"EEXIST" === (error as NodeJS.ErrnoException).code ||
				"EPERM" === (error as NodeJS.ErrnoException).code
			)
		)
			throw error;
		await fs.rm(target, { force: true });
		await fs.rename(temporary, target);
	}
}

async function stagePack(
	id: BuiltinResearchSkillSource,
	update: ResearchSkillUpdatePack,
	index: number,
	total: number,
): Promise<PackPin> {
	if (!config) throw new Error("Research skill updater is not configured");
	const root = installRoot(config.userDataDir);
	await fs.mkdir(root, { recursive: true });
	const stage = join(root, `.stage-${id}-${randomUUID()}`);
	const archive = join(root, `.archive-${id}-${randomUUID()}.tar.gz`);
	try {
		await fs.mkdir(stage, { recursive: true });
		const downloaded = await downloadArchive(id, update.latestCommit, archive, (percent) =>
			emit({
				phase: "downloading",
				packs: available,
				percent: Math.round(((index + percent / 100) / total) * 100),
			}),
		);
		const hashes = await extractSelected(source(id), archive, stage);
		const selected = source(id)
			.skills.filter((skill) => skill.bundled)
			.map(({ name, path }) => ({ name, path }));
		await fs.writeFile(
			`${stage}/.drone-pack.json`,
			`${JSON.stringify(
				{
					version: 1,
					source: id,
					repository: source(id).repository,
					commit: update.latestCommit,
					archiveSha256: downloaded.sha256,
					license: source(id).license,
					licenseAuthorization: "source-license",
					layout: "skills-v1",
					skills: selected,
					files: hashes,
				},
				null,
				2,
			)}\n`,
		);
		const target = join(root, `${id}-${update.latestCommit}`);
		if (!existsSync(target)) await fs.rename(stage, target);
		return { commit: update.latestCommit, archiveSha256: downloaded.sha256 };
	} finally {
		rmSync(stage, { recursive: true, force: true });
		rmSync(archive, { force: true });
	}
}

export async function updateResearchSkills(): Promise<void> {
	if (!config) return;
	if (!available.length) {
		await checkResearchSkillUpdates();
		if (!available.length) return;
	}
	try {
		const pins = { ...currentPins(config.userDataDir) };
		for (let index = 0; index < available.length; index++) {
			const update = available[index];
			if (!update) continue;
			pins[update.id] = await stagePack(update.id, update, index, available.length);
		}
		await writeManifest(config.userDataDir, pins);
		emit({ phase: "ready", packs: available });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		log.error("research skill update failed", message);
		emit({ phase: "error", message });
	}
}

export function restartForResearchSkills(): void {
	if (!app.isPackaged) return;
	app.relaunch();
	app.exit(0);
}
