import { randomUUID } from "node:crypto";
import {
	link,
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type VaultProfileId = "project" | "literature" | "hybrid";

export type VaultProfile = {
	id: VaultProfileId;
	projectTypes: readonly string[];
	libraryTypes: readonly string[];
};

export const VAULT_PROFILES: Record<VaultProfileId, VaultProfile> = {
	project: {
		id: "project",
		projectTypes: [
			"Questions",
			"Concepts",
			"Entities",
			"Papers",
			"Sources",
			"Evidence",
			"Claims",
			"Decisions",
			"Runs",
			"Artifacts",
			"Wiki",
		],
		libraryTypes: ["Papers", "Methods", "Software", "Ideas", "Explainers"],
	},
	literature: {
		id: "literature",
		projectTypes: ["Questions", "Papers", "Evidence", "Claims", "Runs", "Wiki"],
		libraryTypes: ["Papers", "Methods", "Concepts", "Software", "Entities", "Ideas", "Explainers"],
	},
	hybrid: {
		id: "hybrid",
		projectTypes: [
			"Questions",
			"Concepts",
			"Entities",
			"Papers",
			"Sources",
			"Evidence",
			"Claims",
			"Decisions",
			"Runs",
			"Artifacts",
			"Wiki",
		],
		libraryTypes: ["Papers", "Methods", "Concepts", "Software", "Entities", "Ideas", "Explainers"],
	},
};

export const DEFAULT_VAULT_PROFILE: VaultProfileId = "hybrid";
export const SUBAGENT_MCP_POLICIES = ["none", "read-local"] as const;

export function getVaultProfile(id: unknown = DEFAULT_VAULT_PROFILE): VaultProfile {
	if (typeof id !== "string" || !(id in VAULT_PROFILES)) throw new Error(`Unknown knowledge profile: ${id}`);
	return VAULT_PROFILES[id as VaultProfileId];
}

const LAYOUT = {
	version: 3,
	templates: {
		Project: "project",
		Question: "question",
		Source: "source",
		Claim: "claim",
		Evidence: "evidence",
		Run: "run",
	},
	noteTemplate:
		'---\nid: "pi-{{uuid}}"\ntype: {{type}}\nproject: "{{project_slug}}"\nstatus: draft\ncreated: "{{date}}"\nupdated: "{{date}}"\ntags: []\n---\n\n# {{title}}\n\n<!-- pi-agent:managed:start -->\n{{project_content}}\n<!-- pi-agent:managed:end -->\n\n## Human review\n',
} as const;

export const MANAGED_START = "<!-- pi-agent:managed:start -->";
export const MANAGED_END = "<!-- pi-agent:managed:end -->";

function containsPath(root: string, target: string): boolean {
	const rel = relative(resolve(root), resolve(target));
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

async function canonicalPath(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(path) === path) throw error;
		return join(await canonicalPath(dirname(path)), basename(path));
	}
}

export async function containedFile(root: string, path: string): Promise<string> {
	const target = resolve(root, path);
	if (!containsPath(root, target) || !containsPath(root, await canonicalPath(target)))
		throw new Error("Path must stay inside Vault");
	return target;
}

async function validateVaultPath(input: string, excluded: readonly string[] = []): Promise<string> {
	if (typeof input !== "string" || !input.trim()) throw new Error("Vault path is required");
	if (input.split(/[\\/]/).includes("..")) throw new Error("Vault path must not contain traversal");
	const path = await canonicalPath(resolve(input.trim()));
	if (path === resolve(path, "..") || /^[a-z]:[\\/]*$/i.test(input))
		throw new Error("Vault cannot be a filesystem root");
	for (const other of excluded.filter(Boolean)) {
		const forbidden = await canonicalPath(resolve(other));
		if (containsPath(path, forbidden) || containsPath(forbidden, path))
			throw new Error("Vault must be independent from workspace, results and product code");
	}
	try {
		if (!(await stat(path)).isDirectory()) throw new Error("Vault must be a directory");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return path;
}

async function createOnly(path: string, content: string): Promise<boolean> {
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
		await unlink(temporary).catch(() => {});
	}
}

export async function initializeVaultLayout(
	input: string,
	options: { excluded?: readonly string[]; project?: string | null; profile?: unknown } = {},
) {
	const vault = await validateVaultPath(input, options.excluded ?? []);
	const project = options.project ?? null;
	if (project !== null && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project))
		throw new Error("Invalid project slug");
	const selected = getVaultProfile(options.profile);
	const directories = [
		"Projects",
		"Templates",
		"Indexes",
		"Attachments",
		".obsidian",
		...selected.libraryTypes.map((type) => `Library/${type}`),
		...selected.projectTypes.map((type) => `Projects/_template/${type}`),
		...(project ? selected.projectTypes.map((type) => `Projects/${project}/${type}`) : []),
	];
	for (const directory of directories) await containedFile(vault, directory);
	const notes: Record<string, string> = Object.fromEntries(
		Object.entries(LAYOUT.templates).map(([name, type]) => [
			`Templates/${name}.md`,
			LAYOUT.noteTemplate.replace("{{type}}", type),
		]),
	);
	const index = (title: string) => `# ${title}\n\n${MANAGED_START}\n${MANAGED_END}\n\n## Human review\n`;
	Object.assign(notes, {
		"Home.md":
			"# Pi Research Vault\n\n- [[Projects/Index]]\n- [[Indexes/Knowledge]]\n- [[Library/Index]]\n\n## Human review\n",
		"Projects/Index.md": index("Projects"),
		"Indexes/Projects.md": index("Projects"),
		"Indexes/Knowledge.md": index("Knowledge"),
		"Library/Index.md": index("Library"),
		"Projects/_template/Index.md": notes["Templates/Project.md"],
		".obsidian/app.json": `${JSON.stringify(
			{ useMarkdownLinks: false, newLinkFormat: "absolute", attachmentFolderPath: "Attachments" },
			null,
			2,
		)}\n`,
		".obsidian/community-plugins.json": "[]\n",
	});
	for (const file of Object.keys(notes)) await containedFile(vault, file);
	for (const directory of directories) await mkdir(join(vault, directory), { recursive: true });
	for (const [file, content] of Object.entries(notes)) await createOnly(join(vault, file), content);
	return {
		vault,
		directories: directories.map((directory) => join(vault, directory)),
		templateVersion: LAYOUT.version,
		profile: selected,
	};
}

