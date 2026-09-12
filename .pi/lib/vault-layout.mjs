import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { link, lstat, mkdir, realpath, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { getVaultProfile } from "./vault-profiles.mjs";

export const LAYOUT = JSON.parse(readFileSync(new URL("./vault-layout.json", import.meta.url), "utf8"));
export const MANAGED_START = "<!-- pi-agent:managed:start -->";
export const MANAGED_END = "<!-- pi-agent:managed:end -->";

export function containsPath(root, target) {
	const rel = relative(root, target);
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

export async function canonicalPath(path) {
	try {
		return await realpath(path);
	} catch (error) {
		if (error.code !== "ENOENT" || dirname(path) === path) throw error;
		return join(await canonicalPath(dirname(path)), basename(path));
	}
}

export async function validateVaultPath(input, excluded = []) {
	if (typeof input !== "string" || !input.trim()) throw new Error("Vault path is required");
	if (input.split(/[\\/]/).includes("..")) throw new Error("Vault path must not contain traversal");
	const path = await canonicalPath(resolve(input.trim()));
	if (path === parse(path).root || /^[a-z]:[\\/]*$/i.test(input))
		throw new Error("Vault cannot be a filesystem root");
	for (const other of excluded.filter(Boolean)) {
		const forbidden = await canonicalPath(resolve(other));
		if (containsPath(path, forbidden) || containsPath(forbidden, path))
			throw new Error("Vault must be independent from workspace, results and product code");
	}
	try {
		if (!(await lstat(path)).isDirectory()) throw new Error("Vault must be a directory");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	return path;
}

export async function containedFile(root, path) {
	const target = resolve(root, path);
	if (!containsPath(root, target) || !containsPath(root, await canonicalPath(target)))
		throw new Error("Path must stay inside Vault");
	return target;
}

export function renderTemplate(template, values = {}) {
	const fields = { uuid: randomUUID(), date: new Date().toISOString(), ...values };
	const rendered = template.replace(/\{\{([a-z_]+)\}\}/g, (match, key) => fields[key] ?? match);
	if (template.includes("id: pi-<stable-id>"))
		return rendered
			.replace("id: pi-<stable-id>", `id: pi-${fields.uuid}`)
			.replace('project: ""', `project: ${JSON.stringify(fields.project_slug || "")}`);
	return rendered;
}

export async function createOnly(path, content) {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
	try {
		await link(temporary, path);
		return true;
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		const existing = await lstat(path);
		if (!existing.isFile() || existing.isSymbolicLink())
			throw new Error(`Expected a regular Vault file: ${path}`);
		return false;
	} finally {
		await unlink(temporary);
	}
}

export async function initializeVaultLayout(
	input,
	{ excluded = [], project = null, profile = "hybrid" } = {},
) {
	const vault = await validateVaultPath(input, excluded);
	if (project !== null && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project))
		throw new Error("Invalid project slug");
	const selected = getVaultProfile(profile);
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
	// Validate every destination before any filesystem mutation.
	for (const dir of directories) await containedFile(vault, dir);
	const notes = Object.fromEntries(
		Object.entries(LAYOUT.templates).map(([name, type]) => [
			`Templates/${name}.md`,
			LAYOUT.noteTemplate.replace("{{type}}", type),
		]),
	);
	const index = (title) => `# ${title}\n\n${MANAGED_START}\n${MANAGED_END}\n\n## Human review\n`;
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
	for (const dir of directories) await mkdir(join(vault, dir), { recursive: true });
	for (const [file, content] of Object.entries(notes)) await createOnly(join(vault, file), content);
	return {
		vault,
		directories: directories.map((dir) => join(vault, dir)),
		templateVersion: LAYOUT.version,
		profile: selected,
	};
}
