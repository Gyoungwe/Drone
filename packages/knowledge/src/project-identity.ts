/**
 * 统一的知识项目身份解析器。research_loop、research_deposit_knowledge、research_summarize_run、
 * 来源 / 讲解归档与知识检索都通过它得到同一个项目 slug，不再回落到 `research-workbench`。
 *
 * 优先级：
 * 1. 日常空间（`~/.drone/daily`）中，本会话用 `/project <slug>` 选择的项目（会话条目，按会话隔离）；
 * 2. 工作区 `.pi/research-workspace.json` 的 `knowledgeProjectId`；
 * 3. 由工作区目录派生的稳定 ID：`<目录名>-<sha10>`（与 {@link projectIdentity} 相同）。
 *
 * 模型在工具参数里传入的 `project` 只作为"请求"：与解析结果不同则忽略并在结果中说明，
 * 这样同一个工作区只有一个项目身份。
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { projectIdentity } from "./config";

/** 会话条目类型：日常空间按会话选择的项目（`pi.appendEntry(SESSION_PROJECT_ENTRY, { project })`）。 */
export const SESSION_PROJECT_ENTRY = "drone-session-project-v1";
/** 旧版本在未指定项目时使用的缺省项目；只用于迁移判断，不再作为回落值。 */
export const LEGACY_DEFAULT_PROJECT = "research-workbench";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|shared)$/;

export type ProjectSource = "session" | "workspace-config" | "workspace";

export interface ProjectResolution {
	/** 解析出的规范项目 slug。 */
	project: string;
	source: ProjectSource;
	/** cwd 是否为日常空间。 */
	daily: boolean;
	/** 调用方（通常是模型的工具参数）请求的项目；未请求时为 null。 */
	requested: string | null;
	/** 请求的项目与解析结果不同，已被忽略。 */
	ignoredRequest: boolean;
}

/** 是否为合法的项目 slug（小写 kebab-case，≤ 96 字符，不是保留名或 `shared`）。 */
export function isProjectSlug(value: unknown): value is string {
	return typeof value === "string" && value.length <= 96 && SLUG.test(value) && !RESERVED.test(value);
}

/** 把用户输入整理成项目 slug（NFKC、小写、非字母数字变 `-`）；无法得到合法 slug 时返回 null。 */
export function normalizeProjectSlug(input: unknown): string | null {
	if (typeof input !== "string") return null;
	const slug = input
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 96)
		.replace(/-+$/g, "");
	return isProjectSlug(slug) ? slug : null;
}

/** 由工作区目录派生的项目 ID；`configured` 为合法 slug 时直接使用。算法与既有 `projectIdentity` 一致。 */
export function workspaceProjectId(cwd: string, configured?: unknown): string {
	return projectIdentity(cwd, isProjectSlug(configured) ? configured : undefined);
}

/** 日常空间目录 `~/.drone/daily`（与 desktop `getDailyDir()` 一致）。 */
export function dailyWorkspaceDir(home: string = homedir()): string {
	return join(home, ".drone", "daily");
}