async function readText(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function writeManagedIndex(path: string, heading: string, body: string): Promise<void> {
	const original = (await readText(path)) ?? `${heading}\n\n## Human review\n\n`;
	const start = original.indexOf(MANAGED_START);
	const end = original.indexOf(MANAGED_END);
	const block = `${MANAGED_START}\n${body.trim()}\n${MANAGED_END}`;
	let updated: string;
	if (start !== -1 || end !== -1) {
		if (start === -1 || end < start) throw new Error(`Invalid managed index markers: ${path}`);
		updated = original.slice(0, start) + block + original.slice(end + MANAGED_END.length);
	} else {
		const review = original.search(/^## Human review\s*$/m);
		updated =
			review < 0
				? `${original}${original.endsWith("\n") ? "\n" : "\n\n"}${block}\n`
				: `${original.slice(0, review)}${block}\n\n${original.slice(review)}`;
	}
	if (updated === original) return;
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	await writeFile(temporary, updated, "utf8");
	await rename(temporary, path);
}

async function childEntries(directory: string) {
	try {
		return await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

async function noteLinks(vault: string, directory: string): Promise<string[]> {
	const links: string[] = [];
	for (const entry of await childEntries(directory)) {
		const file = join(directory, entry.name);
		if (entry.isDirectory()) links.push(...(await noteLinks(vault, file)));
		else if (entry.isFile() && entry.name.endsWith(".md")) {
			const target = relative(vault, file).replaceAll(sep, "/").slice(0, -3);
			if (!/[\]|#\r\n]/.test(target)) links.push(`- [[${target}]]`);
		}
	}
	return links.sort((a, b) => a.localeCompare(b));
}

async function categorizedLinks(vault: string, root: string, types: readonly string[]): Promise<string> {
	const sections: string[] = [];
	for (const type of types) {
		const directory = await containedFile(vault, `${root}/${type}`);
		const links = await noteLinks(vault, directory);
		sections.push(`## ${type}\n\n${links.join("\n")}`.trimEnd());
	}
	return sections.join("\n\n");
}

function validateProject(project: string): string {
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(project))
		throw new Error("project must be a non-reserved lowercase kebab-case slug");
	return project;
}

export async function refreshProjectIndexes(
	vault: string,
	options: { project?: string | null; profile?: unknown } = {},
) {
	const project = options.project ?? null;
	if (project !== null) validateProject(project);
	const profile = getVaultProfile(options.profile);
	const projectRoot = await containedFile(vault, "Projects");
	const projects = (await childEntries(projectRoot))
		.filter((entry) => entry.isDirectory() && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name))
		.map((entry) => entry.name)
		.sort();
	const projectIndexes: string[] = [];
	for (const slug of projects) {
		const index = await containedFile(vault, `Projects/${slug}/Index.md`);
		if (project === null || project === slug || (await readText(index)) === null) {
			const body = await categorizedLinks(vault, `Projects/${slug}`, profile.projectTypes);
			await writeManagedIndex(
				index,
				`---\ntype: project\nproject: ${JSON.stringify(slug)}\n---\n\n# ${slug}\n\n[[Home]] | [[Projects/Index]] | [[Library/Index]]`,
				body,
			);
		}
		projectIndexes.push(index);
	}
	const links = projects.map((slug) => `- [[Projects/${slug}/Index]]`).join("\n");
	const projectsIndex = await containedFile(vault, "Projects/Index.md");
	const legacyIndex = await containedFile(vault, "Indexes/Projects.md");
	const libraryIndex = await containedFile(vault, "Library/Index.md");
	await writeManagedIndex(projectsIndex, "# Projects\n\n[[Home]]", links);
	await writeManagedIndex(legacyIndex, "# Projects", links);
	await writeManagedIndex(
		libraryIndex,
		"# Library\n\n[[Home]]",
		await categorizedLinks(vault, "Library", profile.libraryTypes),
	);
	const knowledgeIndex = await containedFile(vault, "Indexes/Knowledge.md");
	await writeManagedIndex(
		knowledgeIndex,
		"# Knowledge",
		[links, "[[Library/Index]]"].filter(Boolean).join("\n\n"),
	);
	return { projectsIndex, legacyIndex, libraryIndex, knowledgeIndex, projectIndexes };
}
