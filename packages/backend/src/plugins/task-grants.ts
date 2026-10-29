import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, parse, relative, resolve } from "node:path";
import { hostText } from "../reply-language";
import type { RegisteredSession, SessionDirectory } from "../session/registry";
import type { PluginRuntimeSource } from "./coordinator";
import type { PluginCapabilityHandler } from "./runtime-capabilities";
import { requirePluginSession } from "./session-caller";

/**
 * Host-issued task authorization (docs/superpowers/specs/2026-10-29-host-task-grant-design.md).
 * The user approves one task in a host-rendered dialog; the host keeps the grant, bound to the live
 * session entry, the requesting plugin source and the task contract. Nothing a plugin returns,
 * persists or restores can create or extend a grant.
 */
export interface TaskGrant {
	readonly id: string;
	readonly source: PluginRuntimeSource;
	readonly taskId: string;
	readonly contractHash: string;
	readonly writeRoots: readonly string[];
	readonly maxCalls: number;
	readonly maxAutoResumes: number;
	readonly issuedAt: string;
}

export const MAX_TASK_WRITE_ROOTS = 8;

/**
 * Canonical existing project directories only: never a drive root, the home directory or one of
 * its parents. Resolved by the host before the dialog so the user approves what will be enforced.
 */
export function resolveTaskWriteRoots(cwd: string, directories: readonly string[]): string[] {
	if (directories.length > MAX_TASK_WRITE_ROOTS)
		throw new Error(`Choose at most ${MAX_TASK_WRITE_ROOTS} project directories.`);
	const home = realpathSync(homedir());
	const roots: string[] = [];
	for (const directory of directories) {
		const root = realpathSync(resolve(cwd, directory));
		const toHome = relative(root, home);
		if (root === parse(root).root || (!isAbsolute(toHome) && !toHome.startsWith("..")))
			throw new Error("Authorize a project directory, not a drive, home directory or its parent.");
		if (!statSync(root).isDirectory())
			throw new Error("Authorize an existing project directory; outputs may create subdirectories.");
		if (!roots.includes(root)) roots.push(root);
	}
	return roots;
}

export class TaskGrantStore {
	private readonly grants = new WeakMap<object, TaskGrant>();
	private sourceCurrent: (source: PluginRuntimeSource) => boolean = () => false;

	constructor(private readonly sessions: SessionDirectory) {}

	/** The plugin bridge supplies which installed sources are current; until then no grant is valid. */
	bindSourceValidator(current: (source: PluginRuntimeSource) => boolean): void {
		this.sourceCurrent = current;
	}

	issue(identity: object, grant: Omit<TaskGrant, "id" | "issuedAt">): TaskGrant {
		const issued = { ...grant, id: randomUUID(), issuedAt: new Date().toISOString() };
		// One active task grant per session: a new authorization replaces the previous one.
		this.grants.set(identity, issued);
		return issued;
	}

	/** The grant of a live session entry whose plugin source is still the current installed one. */
	current(identity: object): TaskGrant | undefined {
		const grant = this.grants.get(identity);
		if (!grant) return undefined;
		const entry = identity as RegisteredSession;
		if (
			this.sessions.get(entry.session.sessionId) !== entry ||
			this.sessions.signalFor(entry).aborted ||
			!this.sourceCurrent(grant.source)
		) {
			this.grants.delete(identity);
			return undefined;
		}
		return grant;
	}

	release(identity: object, taskId: string): boolean {
		const grant = this.current(identity);
		if (grant?.taskId !== taskId) return false;
		this.grants.delete(identity);
		return true;
	}

	/** Directories the permission gate may write without asking, for the session's current grant. */
	writeRoots(sessionId: string): readonly string[] | undefined {
		const entry = this.sessions.get(sessionId);
		return entry ? this.current(entry)?.writeRoots : undefined;
	}
}

const text = (max: number) => ({ type: "string", minLength: 1, maxLength: max });
const requestSchema = {
	type: "object",
	properties: {
		taskId: text(128),
		contractHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
		goal: text(2000),
		summary: text(2000),
		writeDirectories: { type: "array", items: text(512), maxItems: MAX_TASK_WRITE_ROOTS },
		acceptance: { type: "array", items: text(500), maxItems: 32 },
		compute: text(2000),
		maxCalls: { type: "integer", minimum: 1, maximum: 1000 },
		maxAutoResumes: { type: "integer", minimum: 0, maximum: 10 },
	},
	required: [
		"taskId",
		"contractHash",
		"goal",
		"writeDirectories",
		"acceptance",
		"maxCalls",
		"maxAutoResumes",
	],
	additionalProperties: false,
};
interface TaskGrantRequest {
	readonly taskId: string;
	readonly contractHash: string;
	readonly goal: string;
	readonly summary?: string;
	readonly writeDirectories: readonly string[];
	readonly acceptance: readonly string[];
	readonly compute?: string;
	readonly maxCalls: number;
	readonly maxAutoResumes: number;
}
const grantSchema = {
	type: "object",
	properties: {
		grantId: { type: "string" },
		taskId: { type: "string" },
		contractHash: { type: "string" },
		writeRoots: { type: "array", items: { type: "string" } },
		maxCalls: { type: "integer" },
		maxAutoResumes: { type: "integer" },
		issuedAt: { type: "string" },
	},
	required: ["grantId", "taskId", "contractHash", "writeRoots", "maxCalls", "maxAutoResumes", "issuedAt"],
	additionalProperties: false,
};
const view = (grant: TaskGrant) => ({
	grantId: grant.id,
	taskId: grant.taskId,
	contractHash: grant.contractHash,
	writeRoots: [...grant.writeRoots],
	maxCalls: grant.maxCalls,
	maxAutoResumes: grant.maxAutoResumes,
	issuedAt: grant.issuedAt,
});