function samePath(a: string, b: string): boolean {
	const left = resolve(a).replace(/[\\/]+$/, "");
	const right = resolve(b).replace(/[\\/]+$/, "");
	return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** cwd 是否为日常空间。 */
export function isDailyWorkspace(cwd: string, home?: string): boolean {
	return samePath(cwd, dailyWorkspaceDir(home));
}

interface SessionEntryLike {
	type?: unknown;
	customType?: unknown;
	data?: unknown;
}

/**
 * 从会话条目中读出最近一次 `/project` 选择。`{ project: null }` 表示清除选择。
 * 只接受合法 slug；条目不合法时忽略。
 */
export function sessionProjectFromEntries(entries: unknown): string | null {
	if (!Array.isArray(entries)) return null;
	let project: string | null = null;
	for (const entry of entries as SessionEntryLike[]) {
		if (!entry || typeof entry !== "object" || entry.customType !== SESSION_PROJECT_ENTRY) continue;
		if (entry.type !== undefined && entry.type !== "custom") continue;
		const value = (entry.data as { project?: unknown } | null | undefined)?.project;
		if (value === null) project = null;
		else if (isProjectSlug(value)) project = value;
	}
	return project;
}

export interface SessionContextLike {
	sessionManager?: { getBranch?: () => unknown; getEntries?: () => unknown } | null;
}

/** 安全读取当前会话分支上的条目（没有会话管理器时返回空数组）。 */
export function sessionEntriesOf(ctx: SessionContextLike | null | undefined): unknown[] {
	try {
		const manager = ctx?.sessionManager;
		const entries = manager?.getBranch?.() ?? manager?.getEntries?.();
		return Array.isArray(entries) ? entries : [];
	} catch {
		return [];
	}
}

export interface ResolveProjectInput {
	cwd: string;
	/** `.pi/research-workspace.json` 的 `knowledgeProjectId`（未读取时为 undefined）。 */
	configured?: unknown;
	/** 当前会话分支的条目；只在日常空间生效。 */
	sessionEntries?: unknown;
	/** 调用方请求的项目（如工具参数）。 */
	requested?: unknown;
	/** 测试用：替代 `os.homedir()`。 */
	home?: string;
}

/** 同步解析（调用方已读取工作区配置）。 */
export function resolveProjectIdentity(input: ResolveProjectInput): ProjectResolution {
	const daily = isDailyWorkspace(input.cwd, input.home);
	const requestedText = typeof input.requested === "string" ? input.requested.trim() : "";
	const requested = requestedText || null;
	let project: string;
	let source: ProjectSource;
	const session = daily ? sessionProjectFromEntries(input.sessionEntries) : null;
	if (session) {
		project = session;
		source = "session";
	} else if (isProjectSlug(input.configured)) {
		project = input.configured;
		source = "workspace-config";
	} else {
		project = workspaceProjectId(input.cwd);
		source = "workspace";
	}
	const ignoredRequest = requested !== null && normalizeProjectSlug(requested) !== project;
	return { project, source, daily, requested, ignoredRequest };
}

/** 读取 `.pi/research-workspace.json` 的 `knowledgeProjectId`；文件缺失或损坏时返回 undefined。 */
export async function readConfiguredProject(cwd: string): Promise<unknown> {
	try {
		const parsed: unknown = JSON.parse(await readFile(join(cwd, ".pi", "research-workspace.json"), "utf8"));
		if (parsed && typeof parsed === "object" && "knowledgeProjectId" in parsed)
			return (parsed as { knowledgeProjectId?: unknown }).knowledgeProjectId;
	} catch {
		// Missing or malformed workspace metadata uses the directory-derived identity.
	}
	return undefined;
}

/** 读取工作区配置后解析项目身份。工具层传入 `sessionEntries: sessionEntriesOf(ctx)`。 */
export async function resolveWorkspaceProject(input: Omit<ResolveProjectInput, "configured">): Promise<ProjectResolution> {
	return resolveProjectIdentity({ ...input, configured: await readConfiguredProject(input.cwd) });
}

/**
 * 运行级操作（总结、来源归档）使用的项目：运行开始时记录在 `metadata.project` 中的项目优先；
 * 旧版本缺省写入的 `research-workbench`（以及缺失 / 非法值）视为"未指定"，改用当前解析结果。
 */
export function runProject(metadataProject: unknown, resolution: ProjectResolution): string {
	if (isProjectSlug(metadataProject) && metadataProject !== LEGACY_DEFAULT_PROJECT) return metadataProject;
	return resolution.project;
}

/** 请求的项目被忽略时给模型 / 用户的一句说明；否则返回 null。 */
export function projectNotice(resolution: ProjectResolution): string | null {
	if (!resolution.ignoredRequest) return null;
	const how = resolution.daily
		? "In the daily space the user picks a project per session with /project <slug>."
		: "The project is fixed by the current workspace (knowledgeProjectId in .pi/research-workspace.json).";
	return `Requested project "${resolution.requested}" was ignored; using "${resolution.project}". ${how}`;
}

/** 便于结果展示的紧凑描述。 */
export function describeProject(resolution: ProjectResolution): {
	project: string;
	source: ProjectSource;
	notice?: string;
} {
	const notice = projectNotice(resolution);
	return { project: resolution.project, source: resolution.source, ...(notice ? { notice } : {}) };
}
