import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	initializeVault,
	loadWorkspaceConfig,
	saveWorkspaceConfig,
} from "../extensions/workspace-config.mjs";
import { knowledgeDirectory, readKnowledgeBinding, saveKnowledgeBinding } from "./knowledge/config.mjs";
import { initializeProjectContext, initializeSharedNavigation } from "./knowledge/layout.mjs";
import { getKnowledgeService, notifyKnowledgeChange } from "./knowledge/service.mjs";
import { normalizeSourceLinks, onlineSourceLink } from "./knowledge/source-links.mjs";
import { renderTemplate } from "./vault-layout.mjs";
import { getVaultProfile, listVaultProfiles } from "./vault-profiles.mjs";

export const SERVER_NAME = "research-obsidian";
export const OBSIDIAN_READ_TOOLS = [
	"read_note",
	"read_multiple_notes",
	"search_notes",
	"list_directory",
	"get_notes_info",
	"get_frontmatter",
	"get_vault_stats",
	"list_all_tags",
	"wiki_link",
	"get_note_outline",
	"read_note_lines",
];

const MANAGED_START = "<!-- pi-agent:managed:start -->";
const MANAGED_END = "<!-- pi-agent:managed:end -->";
const PROJECT_TEMPLATE = `---\ntype: project\nproject: "{{project_slug}}"\ntitle: {{project_title_yaml}}\ncreated_at: "{{created_at}}"\n---\n\n# {{project_title}}\n\n[[Home]] | [[Projects/Index]] | [[Library/Index]]\n\n## Research question\n\n## Goals\n\n## Next steps\n\n${MANAGED_START}\n{{project_content}}\n${MANAGED_END}\n\n## Human review\n\n`;
const vaultUpdates = new Map();

function validateProject(project) {
	if (
		typeof project !== "string" ||
		!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project) ||
		/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(project)
	) {
		throw new Error("project must be a non-reserved lowercase kebab-case slug");
	}
	return project;
}

async function configuredVault(cwd) {
	const { obsidianVault } = await loadWorkspaceConfig(cwd);
	if (!obsidianVault) throw new Error("Obsidian vault must be configured first");
	// Summaries may be the first writer in a freshly configured test or vault;
	// initializeVault will add the directory structure below.
	if (!knowledgeDirectory()) await mkdir(obsidianVault, { recursive: true });
	return canonical(obsidianVault);
}

async function vaultPath(vault, ...parts) {
	const file = join(vault, ...parts);
	if (!contains(vault, await canonical(file)))
		throw new Error("Project path must stay inside the configured vault");
	return file;
}

// Serialize updates for one vault so parallel project creation cannot lose links.
async function updateVault(cwd, operation) {
	const vault = await configuredVault(cwd);
	const previous = vaultUpdates.get(vault) || Promise.resolve();
	const next = previous.catch(() => {}).then(() => operation(vault));
	vaultUpdates.set(vault, next);
	try {
		return await next;
	} finally {
		if (vaultUpdates.get(vault) === next) vaultUpdates.delete(vault);
	}
}

