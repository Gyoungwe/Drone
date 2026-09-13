// Human-facing host API; no model calls, no new approval tool.
import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadWorkspaceConfig } from "../../extensions/workspace-config.mjs";
import { inspectObsidianSetup, inspectSetupDirectory, resolveSetupVault } from "../obsidian-setup.mjs";
import { researchSetupOptions } from "../obsidian-workbench.mjs";
import { LAYOUT } from "../vault-layout.mjs";
import {
	knowledgeDirectory,
	projectIdentity,
	readKnowledgeBinding,
	withKnowledgeBinding,
} from "./config.mjs";
import { safeNotePath } from "./files.mjs";
import { runNavigationMaintenance } from "./maintenance.mjs";
import { getKnowledgeService } from "./service.mjs";
import { normalizeSourceLinks } from "./source-links.mjs";
import { setSpecialistSettings, specialistSettings } from "./specialist-host.mjs";
import { flowFor, invalidateKnowledgeUi } from "./ui-state.mjs";
import { decideWikiProposal, listWikiProposals, previewWikiProposal } from "./wiki-review.mjs";

const previews = new Map(),
	MAX_PREVIEWS = 64,
	maintenance = new Set(),
	semanticJobs = new Map();
function pathCwd(cwd) {
	if (cwd !== null && cwd !== undefined && (typeof cwd !== "string" || !isAbsolute(cwd)))
		throw new Error("Workspace must be an absolute path");
	return cwd ? resolve(cwd) : null;
}
async function projectAt(cwd) {
	cwd = pathCwd(cwd);
	if (!cwd) return { cwd: null, project: null, legacyProjectVault: null };
	let raw = {};
	try {
		raw = JSON.parse(await readFile(join(cwd, ".pi/research-workspace.json"), "utf8"));
	} catch (error) {
		if (error.code !== "ENOENT")
			return {
				cwd,
				project: projectIdentity(cwd),
				legacyProjectVault: null,
				projectError: "Project configuration could not be read",
			};
	}
	return {
		cwd,
		project: projectIdentity(cwd, raw.knowledgeProjectId),
		legacyProjectVault: typeof raw.obsidianVault === "string" ? raw.obsidianVault : null,
	};
}
async function bound(revision) {
	const binding = await readKnowledgeBinding({ fresh: true });
	if (!binding) throw new Error("No application knowledge Vault is bound");
	if (revision !== undefined && revision !== binding.revision)
		throw new Error("Knowledge binding changed; refresh this panel before acting");
	return { binding, service: await getKnowledgeService(binding) };
}
async function explainerLinksForDisplay(binding, notePath, text) {
	if (!notePath.startsWith("Library/Explainers/") || typeof text !== "string") return null;
	let root;
	try {
		root = await realpath(join(binding.vault, "Attachments", "Explainers"));
	} catch {
		return null;
	}
	const base = dirname(join(binding.vault, notePath));
	let output = text,
		count = 0;
	const matches = [
		...text.matchAll(
			/\]\((\.\.\/\.\.\/Attachments\/Explainers\/[a-z0-9-]+\/[A-Za-z0-9._-]+\.(?:html?|md))\)/g,
		),
	].slice(0, 20);
	for (const match of matches) {
		try {
			const actual = await realpath(resolve(base, match[1])),
				rel = relative(root, actual),
				info = await lstat(actual);
			if (!info.isFile() || info.isSymbolicLink() || isAbsolute(rel) || rel === ".." || rel.startsWith("../"))
				continue;
			output = output.replace(`](${match[1]})`, `](${pathToFileURL(actual).href})`);
			count++;
		} catch {
			/* missing/stale attachment remains a relative link */
		}
	}
	return count ? output : null;
}
export async function knowledgeOverview({ cwd = null, sessionId = null } = {}) {
	const project = await projectAt(cwd);
	if (!knowledgeDirectory())
		return { enabled: false, bound: false, scope: "application", ...project, flow: null };
	const binding = await readKnowledgeBinding({ fresh: true });
	if (!binding)
		return {
			enabled: true,
			bound: false,
			scope: "application",
			...project,
			flow: sessionId ? flowFor(sessionId) : null,
		};
	let index = null,
		error = null;
	try {
		if (!(await stat(binding.vault)).isDirectory()) throw new Error("Vault is not a directory");
		index = await (await getKnowledgeService(binding)).request("status");
	} catch (e) {
		error = String(e.message).slice(0, 500);
	}
	let settings, settingsError;
	try {
		settings = await specialistSettings();
	} catch (e) {
		settingsError = String(e.message).slice(0, 300);
	}
	return {
		enabled: true,
		bound: true,
		scope: "application",
		binding,
		...project,
		index,
		error,
		specialistSettings: settings,
		specialistSettingsError: settingsError,
		flow: sessionId ? flowFor(sessionId) : null,
	};
}
export async function knowledgeSetupPreview({ cwd = null, path = null } = {}) {
	const workspace = pathCwd(cwd),
		binding = await readKnowledgeBinding();
	const supplied = typeof path === "string" ? path.trim() : "";
	const vault = supplied ? resolveSetupVault(supplied, workspace || "/") : binding?.vault || null;
	const context = workspace
		? await inspectObsidianSetup({ cwd: workspace, vault })
		: { workspace: null, vault: vault ? await inspectSetupDirectory(vault) : null };
	const options = researchSetupOptions();
	const profiles = options.profiles.map((profile) => ({
		...profile,
		directories: [
			"Home.md",
			"Wiki/Index.md",
			"Inbox/Index.md",
			"Library/Index.md",
			"Projects/Index.md",
			"Indexes/Knowledge.md",
			...profile.libraryTypes.map((type) => `Library/${type}/`),
			"Projects/<project>/Context.md",
			"Projects/<project>/Index.md",
			...profile.projectTypes.map((type) => `Projects/<project>/${type}/`),
			...Object.keys(LAYOUT.templates).map((name) => `Templates/${name}.md`),
		],
	}));
	return {
		path: vault,
		scope: "application",
		bindingRevision: binding?.revision || 0,
		context,
		options: { ...options, profiles },
		templateSamples: Object.entries(LAYOUT.templates).map(([name, type]) => ({
			path: `Templates/${name}.md`,
			text: LAYOUT.noteTemplate.replace("{{type}}", type),
		})),
		warning:
			"Read-only preview. Project folders are created for confirmed projects, not automatically for every open directory. Setup still requires the skill interview and a separate write confirmation.",
	};
}
export async function knowledgeJobs({ cwd = null, offset = 0, limit = 20, revision } = {}) {
	const { service } = await bound(revision),
		{ project } = await projectAt(cwd);
	return service.request("uiJobs", { project, offset, limit });
}
export async function knowledgeReviews({ cwd, offset = 0, limit = 15, revision }) {
	const { service } = await bound(revision),
		{ project } = await projectAt(cwd);
	if (!project) return { items: [], problems: [], total: 0, offset: 0, nextOffset: null };
	if (
		!Number.isInteger(offset) ||
		offset < 0 ||
		offset > 100 ||
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > 25
	)
		throw new Error("Invalid review page");
	const all = await listWikiProposals(service, project),
		items = all.items.slice(offset, offset + limit);
	return {
		items,
		problems: all.problems,
		total: all.items.length,
		offset,
		nextOffset: offset + items.length < all.items.length ? offset + items.length : null,
	};
}
export async function knowledgePreviewReview({ cwd, id, revision }) {
	const { binding, service } = await bound(revision),
		{ project } = await projectAt(cwd);
	if (!project) throw new Error("Choose the originating project to review its proposal");
	const preview = await previewWikiProposal(service, id, project),
		token = randomUUID();
	const expires = Date.now() + 10 * 60 * 1000;
	previews.set(token, {
		binding,
		service,
		project,
		cwd: resolve(cwd),
		id,
		hash: preview.proposalHash,
		expires,
	});
	while (previews.size > MAX_PREVIEWS) previews.delete(previews.keys().next().value);
	const { lastWikiModelReview } = await import("./wiki-model-review.mjs");
	return {
		...preview,
		modelReview: await lastWikiModelReview(service, id, preview.proposalHash),
		reviewToken: token,
		tokenExpiresAt: expires,
		vault: binding.vault,
		bindingRevision: binding.revision,
	};
}
export function consumeKnowledgeReviewPreview(cwd, token) {
	const entry = previews.get(token);
	if (!entry || entry.cwd !== pathCwd(cwd) || entry.expires < Date.now())
		throw new Error("Review expired; open the exact preview again");
	previews.delete(token);
	return entry;
}
export async function knowledgeDecideReview({ cwd, token, decision }) {
	if (!["apply", "reject"].includes(decision)) throw new Error("Invalid Wiki decision");
	const entry = consumeKnowledgeReviewPreview(cwd, token);
	const result = await decideWikiProposal(entry.service, entry.id, entry.project, entry.hash, decision);
	invalidateKnowledgeUi();
	return result;
}
export async function knowledgeReadNote({ cwd = null, path, startLine = 1, revision }) {
	const { binding, service } = await bound(revision),
		{ project } = await projectAt(cwd);
	if (!Number.isSafeInteger(startLine) || startLine < 1) throw new Error("Invalid start line");
	// Human reads intentionally do not grant any model read receipt.
	const page = await service.request("read", {
		path,
		project,
		startLine,
		maxChars: 6000,
		reviewMaxChars: 1600,
	});
	// Legacy bare results paths get a display-only link, only for the matching project.
	// Preserve original bytes/hash and never guess a different project's source location.
	const owner = page.text?.match(/^project:\s*["']?([a-z0-9-]+)/m)?.[1];
	const displayText = await explainerLinksForDisplay(binding, path, page.text);
	if (cwd && owner === project && startLine === 1) {
		const config = await loadWorkspaceConfig(cwd),
			lines = (displayText || page.text).split("\n");
		let inSources = false,
			fence = null,
			linked = 0;
		for (let i = 0; i < lines.length && linked < 20; i++) {
			const line = lines[i],
				mark = line.trim().match(/^(`{3,}|~{3,})/)?.[1];
			if (mark) {
				if (!fence) fence = mark[0];
				else if (mark[0] === fence) fence = null;
				continue;
			}
			if (fence) continue;
			if (/^## /u.test(line)) {
				inSources = /^## Sources\s*$/iu.test(line);
				continue;
			}
			const raw = inSources ? line.match(/^- (results\/[^\r\n]+)$/)?.[1] : null;
			if (!raw) continue;
			const result = await normalizeSourceLinks([raw], {
				cwd,
				vault: binding.vault,
				resultsRoot: config.resultsRoot,
				project,
			});
			if (!result.unresolved.length) {
				lines[i] = `- ${result.links[0]}`;
				linked++;
			}
		}
		if (linked) return { ...page, displayText: lines.join("\n"), displayLinkBase: cwd };
	}
	if (displayText) return { ...page, displayText, displayLinkBase: binding.vault };
	return page;
}
export async function knowledgeMaintenance({ cwd = null, action, revision }) {
	const { binding, service } = await bound(revision),
		{ project } = await projectAt(cwd);
	if (!["reconcile", "refresh-navigation"].includes(action)) throw new Error("Unknown maintenance action");
	if (!Number.isSafeInteger(revision) || revision < 1)
		throw new Error("Refresh the binding before maintenance");
	const key = `${binding.vaultId}:${binding.revision}`;
	if (maintenance.has(key)) throw new Error("Knowledge maintenance is already running");
	maintenance.add(key);
	try {
		const result = await withKnowledgeBinding(binding, () =>
			action === "reconcile" ? service.request("reconcile") : runNavigationMaintenance(service, project, 5),
		);
		invalidateKnowledgeUi();
		return result;
	} finally {
		maintenance.delete(key);
	}
}
export async function knowledgeOpenTarget({ cwd = null, path = null, revision }) {
	const { binding } = await bound(revision);
	const { project } = await projectAt(cwd);
	if (path) {
		const { canRead, validateNote } = await import("./files.mjs");
		if (!canRead(validateNote(path), project))
			throw new Error("Note is outside shared/current-project scope");
		return { path: await safeNotePath(binding.vault, path), kind: "note" };
	}
	if (!(await stat(binding.vault)).isDirectory()) throw new Error("Vault is unavailable");
	return { path: binding.vault, kind: "vault" };
}

export const knowledgeSpecialistSettings = (input) => setSpecialistSettings(input);

function requireProject(projectInfo) {
	if (projectInfo.projectError) throw new Error(projectInfo.projectError);
	if (!projectInfo.project) throw new Error("Choose a project workspace first");
	return projectInfo.project;
}

export async function knowledgeSemanticStatus({ cwd = null, bindingRevision } = {}) {
	const { service } = await bound(bindingRevision),
		{ project, projectError } = await projectAt(cwd);
	if (projectError) throw new Error(projectError);
	return service.semanticStatus({ project: project || undefined });
}

export async function saveKnowledgeSemanticSettings({
	config,
	bindingRevision,
	expectedSettingsRevision,
} = {}) {
	if (!Number.isSafeInteger(bindingRevision) || !Number.isSafeInteger(expectedSettingsRevision))
		throw new Error("Binding and settings revisions are required");
	const { binding, service } = await bound(bindingRevision);
	return withKnowledgeBinding(binding, () =>
		service.saveSemanticSettings(config, bindingRevision, expectedSettingsRevision),
	);
}

export async function testKnowledgeSemanticProvider({ config, bindingRevision } = {}) {
	if (!Number.isSafeInteger(bindingRevision)) throw new Error("Binding revision is required");
	const { binding, service } = await bound(bindingRevision);
	if (!config?.enabled || config.provider === "none")
		return { ok: true, provider: "none", model: config?.model || "", dimension: 0 };
	return withKnowledgeBinding(binding, () => service.testSemanticProvider(config, bindingRevision, {}));
}

export async function indexKnowledgeSemantic({ cwd, bindingRevision, requestId, limit = 8 } = {}) {
	if (typeof cwd !== "string" || !cwd) throw new Error("Project cwd is required for semantic indexing");
	if (typeof requestId !== "string" || !requestId) throw new Error("Index request id is required");
	if (!Number.isSafeInteger(bindingRevision)) throw new Error("Binding revision is required");
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16)
		throw new Error("Semantic index limit must be 1–16");
	const { binding, service } = await bound(bindingRevision),
		projectInfo = await projectAt(cwd),
		project = requireProject(projectInfo),
		key = `${binding.vaultId}:${project}`;
	if (semanticJobs.has(key)) throw new Error("Semantic indexing is already running for this project");
	const controller = new AbortController(),
		job = { requestId, controller };
	semanticJobs.set(key, job);
	try {
		return await withKnowledgeBinding(binding, () =>
			service.rebuildSemanticIndex({
				limit: Math.max(1, Math.min(16, limit)),
				project,
				signal: controller.signal,
			}),
		);
	} finally {
		if (semanticJobs.get(key) === job) semanticJobs.delete(key);
	}
}

export async function cancelKnowledgeSemanticIndex({ cwd, bindingRevision, requestId } = {}) {
	if (typeof cwd !== "string" || !cwd) throw new Error("Project cwd is required for semantic indexing");
	if (!Number.isSafeInteger(bindingRevision)) throw new Error("Binding revision is required");
	const { binding } = await bound(bindingRevision),
		project = requireProject(await projectAt(cwd)),
		key = `${binding.vaultId}:${project}`,
		job = semanticJobs.get(key);
	if (!job || job.requestId !== requestId) throw new Error("No matching semantic index request is running");
	job.controller.abort();
}

export async function getKnowledgeTopics({ cwd, bindingRevision, query = "" } = {}) {
	if (typeof cwd !== "string" || !cwd) throw new Error("Project cwd is required for topics");
	if (!Number.isSafeInteger(bindingRevision)) throw new Error("Binding revision is required");
	const { binding } = await bound(bindingRevision),
		project = requireProject(await projectAt(cwd)),
		mod = await import("./topic-memory.mjs"),
		memory = await mod.createTopicMemory({ binding, project });
	return withKnowledgeBinding(binding, () =>
		memory.list(typeof query === "string" ? query.slice(0, 200) : "", { includeArchived: true }),
	);
}

export async function archiveKnowledgeTopic({ cwd, bindingRevision, id, expectedRevision } = {}) {
	if (typeof cwd !== "string" || !cwd) throw new Error("Project cwd is required for topics");
	if (!Number.isSafeInteger(bindingRevision) || !Number.isSafeInteger(expectedRevision))
		throw new Error("Binding and topic revisions are required");
	if (typeof id !== "string" || !id) throw new Error("Topic id is required");
	const { binding } = await bound(bindingRevision),
		project = requireProject(await projectAt(cwd)),
		mod = await import("./topic-memory.mjs"),
		memory = await mod.createTopicMemory({ binding, project });
	return withKnowledgeBinding(binding, () => memory.archive(id, expectedRevision));
}