/** The host-rendered task authorization text; the plugin only supplies validated plain fields. */
export function taskGrantDialog(request: TaskGrantRequest, writeRoots: readonly string[]): string {
	return [
		hostText(`要做的事：${request.goal}`, `Task: ${request.goal}`),
		...(request.summary ? [request.summary] : []),
		writeRoots.length
			? hostText(
					`会写入这些文件夹（包括子文件夹），不再逐项询问：\n${writeRoots.map((root) => `- ${root}`).join("\n")}`,
					`It will write in these folders (and subfolders) without asking each time:\n${writeRoots.map((root) => `- ${root}`).join("\n")}`,
				)
			: hostText(
					"不会新增可写文件夹；改动文件仍按你现有的权限设置逐项确认。",
					"No folder becomes writable; file changes still follow your permission settings.",
				),
		request.compute ??
			hostText(
				"不包含远程计算；运行计算任务仍会单独询问。",
				"No remote computation; running compute jobs still asks separately.",
			),
		hostText(
			`预算：最多 ${request.maxCalls} 次工具调用，自动续作最多 ${request.maxAutoResumes} 次。`,
			`Budget: at most ${request.maxCalls} tool calls and ${request.maxAutoResumes} automatic resumptions.`,
		),
		request.acceptance.length
			? hostText(
					`做完的标准：\n${request.acceptance.map((line) => `- ${line}`).join("\n")}`,
					`Done when:\n${request.acceptance.map((line) => `- ${line}`).join("\n")}`,
				)
			: "",
		hostText(
			"同意后它会自己做完这些事，中途不再反复问你；删除文件、碰敏感文件、写到上面以外的位置或运行计算仍会先征得你同意。任务结束、会话关闭、插件停用或更新时授权自动失效，你随时可以停止。",
			"Once approved it finishes these steps without asking again; deleting files, sensitive files, writing elsewhere or running computation still asks first. The authorization ends with the task, the session, or when the plugin is disabled or updated. You can stop at any time.",
		),
	]
		.filter(Boolean)
		.join("\n\n");
}

/** Capabilities bound to one installed plugin source; the grant records exactly this source. */
export function taskGrantCapabilityHandlers(
	store: TaskGrantStore,
	sessions: SessionDirectory,
	source: PluginRuntimeSource,
): Record<"task.grant.request" | "task.grant.release" | "task.grant.current", PluginCapabilityHandler> {
	const writableEntry = (context: Parameters<PluginCapabilityHandler["execute"]>[1]) => {
		const entry = requirePluginSession(sessions, context);
		if (entry.readOnly || entry.nativeKind === "child" || !entry.session.settingsManager.isProjectTrusted())
			throw new Error("Task authorization requires a writable trusted primary session");
		return entry;
	};
	// The broker hands the same validated input object to the dialog formatter and to execute.
	const shown = new WeakMap<object, readonly string[]>();
	return {
		"task.grant.request": {
			effect: "write",
			// The host dialog below is the user's decision; it is never skipped by an existing grant.
			approval: "always",
			readCallable: true,
			inputSchema: requestSchema,
			resultSchema: grantSchema,
			approvalDetail: (input, facts) => {
				if (facts.scope.kind !== "session") throw new Error("Task authorization requires a live session");
				const request = input as TaskGrantRequest;
				const roots = resolveTaskWriteRoots(facts.scope.workspaceDirectory, request.writeDirectories);
				shown.set(input as object, roots);
				return taskGrantDialog(request, roots);
			},
			execute: async (input, context) => {
				const request = input as TaskGrantRequest;
				const entry = writableEntry(context);
				// Re-resolve after approval: a directory replaced while the dialog was open is refused.
				const writeRoots = resolveTaskWriteRoots(entry.cwd, request.writeDirectories);
				const approved = shown.get(input as object);
				shown.delete(input as object);
				if (!approved || writeRoots.join("\0") !== approved.join("\0"))
					throw new Error("Task directories changed during authorization; ask again.");
				return view(
					store.issue(entry, {
						source,
						taskId: request.taskId,
						contractHash: request.contractHash,
						writeRoots,
						maxCalls: request.maxCalls,
						maxAutoResumes: request.maxAutoResumes,
					}),
				);
			},
		},
		"task.grant.release": {
			effect: "write",
			// Releasing only removes authority.
			approval: "own",
			readCallable: true,
			inputSchema: {
				type: "object",
				properties: { taskId: text(128) },
				required: ["taskId"],
				additionalProperties: false,
			},
			resultSchema: {
				type: "object",
				properties: { released: { type: "boolean" } },
				required: ["released"],
				additionalProperties: false,
			},
			execute: async (input, context) => ({
				released: store.release(
					requirePluginSession(sessions, context),
					(input as { taskId: string }).taskId,
				),
			}),
		},
		"task.grant.current": {
			effect: "read",
			inputSchema: { type: "null" },
			resultSchema: { anyOf: [{ type: "null" }, grantSchema] },
			execute: async (_input, context) => {
				const grant = store.current(requirePluginSession(sessions, context));
				return grant && grant.source.pluginId === source.pluginId ? view(grant) : null;
			},
		},
	};
}
