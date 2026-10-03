import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readNoteFile } from "./files";

const MANAGED_START = "<!-- pi-agent:managed:start -->";
const MANAGED_END = "<!-- pi-agent:managed:end -->";
const PROJECT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAVIGATION_TARGETS = new Set(["Home.md", "Wiki/Index.md", "Library/Index.md"]);

type ContainedFile = (root: string, path: string) => Promise<string>;
type CreateOnly = (path: string, content: string) => Promise<boolean>;
type UpdateNavigation = (
	root: string,
	path: string,
	heading: string,
	body: string,
) => Promise<NavigationUpdateResult>;

export interface NavigationUpdateResult {
	path: string;
	changed: boolean;
}

/**
 * Filesystem seams for embedding layout initialization in a host runtime.
 * The defaults enforce Vault containment and create-only semantics. Hosts can
 * inject the same contracts when they already own a filesystem abstraction.
 */
export interface KnowledgeLayoutDependencies {
	containedFile?: ContainedFile;
	createOnly?: CreateOnly;
	updateNavigation?: UpdateNavigation;
}

function containsPath(root: string, target: string): boolean {
	const relativePath = relative(root, target);
	return (
		relativePath === "" ||
		(!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`))
	);
}

async function canonicalPath(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(path) === path) throw error;
		return join(await canonicalPath(dirname(path)), basename(path));
	}
}

/** Resolve a Vault-relative destination without following it outside Vault. */
export async function containedVaultFile(root: string, path: string): Promise<string> {
	const vault = resolve(root);
	const target = resolve(vault, path);
	if (!containsPath(vault, target) || !containsPath(vault, await canonicalPath(target)))
		throw new Error("Path must stay inside Vault");
	return target;
}

/** Atomically create a regular file, preserving an existing human-edited file. */
export async function createVaultFileOnly(path: string, content: string): Promise<boolean> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
	try {
		await link(temporary, path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		const existing = await lstat(path);
		if (!existing.isFile() || existing.isSymbolicLink())
			throw new Error(`Expected a regular Vault file: ${path}`);
		return false;
	} finally {
		await unlink(temporary);
	}
}

function navigationBase(heading: string): string {
	return `${heading}\n\n## Human review\n`;
}

const hash = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Update only the managed navigation block, preserving human-authored text. */
export async function updateVaultNavigation(
	vault: string,
	path: string,
	heading: string,
	body: string,
	containedFile: ContainedFile = containedVaultFile,
): Promise<NavigationUpdateResult> {
	if (!NAVIGATION_TARGETS.has(path) && !/^Projects\/[a-z0-9-]+\/Index\.md$/.test(path))
		throw new Error("Not an allowed navigation target");
	const full = await containedFile(vault, path);
	let original: string | null = null;
	try {
		original = (await readNoteFile(vault, path)).text;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const base = original ?? navigationBase(heading);
	const start = base.indexOf(MANAGED_START);
	const end = base.indexOf(MANAGED_END);
	const block = `${MANAGED_START}\n${body.trim()}\n${MANAGED_END}`;
	if (
		start < 0 !== end < 0 ||
		end < start ||
		(start >= 0 && (base.indexOf(MANAGED_START, start + 1) >= 0 || base.indexOf(MANAGED_END, end + 1) >= 0))
	)
		throw new Error("Invalid navigation managed markers");
	const updated =
		start >= 0
			? base.slice(0, start) + block + base.slice(end + MANAGED_END.length)
			: `${base.trimEnd()}\n\n${block}\n`;
	if (updated === original) return { path, changed: false };
	if (original !== null) {
		if ((await readNoteFile(vault, path)).hash !== hash(original))
			throw new Error("Human navigation changed; update was not applied");
	}
	await mkdir(dirname(full), { recursive: true });
	if (original === null) {
		await writeFile(full, updated, { encoding: "utf8", flag: "wx" });
	} else {
		const temporary = `${full}.${randomUUID()}.tmp`;
		await writeFile(temporary, updated, { encoding: "utf8", flag: "wx" });
		try {
			await rename(temporary, full);
		} finally {
			await unlink(temporary).catch(() => undefined);
		}
	}
	return { path, changed: true };
}

function resolveDependencies(
	dependencies: KnowledgeLayoutDependencies,
): Required<KnowledgeLayoutDependencies> {
	const containedFile = dependencies.containedFile ?? containedVaultFile;
	return {
		containedFile,
		createOnly: dependencies.createOnly ?? createVaultFileOnly,
		updateNavigation:
			dependencies.updateNavigation ??
			((vault, path, heading, body) => updateVaultNavigation(vault, path, heading, body, containedFile)),
	};
}

export async function initializeSharedNavigation(
	vault: string,
	dependencies: KnowledgeLayoutDependencies = {},
): Promise<void> {
	const { containedFile, createOnly, updateNavigation } = resolveDependencies(dependencies);
	for (const directory of ["Wiki", "Inbox"])
		await mkdir(await containedFile(vault, directory), { recursive: true });
	await createOnly(
		await containedFile(vault, "Wiki/Index.md"),
		"# Research Wiki\n\n这里维护跨项目的主题地图。先阅读相关主题，再沿来源查证；不要把目录未命中当成没有知识。\n\n<!-- pi-agent:managed:start -->\n<!-- pi-agent:managed:end -->\n\n## Human review\n",
	);
	await createOnly(
		await containedFile(vault, "Inbox/Index.md"),
		"# Inbox\n\n待整理、待核验的输入。这里的内容不是已确认结论。\n\n## Human review\n",
	);
	await updateNavigation(
		vault,
		"Home.md",
		"# Research Vault",
		"- [[Wiki/Index]] — 共享主题与阅读路线\n- [[Library/Index]] — 文献、方法与可复用知识\n- [[Projects/Index]] — 项目背景与证据链\n- [[Inbox/Index]] — 待整理资料\n\nWiki 是导航与综合认识，不代替原始证据。人工复核与冲突状态必须一起阅读。",
	);
}

export async function initializeProjectContext(
	vault: string,
	project: string,
	dependencies: KnowledgeLayoutDependencies = {},
): Promise<void> {
	if (!PROJECT_PATTERN.test(project)) throw new Error("Invalid project identifier");
	const { containedFile, createOnly } = resolveDependencies(dependencies);
	await createOnly(
		await containedFile(vault, `Projects/${project}/Context.md`),
		`---\ntype: project-context\nproject: ${JSON.stringify(project)}\n---\n\n# ${project}\n\n## 研究目标\n尚待用户确认。\n\n## 适用范围与限制\n尚待确认。\n\n## 既有决策\n参见本项目的 Decisions 与 Runs。\n\n## Human review\n`,
	);
}
