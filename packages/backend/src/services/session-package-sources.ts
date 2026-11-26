import {
	constants,
	cpSync,
	existsSync,
	lstatSync,
	mkdtempSync,
	readlinkSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isPackageName } from "@drone/shared";
import type { ResourceLoader } from "@earendil-works/pi-coding-agent";
import { createLogger } from "../log";

const log = createLogger("backend");

function contains(root: string, path: string): boolean {
	const suffix = relative(root, path);
	return !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`);
}

function copyPackage(source: string, target: string): void {
	cpSync(source, target, {
		recursive: true,
		verbatimSymlinks: true,
		mode: constants.COPYFILE_FICLONE,
		filter: (path) => {
			if (basename(path) === ".git") return false;
			if (!lstatSync(path).isSymbolicLink()) return true;
			const link = readlinkSync(path);
			return !isAbsolute(link) && contains(source, resolve(dirname(path), link));
		},
	});
}

function installedNpmRoot(modules: string, file: string): string | undefined {
	const segments = relative(modules, file).split(sep);
	const name = segments[0]?.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
	return isPackageName(name) ? join(modules, name) : undefined;
}

function installedGitRoot(gitRoot: string, file: string): string | undefined {
	for (
		let directory = dirname(file);
		directory !== gitRoot && contains(gitRoot, directory);
		directory = dirname(directory)
	) {
		if (existsSync(join(directory, ".git"))) return directory;
	}
	return undefined;
}

export class SessionPackageSources {
	private readonly copies = new Map<string, string>();
	private readonly directories = new Set<string>();
	private readonly installs: ReadonlyArray<{
		parent: string;
		suffix: string;
		directory: string;
		kind: "npm" | "git";
	}>;

	constructor(cwd: string, agentDir: string) {
		this.installs = [
			{ parent: cwd, prefix: ".pi" },
			{ parent: agentDir, prefix: "" },
		].flatMap(({ parent, prefix }) => [
			{
				parent,
				suffix: join(prefix, "npm", "node_modules"),
				directory: join(parent, prefix, "npm", "node_modules"),
				kind: "npm",
			},
			{ parent, suffix: join(prefix, "git"), directory: join(parent, prefix, "git"), kind: "git" },
		]);
	}

	retainSkills(loader: ResourceLoader): void {
		for (const skill of loader.getSkills().skills) {
			if (skill.sourceInfo.origin !== "package") continue;
			const retained = this.retainPath(skill.filePath);
			if (retained !== skill.filePath) {
				skill.filePath = retained;
				skill.baseDir = dirname(retained);
			}
		}
	}

	retainPath(path: string): string {
		const match = this.installs.find(({ directory }) => contains(directory, path));
		if (!match) return path;
		const { directory, parent, suffix, kind } = match;
		const source = kind === "npm" ? installedNpmRoot(directory, path) : installedGitRoot(directory, path);
		if (!source) return path;
		const root = realpathSync(source);
		const canonicalDirectory = realpathSync(directory);
		if (
			canonicalDirectory !== join(realpathSync(parent), suffix) ||
			root !== join(canonicalDirectory, relative(directory, source))
		)
			return path;
		const canonical = realpathSync(path);
		if (!contains(root, canonical)) return path;
		return join(this.copy(root, canonicalDirectory), relative(root, canonical));
	}

	private copy(root: string, installDir: string): string {
		const existing = this.copies.get(root);
		if (existing) return existing;
		const directory = mkdtempSync(join(installDir, ".drone-session-package-"));
		this.directories.add(directory);
		const copy = join(directory, "package");
		copyPackage(root, copy);
		this.copies.set(root, copy);
		return copy;
	}

	dispose(): void {
		for (const directory of this.directories) {
			try {
				rmSync(directory, { recursive: true, force: true });
			} catch (error) {
				log.warn("Session package snapshot cleanup failed", error);
			}
		}
		this.directories.clear();
		this.copies.clear();
	}
}