async function readText(file) {
	try {
		return await readFile(file, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

async function writeManagedIndex(file, heading, body) {
	const original = (await readText(file)) ?? `${heading}\n\n## Human review\n\n`;
	const start = original.indexOf(MANAGED_START);
	const end = original.indexOf(MANAGED_END);
	const block = `${MANAGED_START}\n${body.trim()}\n${MANAGED_END}`;
	let updated;
	if (start !== -1 || end !== -1) {
		if (
			start === -1 ||
			end < start ||
			original.indexOf(MANAGED_START, start + 1) !== -1 ||
			original.indexOf(MANAGED_END, end + 1) !== -1
		) {
			throw new Error(`Invalid managed index markers: ${file}`);
		}
		updated = original.slice(0, start) + block + original.slice(end + MANAGED_END.length);
	} else {
		const review = original.search(/^## Human review\s*$/m);
		updated =
			review < 0
				? `${original}${original.endsWith("\n") ? "\n" : "\n\n"}${block}\n`
				: `${original.slice(0, review)}${block}\n\n${original.slice(review)}`;
	}
	if (updated === original) return;
	await mkdir(dirname(file), { recursive: true });
	const temporary = `${file}.${randomUUID()}.tmp`;
	await writeFile(temporary, updated, "utf8");
	await rename(temporary, file);
	if (knowledgeDirectory()) await notifyKnowledgeChange(file);
}

async function childEntries(directory) {
	try {
		return await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
}

async function noteLinks(vault, directory) {
	const links = [];
	for (const entry of await childEntries(directory)) {
		const file = join(directory, entry.name);
		if (entry.isDirectory()) links.push(...(await noteLinks(vault, file)));
		else if (entry.isFile() && entry.name.endsWith(".md")) {
			const target = relative(vault, file).replaceAll(sep, "/").slice(0, -3);
			if (!/[[\]|#\r\n]/.test(target)) links.push(`- [[${target}]]`);
		}
	}
	return links.sort((a, b) => a.localeCompare(b));
}

async function categorizedLinks(vault, root, types) {
	const sections = [];
	for (const type of types) {
		const directory = await vaultPath(vault, root, type);
		const links = await noteLinks(vault, directory);
		sections.push(`## ${type}\n\n${links.join("\n")}`.trimEnd());
	}
	return sections.join("\n\n");
}

function renderProjectTemplate(template, project, title, body) {
	return renderTemplate(template, {
		project_slug: project,
		title,
		project_title: title,
		project_title_yaml: JSON.stringify(title),
		created_at: new Date().toISOString(),
		project_content: body,
	});
}

async function ensureTemplate(vault) {
	const template = await vaultPath(vault, "Templates", "Project.md");
	await createOnly(template, PROJECT_TEMPLATE);
	return template;
}

async function refreshIndexes(vault, project = null, refreshAll = false, profileId = "hybrid") {
	if (knowledgeDirectory()) {
		const binding = await readKnowledgeBinding();
		if (binding?.vault === vault) {
			const service = await getKnowledgeService(binding);
			const index = await service.request("enqueueNavigation", { project });
			return { maintenance: "queued", scope: "application", index };
		}
	}
	const profile = getVaultProfile(profileId);
	const projectTypes = profile.projectTypes;
	const libraryTypes = profile.libraryTypes;
	const projectRoot = await vaultPath(vault, "Projects");
	const projects = (await childEntries(projectRoot))
		.filter((entry) => entry.isDirectory() && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name))
		.map((entry) => entry.name)
		.sort();
	const projectIndexes = [];
	for (const slug of projects) {
		const index = await vaultPath(vault, "Projects", slug, "Index.md");
		if (refreshAll || project === slug || (await readText(index)) === null) {
			const body = await categorizedLinks(vault, `Projects/${slug}`, projectTypes);
			await writeManagedIndex(
				index,
				`---\ntype: project\nproject: ${JSON.stringify(slug)}\n---\n\n# ${slug}\n\n[[Home]] | [[Projects/Index]] | [[Library/Index]]`,
				body,
			);
		}
		projectIndexes.push(index);
	}
	const links = projects.map((slug) => `- [[Projects/${slug}/Index]]`).join("\n");
	const projectsIndex = await vaultPath(vault, "Projects", "Index.md");
	const legacyIndex = await vaultPath(vault, "Indexes", "Projects.md");
	const libraryIndex = await vaultPath(vault, "Library", "Index.md");
	await writeManagedIndex(projectsIndex, "# Projects\n\n[[Home]]", links);
	await writeManagedIndex(legacyIndex, "# Projects", links);
	await writeManagedIndex(
		libraryIndex,
		"# Library\n\n[[Home]]",
		await categorizedLinks(vault, "Library", libraryTypes),
	);
	const knowledgeIndex = await vaultPath(vault, "Indexes", "Knowledge.md");
	await writeManagedIndex(
		knowledgeIndex,
		"# Knowledge",
		[links, "[[Library/Index]]"].filter(Boolean).join("\n\n"),
	);
	return { projectsIndex, legacyIndex, libraryIndex, knowledgeIndex, projectIndexes };
}

export async function installProjectTemplate({ cwd = process.cwd() } = {}) {
	const config = await loadWorkspaceConfig(cwd);
	const profile = getVaultProfile(config.knowledgeProfile).id;
	return updateVault(cwd, async (vault) => ({
		vault,
		template: await ensureTemplate(vault),
		...(await refreshIndexes(vault, null, true, profile)),
	}));
}

export async function refreshProjectIndexes({ cwd = process.cwd(), project = null } = {}) {
	if (project !== null) validateProject(project);
	const config = await loadWorkspaceConfig(cwd);
	const profile = getVaultProfile(config.knowledgeProfile).id;
	return updateVault(cwd, async (vault) => ({
		vault,
		...(await refreshIndexes(vault, project, project === null, profile)),
	}));
}

export async function publishSourceNote({ cwd = process.cwd(), runDir, entry }) {
	const config = await loadWorkspaceConfig(cwd);
	if (!config.obsidianVault) return { obsidian_note: null, knowledge_status: "not-configured" };
	if (config.knowledgeDepositMode === "run-only")
		return { obsidian_note: null, knowledge_status: "disabled-run-only" };
	if (entry.status !== "downloaded" || !/^[a-f0-9]{64}$/.test(entry.sha256))
		throw new Error("Only verified downloads can be indexed");
	if (
		!contains(await canonical(config.resultsRoot), await canonical(runDir)) ||
		!contains(await canonical(runDir), await canonical(entry.path))
	)
		throw new Error("Source must remain inside its research run");
	if (
		createHash("sha256")
			.update(await readFile(entry.path))
			.digest("hex") !== entry.sha256
	)
		throw new Error("Source hash changed before indexing");
	const metadata = await readJson(join(runDir, "metadata.json"));
	const project = validateProject(metadata.project || "research-workbench");
	const category = ["papers", "supplementary"].includes(entry.category) ? "Papers" : "Software";
	const title = String(entry.metadata?.title || basename(entry.path))
		.replace(/[<>\r\n]/g, " ")
		.trim()
		.slice(0, 200);
	const slug =
		(title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 64) || entry.category) +
		"-" +
		entry.sha256.slice(0, 16);
	return updateVault(cwd, async (vault) => {
		const note = await vaultPath(vault, "Library", category, `${slug}.md`);
		const projectNote = await vaultPath(vault, "Projects", project, category, `${slug}.md`);
		const provenance = JSON.stringify(
			{
				url: entry.url,
				final_url: entry.final_url,
				downloaded_at: entry.downloaded_at,
				sha256: entry.sha256,
				size_bytes: entry.size_bytes,
				metadata: entry.metadata,
			},
			null,
			2,
		).replaceAll("<", "\\u003c");
		const online = onlineSourceLink(entry.final_url || entry.url, "官方/原始来源");
		const doi = entry.metadata?.doi ? onlineSourceLink(`https://doi.org/${entry.metadata.doi}`, "DOI") : "";
		const chapters = (entry.manualCoverage?.candidates || [])
			.map((c) => `- ${onlineSourceLink(c.url, c.title || c.url)}`)
			.join("\n");
		const body = `[[Projects/${project}/Index]] | [[Library/Index]]\n\n${online}${doi ? ` | ${doi}` : ""}\n\n[Original file](${pathToFileURL(entry.path).href})\n\n## Provenance\n\n\`\`\`json\n${provenance}\n\`\`\`\n\n## Evidence status\n\nArchived source only; scientific claims have not been independently verified. This note is a source record, not a completed paper explanation or command reference.\n\n${entry.manualCoverage ? `Manual coverage: ${entry.manualCoverage.status}. Commands and parameters require reading the appropriate reference chapters; a landing page is not a complete manual.` : ""}${chapters ? `\n\n## Reference chapters (not yet archived)\n\n${chapters}` : ""}`;
		await writeManagedIndex(
			note,
			`---\nid: pi-${randomUUID()}\ntype: ${category === "Papers" ? "paper" : "software"}\nsource_sha256: ${entry.sha256}\n---\n\n# ${title}`,
			body,
		);
		await writeManagedIndex(
			projectNote,
			`# ${title}`,
			`[[Library/${category}/${slug}]]\n\n[Run files](${pathToFileURL(runDir).href})`,
		);
		return {
			obsidian_note: note,
			project_note: projectNote,
			knowledge_status: "written",
			indexes: await refreshIndexes(vault, project),
		};
	});
}

export async function publishExplainer({
	cwd = process.cwd(),
	project,
	topicId,
	title,
	artifactPath,
	summary = "",
	sources = [],
} = {}) {
	const config = await loadWorkspaceConfig(cwd);
	if (!config.obsidianVault) throw new Error("Obsidian vault must be configured first");
	if (config.knowledgeDepositMode === "run-only")
		return { knowledge_status: "disabled-run-only", scientificallyVerified: false };
	project = validateProject(project || config.knowledgeProjectId || "research-workbench");
	topicId = String(topicId || "")
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 96);
	if (!topicId) throw new Error("Explainer topic_id must resolve to a non-empty kebab-case id");
	title = [...String(title || "")]
		.map((char) => (char.charCodeAt(0) < 32 || "<>".includes(char) ? " " : char))
		.join("")
		.trim()
		.slice(0, 200);
	if (!title) throw new Error("Explainer title is required");
	if (typeof artifactPath !== "string" || !artifactPath.trim())
		throw new Error("Explainer result_file is required");
	const root = await canonical(config.resultsRoot),
		artifact = await realpath(resolve(cwd, artifactPath));
	if (!contains(root, artifact))
		throw new Error("Explainer file must stay inside the configured results root");
	const info = await stat(artifact);
	if (!info.isFile() || info.size < 1 || info.size > 4 * 1024 * 1024)
		throw new Error("Explainer must be a regular file between 1 byte and 4 MiB");
	const ext = /\.md$/i.test(artifact) ? ".md" : /\.html?$/i.test(artifact) ? ".html" : null;
	if (!ext) throw new Error("Explainer must be HTML or Markdown");
	const bytes = await readFile(artifact),
		digest = createHash("sha256").update(bytes).digest("hex");
	const stamp = new Date()
		.toISOString()
		.replace(/[-:.TZ]/g, "")
		.slice(0, 14);
	return updateVault(cwd, async (vault) => {
		const attachmentRel = `Attachments/Explainers/${topicId}/${stamp}-${digest.slice(0, 12)}${ext}`;
		const attachment = await vaultPath(vault, ...attachmentRel.split("/"));
		await mkdir(dirname(attachment), { recursive: true });
		try {
			await writeFile(attachment, bytes, { flag: "wx" });
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
		}
		const note = await vaultPath(vault, "Library", "Explainers", `${topicId}.md`);
		const previous = (await readText(note)) || "";
		const oldVersions = (previous.match(/^- .*?\[打开讲解\]\([^\n]+\)[^\n]*$/gm) || []).slice(-19);
		const relLink = `../../${attachmentRel}`;
		const sourceLines = sources
			.slice(0, 12)
			.map(
				(source) =>
					`- [[${String(source.path).replace(/\.md$/, "")}]] · lines ${source.startLine}–${source.endLine} · sha256 ${source.hash}`,
			)
			.join("\n");
		const versionLine = `- ${new Date().toISOString()} · [打开讲解](${relLink}) · sha256 ${digest}`;
		const body = [
			"> [!warning] 展示层，不是科学证据\n> 此页面由 Show Me / 模型根据已读来源生成，用于解释与导航。不能作为 Wiki 提案或科研结论的证据来源。",
			`## 最新讲解\n\n[打开 Show Me 页面](${relLink})\n\n${String(summary || "")
				.trim()
				.slice(0, 4000)}`,
			sourceLines ? `## 本轮依据\n\n${sourceLines}` : "",
			`## Versions\n\n${[...oldVersions, versionLine].join("\n")}`,
		]
			.filter(Boolean)
			.join("\n\n");
		const heading = `---\nid: pi-${randomUUID()}\ntype: explainer\ntopic_id: ${JSON.stringify(topicId)}\nproject: ${JSON.stringify(project)}\nstatus: generated\nevidence_role: presentation-only\nupdated: ${JSON.stringify(new Date().toISOString())}\n---\n\n# ${title}`;
		await writeManagedIndex(note, heading, body);
		const indexes = await refreshIndexes(vault, project, false, config.knowledgeProfile);
		return {
			note,
			attachment,
			attachment_relative: attachmentRel,
			topicId,
			project,
			sha256: digest,
			bytes: info.size,
			sourceCount: sources.length,
			knowledge_status: "written",
			evidenceRole: "presentation-only",
			scientificallyVerified: false,
			indexes,
		};
	});
}

const hasControlCharacter = (value) => [...String(value)].some((char) => char.charCodeAt(0) < 32);

export async function createObsidianProject({ cwd = process.cwd(), project, title = project } = {}) {
	validateProject(project);
	const config = await loadWorkspaceConfig(cwd);
	const profile = getVaultProfile(config.knowledgeProfile);
	if (typeof title !== "string" || !title.trim() || title.length > 200 || hasControlCharacter(title))
		throw new Error("Project title must be a single non-empty line of at most 200 characters");
	return updateVault(cwd, async (vault) => {
		const template = await ensureTemplate(vault);
		const directory = await vaultPath(vault, "Projects", project);
		const index = await vaultPath(vault, "Projects", project, "Index.md");
		const created = (await readText(index)) === null;
		for (const type of profile.projectTypes)
			await mkdir(await vaultPath(vault, "Projects", project, type), { recursive: true });
		if (created) {
			const body = await categorizedLinks(vault, `Projects/${project}`, profile.projectTypes);
			await createOnly(
				index,
				renderProjectTemplate(await readFile(template, "utf8"), project, title.trim(), body),
			);
			const copyDefaults = async (parts = []) => {
				const source = await vaultPath(vault, "Projects", "_template", ...parts);
				for (const entry of await childEntries(source)) {
					if (entry.isSymbolicLink()) throw new Error("Project template symlinks are not allowed");
					if (!parts.length && entry.name === "Index.md") continue;
					const next = [...parts, entry.name];
					const target = await vaultPath(vault, "Projects", project, ...next);
					if (entry.isDirectory()) {
						await mkdir(target, { recursive: true });
						await copyDefaults(next);
					} else if (entry.isFile() && entry.name.endsWith(".md")) {
						await createOnly(
							target,
							renderProjectTemplate(
								await readFile(join(source, entry.name), "utf8"),
								project,
								title.trim(),
								"",
							),
						);
					}
				}
			};
			await copyDefaults();
		}
		if (knowledgeDirectory()) await initializeProjectContext(vault, project);
		const indexes = await refreshIndexes(vault, project, false, config.knowledgeProfile);
		return { vault, project, directory, index, template, created, ...indexes };
	});
}

async function readJson(file) {
	try {
		const data = JSON.parse(await readFile(file, "utf8"));
		if (!data || typeof data !== "object" || Array.isArray(data))
			throw new Error(`Invalid JSON object: ${file}`);
		return data;
	} catch (error) {
		if (error.code === "ENOENT") return {};
		throw error;
	}
}

async function atomicJson(file, data) {
	await mkdir(dirname(file), { recursive: true });
	const temp = `${file}.${randomUUID()}.tmp`;
	await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	await rename(temp, file);
}

async function createOnly(file, content) {
	await mkdir(dirname(file), { recursive: true });
	try {
		await writeFile(file, content, { encoding: "utf8", flag: "wx" });
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
	}
}

// Resolve existing ancestors as well as the final component to catch junctions.
async function canonical(file) {
	try {
		return await realpath(file);
	} catch (error) {
		if (error.code !== "ENOENT" || dirname(file) === file) throw error;
		return join(await canonical(dirname(file)), basename(file));
	}
}

function contains(root, child) {
	const rel = relative(root, child);
	return !rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

export function researchSetupOptions() {
	return {
		profiles: listVaultProfiles(),
		depositModes: [
			{ id: "run-only", label: "仅运行摘要", description: "只沉淀完成的 run summary，最保守。" },
			{
				id: "verified",
				label: "已验证证据（推荐）",
				description: "沉淀运行摘要、已归档来源、证据、支持性 claim 与研究决策。",
			},
			{
				id: "rich",
				label: "丰富知识沉淀",
				description: "在 verified 基础上，也沉淀可跨项目复用的概念/实体。",
			},
		],
		subagentMcpPolicies: [
			{ id: "none", label: "禁用", description: "子智能体不访问 Obsidian MCP。" },
			{
				id: "read-local",
				label: "只读本地知识库（推荐）",
				description: "子智能体可搜索/读取 Obsidian，但无法写入、移动或删除笔记。",
			},
		],
	};
}

function knowledgeSlug(title) {
	const normalized = String(title || "")
		.normalize("NFKC")
		.trim();
	if (!normalized || normalized.length > 200 || hasControlCharacter(normalized))
		throw new Error("Knowledge title must be a single non-empty line");
	const ascii = normalized
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 72);
	return ascii || `note-${createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;
}

export async function depositKnowledge({
	cwd = process.cwd(),
	project,
	type,
	title,
	markdown,
	sourceLinks = [],
	status = "verified",
	targetScope = "project",
} = {}) {
	const config = await loadWorkspaceConfig(cwd);
	if (!config.obsidianVault) throw new Error("Obsidian vault must be configured first");
	if (config.knowledgeDepositMode === "run-only")
		throw new Error("Knowledge deposition is disabled by run-only mode");
	project = validateProject(project || "research-workbench");
	const profile = getVaultProfile(config.knowledgeProfile);
	const kind = String(type || "").toLowerCase();
	if (knowledgeDirectory() && kind === "wiki")
		throw new Error(
			"Application Wiki changes require research_propose_wiki_update and user /obsidian-review; direct Wiki deposition is disabled",
		);
	const routes = {
		question: ["project", "Questions"],
		evidence: ["project", "Evidence"],
		claim: ["project", "Claims"],
		decision: ["project", "Decisions"],
		wiki: ["project", "Wiki"],
		paper: ["library", "Papers"],
		method: ["library", "Methods"],
		software: ["library", "Software"],
		entity: ["library", "Entities"],
		concept: ["library", "Concepts"],
	};
	const route = routes[kind];
	if (!route) throw new Error(`Unsupported knowledge type: ${type}`);
	if (["claim", "evidence"].includes(kind) && (!Array.isArray(sourceLinks) || sourceLinks.length === 0)) {
		throw new Error(`${kind} deposition requires at least one source link`);
	}
	if (["concept", "entity"].includes(kind) && config.knowledgeDepositMode !== "rich") {
		throw new Error(`${kind} deposition requires rich knowledge mode`);
	}
	let [scope, folder] = route;
	if (knowledgeDirectory() && kind === "wiki" && targetScope === "shared") scope = "shared";
	if (scope === "library" && !profile.libraryTypes.includes(folder)) {
		if (profile.projectTypes.includes(folder)) scope = "project";
		else throw new Error(`${folder} is not enabled by knowledge profile ${profile.id}`);
	}
	if (scope === "project" && !profile.projectTypes.includes(folder))
		throw new Error(`${folder} is not enabled by knowledge profile ${profile.id}`);
	const slug = knowledgeSlug(title);
	return updateVault(cwd, async (vault) => {
		if (!knowledgeDirectory()) await initializeVault(vault, project, config.knowledgeProfile);
		const relativeNote =
			scope === "shared"
				? join("Wiki", `${slug}.md`)
				: scope === "library"
					? join("Library", folder, `${slug}.md`)
					: join("Projects", project, folder, `${slug}.md`);
		const note = await vaultPath(vault, relativeNote);
		const normalizedSources = await normalizeSourceLinks(sourceLinks, {
			cwd,
			vault,
			resultsRoot: config.resultsRoot,
			project,
		});
		const links = normalizedSources.links.map((link) => `- ${link}`).join("\n");
		const body = [String(markdown || "").trim(), links ? `## Sources\n\n${links}` : ""]
			.filter(Boolean)
			.join("\n\n");
		const heading = `---\nid: pi-${randomUUID()}\ntype: ${kind}\nproject: ${JSON.stringify(project)}\nstatus: ${JSON.stringify(status)}\nupdated: ${JSON.stringify(new Date().toISOString())}\n---\n\n# ${String(title).trim()}`;
		await writeManagedIndex(note, heading, body);
		const indexes = await refreshIndexes(vault, project, false, config.knowledgeProfile);
		return {
			note,
			scope,
			type: kind,
			project,
			profile: profile.id,
			depositMode: config.knowledgeDepositMode,
			unresolvedSources: normalizedSources.unresolved,
			scientificallyVerified: false,
			indexes,
		};
	});
}

export async function obsidianStatus(cwd) {
	try {
		if (knowledgeDirectory()) {
			const binding = await readKnowledgeBinding();
			if (!binding) return { state: "needs-setup", vault: null, scope: "application" };
			try {
				if (!(await stat(binding.vault)).isDirectory()) throw new Error("not a directory");
			} catch {
				return { state: "missing-vault", vault: binding.vault, scope: "application" };
			}
			return {
				state: "ready",
				scope: "application",
				accessMode: "application-index",
				vault: binding.vault,
				vaultId: binding.vaultId,
				bindingRevision: binding.revision,
				profile: binding.profile,
				depositMode: binding.depositMode,
				subagentMcpPolicy: binding.subagentPolicy,
				home: join(binding.vault, "Home.md"),
				connectionVerified: false,
			};
		}
		const config = await loadWorkspaceConfig(cwd);
		const vault = config.obsidianVault;
		if (!vault) return { state: "needs-setup", vault: null };
		if (process.env.PI_RESEARCH_DESKTOP_CONFIG)
			return {
				state: config.mcpStatus === "connected" ? "ready" : config.mcpStatus || "missing-mcp",
				vault,
				server: SERVER_NAME,
			};
		try {
			await access(join(vault, ".obsidian"));
		} catch {
			return { state: "missing-vault", vault };
		}
		const mcp = await readJson(join(cwd, ".mcp.json"));
		const server = mcp.mcpServers?.[SERVER_NAME];
		if (!server || server.disabled || server.args?.at(-1) !== vault) return { state: "missing-mcp", vault };
		try {
			await access(server.args[0]);
			if (server.args[0].endsWith("vault-mcp-proxy.mjs")) await access(server.args[1]);
		} catch {
			return { state: "missing-server", vault };
		}
		const home = join(vault, "Home.md");
		return {
			state: "ready",
			vault,
			server: SERVER_NAME,
			profile: config.knowledgeProfile,
			depositMode: config.knowledgeDepositMode,
			subagentMcpPolicy: config.subagentMcpPolicy,
			home,
			uri: `obsidian://open?path=${encodeURIComponent(home.replaceAll("\\", "/"))}`,
		};
	} catch (error) {
		return { state: "config-error", error: error.message };
	}
}

// Resolve runtime code separately from ctx.cwd: a globally installed extension
// serves many projects, and those projects do not each contain its npm runtime.
export async function resolveObsidianRuntime({
	cwd,
	server,
	existing,
	installationRoot = fileURLToPath(new URL("../../", import.meta.url)),
}) {
	const runtimeFromConfig = (entry, root) => {
		const args = Array.isArray(entry?.args) ? entry.args : [];
		const path = typeof args[0] === "string" && args[0].endsWith("vault-mcp-proxy.mjs") ? args[1] : args[0];
		return typeof path === "string" ? { path: resolve(root, path), command: entry.command } : null;
	};
	const candidates = [];
	if (server) candidates.push({ path: resolve(cwd, server), command: existing?.command });
	else {
		candidates.push(runtimeFromConfig(existing, cwd));
		if (process.env.PI_OBSIDIAN_MCP_SERVER)
			candidates.push({ path: resolve(process.env.PI_OBSIDIAN_MCP_SERVER) });
		candidates.push({ path: join(cwd, ".pi/npm/node_modules/@bitbonsai/mcpvault/dist/server.js") });
		if (resolve(installationRoot) !== resolve(cwd)) {
			// Reuse only the installed extension's runtime location/launcher, never
			// another project's Vault, MCP permissions, environment, or credentials.
			const installed = await readJson(join(installationRoot, ".mcp.json"));
			candidates.push(runtimeFromConfig(installed.mcpServers?.[SERVER_NAME], installationRoot));
		}
		candidates.push({
			path: join(installationRoot, ".pi/npm/node_modules/@bitbonsai/mcpvault/dist/server.js"),
		});
		candidates.push({ path: join(installationRoot, "node_modules/@bitbonsai/mcpvault/dist/server.js") });
	}
	for (const candidate of candidates.filter(Boolean)) {
		try {
			if (!(await stat(candidate.path)).isFile()) continue;
			return {
				server: await realpath(candidate.path),
				command: candidate.command || process.env.PI_MCP_NODE_PATH || process.execPath,
			};
		} catch (error) {
			if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
		}
	}
	throw new Error(
		"MCPVault runtime was not found. Install/configure it for the workbench or set PI_OBSIDIAN_MCP_SERVER; no Vault was initialized.",
	);
}

export async function configureObsidian({
	cwd,
	vault,
	project = null,
	server,
	profile = "hybrid",
	depositMode = "verified",
	subagentMcpPolicy = "read-local",
	expectedRevision = null,
}) {
	if (process.env.PI_RESEARCH_DESKTOP_CONFIG)
		throw new Error("Use desktop settings to initialize or bind a Vault");
	if (typeof vault !== "string" || !vault.trim()) throw new Error("Vault path is required");
	cwd = await canonical(resolve(cwd));
	vault = await canonical(resolve(cwd, vault));
	if (contains(cwd, vault) || contains(vault, cwd))
		throw new Error("Vault must be independent from the code workspace");
	if (project !== null) validateProject(project);
	getVaultProfile(profile);
	if (!["run-only", "verified", "rich"].includes(depositMode))
		throw new Error("Invalid knowledge deposit mode");
	if (!["none", "read-local"].includes(subagentMcpPolicy)) throw new Error("Invalid subagent MCP policy");
	if (knowledgeDirectory()) {
		const current = await readKnowledgeBinding({ fresh: true });
		if (expectedRevision !== null && (current?.revision || 0) !== expectedRevision)
			throw new Error("Knowledge binding changed before setup; review again");
		const appDir = await canonical(knowledgeDirectory());
		if (contains(vault, appDir) || contains(appDir, vault))
			throw new Error("Vault must be independent from application indexes");
		await initializeVault(vault, project, profile);
		await initializeSharedNavigation(vault);
		const binding = await saveKnowledgeBinding(
			{ vault, profile, depositMode, subagentPolicy: subagentMcpPolicy },
			expectedRevision ?? (current?.revision || 0),
		);
		if (project) {
			await saveWorkspaceConfig(cwd, { knowledgeProjectId: project });
			await createObsidianProject({ cwd, project });
		}
		return {
			...(await obsidianStatus(cwd)),
			workspace: cwd,
			project,
			connectionVerified: false,
			reloadRequired: false,
			bindingRevision: binding.revision,
			rawMcpUnchanged: true,
		};
	}
	const mcpPath = join(cwd, ".mcp.json");
	const mcp = await readJson(mcpPath);
	if (mcp.mcpServers && (typeof mcp.mcpServers !== "object" || Array.isArray(mcp.mcpServers)))
		throw new Error("Invalid JSON mcpServers");
	const existing = mcp.mcpServers?.[SERVER_NAME];
	const runtime = await resolveObsidianRuntime({ cwd, server, existing });
	await initializeVault(vault, project, profile);
	await saveWorkspaceConfig(cwd, {
		obsidianVault: vault,
		knowledgeProfile: profile,
		knowledgeDepositMode: depositMode,
		subagentMcpPolicy,
	});
	mcp.mcpServers = {
		...mcp.mcpServers,
		[SERVER_NAME]: {
			...(existing && typeof existing === "object" ? existing : {}),
			command: runtime.command,
			args: [runtime.server, vault],
			cwd,
			disabled: false,
			lifecycle: existing?.lifecycle || "lazy",
			includeTools: OBSIDIAN_READ_TOOLS,
			vaultWritePolicy: "controlled-deposit-only",
		},
	};
	await atomicJson(mcpPath, mcp);
	if (project) await createObsidianProject({ cwd, project });
	await refreshProjectIndexes({ cwd });
	return {
		...(await obsidianStatus(cwd)),
		workspace: cwd,
		project,
		connectionVerified: false,
		reloadRequired: true,
	};
}
