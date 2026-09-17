import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PROTECTED_KNOWLEDGE_AGENTS } from "@drone/shared";
import type { Model } from "@earendil-works/pi-ai";
import type {
	AgentSessionEvent,
	AgentToolResult,
	ModelRuntime,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { makePermissionGateExtension } from "../../permissions/extension";
import type { PermissionGate, PermissionRequestMeta } from "../../permissions/gate";
import { projectKnowledgeEvent } from "../../session/knowledge-publication";
import type { SessionTraces } from "../../session/traces";
import { makeUiContext } from "../../session/ui-context";
import { makeStatusTool } from "../status";
import { makeWebFetchTool } from "../webfetch";
import type { SubagentDefinition, SubagentMcpAccess } from "./agents";
import { withNativeSubagentSlot } from "./slots";

export interface SubagentUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	totalTokens: { tokens: number };
}

export interface SingleResult {
	agent: string;
	/** 子会话 id：父 UI 内联展开时绑定实时 transcript */
	sessionId?: string;
	task: string;
	model?: string;
	exitCode: number;
	error?: string;
	content?: string;
	usage: SubagentUsage;
	artifactPaths: { jsonlPath?: string };
	/** Live user-visible status propagated to the parent subagent card. */
	statusText?: string;
	statusPhase?: string;
	/** Observable current activity derived from actual tool execution. */
	currentAction?: string;
	currentTool?: string;
	startedAt?: number;
	lastSteerAt?: number;
	supervisorRequest?: {
		id: string;
		reason: "need_decision" | "interview_request" | "progress_update";
		message: string;
		expectsReply: boolean;
	} | null;
}

export interface RunSubagentInput {
	requiredTools?: string[];
	agent: SubagentDefinition;
	task: string;
	cwd: string;
	/** 父会话的项目信任态（子会话 SettingsManager 对齐，不硬编码 trusted） */
	projectTrusted: boolean;
	model?: Model<any>;
	signal?: AbortSignal;
	onProgress?: (result: SingleResult) => void;
}

export interface RunSubagentDeps {
	getModelRuntime: () => Promise<ModelRuntime>;
	/** 设置页的 per-agent 覆盖；无配置时返回 undefined 并继续走 frontmatter / 父模型。 */
	getSubagentModel: (agentName: string) => Promise<string | undefined>;
	gate: PermissionGate;
	traces: SessionTraces;
	/** 把运行中子会话事件转发给宿主；未提供时只写 trace（供非桌面宿主使用）。 */
	onEvent?: (sessionId: string, event: AgentSessionEvent) => void;
	/** Register/unregister a live child so the host can steer it or answer supervisor requests. */
	registerLiveChild?: (
		sessionId: string,
		control: {
			steer: (message: string, mode?: "steer" | "followUp") => Promise<void>;
			reply: (requestId: string, message: string) => boolean;
		},
	) => () => void;
}

const EMPTY_USAGE: SubagentUsage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0,
	totalTokens: { tokens: 0 },
};

/** 子会话统一根目录（与主历史列表物理隔离；openSession 据此判定只读） */
export function subagentSessionsRoot(agentDir: string = getAgentDir()): string {
	return join(agentDir, "sessions-subagents");
}

/** filePath 是否落在子会话目录下（规范化后做前缀判定，防 `..` 绕判） */
export function isSubagentSessionPath(filePath: string, agentDir?: string): boolean {
	const root = resolve(subagentSessionsRoot(agentDir));
	const normalized = resolve(filePath);
	return normalized === root || normalized.startsWith(root + sep);
}

function projectSlug(cwd: string): string {
	const slug = cwd.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return slug || "default";
}

export async function resolveModel(
	runtime: ModelRuntime,
	spec: string | undefined,
	fallback: Model<any> | undefined,
): Promise<Model<any> | undefined> {
	if (!spec) return fallback;
	const slash = spec.indexOf("/");
	if (slash > 0) return runtime.getModel(spec.slice(0, slash), spec.slice(slash + 1)) ?? fallback;
	const matches = (await runtime.getAvailable()).filter((model) => model.id === spec);
	return matches.length === 1 ? matches[0] : fallback;
}

/** 模型优先级：设置页 per-agent 覆盖 > agent frontmatter > 父会话模型。 */
export async function resolveSubagentModel(
	runtime: ModelRuntime,
	preference: string | undefined,
	frontmatter: string | undefined,
	fallback: Model<any> | undefined,
): Promise<Model<any> | undefined> {
	return resolveModel(runtime, preference ?? frontmatter, fallback);
}

/** 子会话标题对齐主会话命名：任务首行，最多 30 字；加 agent 前缀方便快速检视。 */
export function subagentSessionName(agent: string, task: string): string {
	const firstLine = (task.trim().split("\n")[0] ?? "").trim();
	const title = firstLine.length > 30 ? `${firstLine.slice(0, 30)}…` : firstLine;
	return title ? `${agent}: ${title}` : agent;
}

function assistantText(session: { messages: readonly unknown[] }): string {
	const messages = [...session.messages].reverse();
	const assistant = messages.find((message) => (message as { role?: string }).role === "assistant") as
		| { content?: unknown[] }
		| undefined;
	if (!assistant || !Array.isArray(assistant.content)) return "";
	return assistant.content
		.filter((block): block is { type: "text"; text: string } => {
			const item = block as { type?: string; text?: unknown };
			return item.type === "text" && typeof item.text === "string";
		})
		.map((block) => block.text)
		.join("")
		.trim();
}

type UsageDelta = {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: number;
	totalTokens?: number;
};

function usageFromMessage(message: unknown): UsageDelta {
	const usage = (message as { usage?: Record<string, unknown> } | undefined)?.usage;
	if (!usage) return {};
	const cost = usage.cost as { total?: unknown } | undefined;
	return {
		input: typeof usage.input === "number" ? usage.input : undefined,
		output: typeof usage.output === "number" ? usage.output : undefined,
		cacheRead: typeof usage.cacheRead === "number" ? usage.cacheRead : undefined,
		cacheWrite: typeof usage.cacheWrite === "number" ? usage.cacheWrite : undefined,
		cost: typeof cost?.total === "number" ? cost.total : undefined,
		totalTokens: typeof usage.totalTokens === "number" ? usage.totalTokens : undefined,
	};
}

export function addSubagentUsage(target: SubagentUsage, delta: UsageDelta): void {
	target.input += delta.input ?? 0;
	target.output += delta.output ?? 0;
	target.cacheRead += delta.cacheRead ?? 0;
	target.cacheWrite += delta.cacheWrite ?? 0;
	target.cost += delta.cost ?? 0;
	// totalTokens 是单条消息的累计上下文量：优先使用正 totalTokens，否则用组件求和
	const reqTotal =
		typeof delta.totalTokens === "number" && Number.isFinite(delta.totalTokens) && delta.totalTokens > 0
			? delta.totalTokens
			: (delta.input ?? 0) + (delta.output ?? 0) + (delta.cacheRead ?? 0) + (delta.cacheWrite ?? 0);
	if (reqTotal > 0) target.totalTokens.tokens += reqTotal;
}

function modelLabel(model: Model<any> | undefined): string | undefined {
	return model ? `${model.provider}/${model.id}` : undefined;
}

function compactText(value: unknown, max = 96): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = value.replace(/\s+/g, " ").trim();
	if (!text) return undefined;
	return [...text].slice(0, max).join("");
}

function firstString(args: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = compactText(args[key]);
		if (value) return value;
	}
	return undefined;
}

/** Observable activity only: derived from tool name/arguments, never hidden reasoning. */
export function describeSubagentActivity(toolName: string, args: Record<string, unknown>): string {
	const nested = args.args && typeof args.args === "object" ? (args.args as Record<string, unknown>) : {};
	const visibleArgs = { ...nested, ...args };
	const descriptor = `${toolName} ${JSON.stringify(args)}`.toLowerCase();
	if (toolName === "read") {
		const path = firstString(visibleArgs, ["path", "file", "filePath"]);
		return path ? `正在阅读 ${path}` : "正在阅读文件";
	}
	if (toolName === "bash") {
		const command = firstString(visibleArgs, ["command", "cmd"]);
		return command ? `正在运行命令：${command}` : "正在运行命令";
	}
	if (
		descriptor.includes("research-zotero") ||
		descriptor.includes("research_zotero") ||
		descriptor.includes("zotero")
	) {
		const query = firstString(visibleArgs, ["query", "q", "search", "search_text", "text"]);
		return query ? `正在检索 Zotero：“${query}”` : "正在检索 Zotero 文献库";
	}
	if (
		descriptor.includes("research-obsidian") ||
		descriptor.includes("research_obsidian") ||
		descriptor.includes("obsidian")
	) {
		const query = firstString(visibleArgs, ["query", "q", "search", "text", "path"]);
		return query ? `正在检索 Obsidian：“${query}”` : "正在检索 Obsidian 知识库";
	}
	if (descriptor.includes("web_search") || descriptor.includes("web-search")) {
		const query = firstString(visibleArgs, ["query", "q", "search", "text"]);
		return query ? `正在联网搜索：“${query}”` : "正在联网搜索";
	}
	if (descriptor.includes("fetch")) {
		const target = firstString(visibleArgs, ["url", "target", "path"]);
		return target ? `正在读取来源：${target}` : "正在读取并核对来源";
	}
	if (descriptor.includes("search") || descriptor.includes("grep")) {
		const query = firstString(visibleArgs, ["query", "pattern", "q", "text"]);
		return query ? `正在搜索：“${query}”` : `正在执行 ${toolName}`;
	}
	return `正在执行 ${toolName}`;
}

const supervisorParams = Type.Object({
	reason: Type.Union([
		Type.Literal("need_decision"),
		Type.Literal("interview_request"),
		Type.Literal("progress_update"),
	]),
	message: Type.String({ minLength: 1, maxLength: 2000 }),
});

export async function resolveSubagentMcpAccess(
	cwd: string,
	agent: Pick<SubagentDefinition, "mcpAccess">,
	projectTrusted = true,
): Promise<SubagentMcpAccess> {
	if (!projectTrusted) return "none";
	let workspacePolicy: SubagentMcpAccess = "none";
	try {
		if (process.env.DRONE_KNOWLEDGE_DIR) {
			const binding = JSON.parse(
				await readFile(join(process.env.DRONE_KNOWLEDGE_DIR, "binding.json"), "utf8"),
			) as { version?: number; subagentPolicy?: unknown };
			if (binding.version === 1 && binding.subagentPolicy === "read-local") workspacePolicy = "read-local";
		} else {
			const raw = JSON.parse(await readFile(join(cwd, ".pi", "research-workspace.json"), "utf8")) as {
				subagentMcpPolicy?: unknown;
			};
			if (raw.subagentMcpPolicy === "read-local") workspacePolicy = "read-local";
		}
	} catch {
		return "none";
	}
	if (workspacePolicy === "none" || agent.mcpAccess === "none") return "none";
	return agent.mcpAccess === "read-local" || agent.mcpAccess === undefined ? "read-local" : "none";
}

/** 在共享 ModelRuntime 上运行一个隔离的、深度固定为 1 的子会话。 */
export function assertSubagentTools(available: readonly string[], required: readonly string[] = []): void {
	const missing = required.filter(
		(name) => !available.includes(name) || name === "subagent" || name.startsWith("subagent_"),
	);
	if (missing.length)
		throw new Error(
			`subagent-capability-mismatch: missing required tools: ${missing.join(", ")}. Select a suitable existing agent or collect data in the parent; no permissions were expanded.`,
		);
}
export async function runSubagent(deps: RunSubagentDeps, input: RunSubagentInput): Promise<SingleResult> {
	assertSubagentTools(input.agent.tools, input.requiredTools);
	if (PROTECTED_KNOWLEDGE_AGENTS.some((agent) => agent.name === input.agent.name))
		throw new Error(
			"Knowledge specialists use research_delegate_knowledge and its capability broker, not the generic subagent runner",
		);
	return withNativeSubagentSlot(input.cwd, input.signal, () => runSubagentInSlot(deps, input));
}

async function runSubagentInSlot(deps: RunSubagentDeps, input: RunSubagentInput): Promise<SingleResult> {
	const runtime = await deps.getModelRuntime();
	const model = await resolveSubagentModel(
		runtime,
		await deps.getSubagentModel(input.agent.name),
		input.agent.model,
		input.model,
	);
	const agentDir = getAgentDir();
	const sessionDir = join(subagentSessionsRoot(agentDir), projectSlug(input.cwd));
	const childGateConfirm = (title: string, message: string, meta?: PermissionRequestMeta) =>
		deps.gate.confirm(`[${input.agent.name}] ${title}`, message, meta);
	const childSettings = SettingsManager.create(input.cwd, agentDir, {
		projectTrusted: input.projectTrusted,
	});
	const safeTools = input.agent.tools.filter((name) => name !== "subagent" && !name.startsWith("subagent_"));
	const pendingSupervisor = new Map<
		string,
		{ resolve: (message: string) => void; reject: (error: Error) => void }
	>();
	let resultRef: SingleResult | undefined;
	const contactSupervisorTool: ToolDefinition<typeof supervisorParams> = {
		name: "contact_supervisor",
		label: "Contact Supervisor",
		description:
			"Contact the parent supervisor during execution. Use progress_update only when a meaningful discovery changes what the parent should know. Use need_decision when blocked on a decision and interview_request for structured clarification. Do not use for routine completion handoffs.",
		promptSnippet: "contact_supervisor({reason,message})",
		parameters: supervisorParams,
		execute: async (_id, params, signal): Promise<AgentToolResult<{ requestId: string; reason: string }>> => {
			const id = randomUUID();
			const expectsReply = params.reason !== "progress_update";
			const request = { id, reason: params.reason, message: params.message.trim(), expectsReply };
			if (resultRef) {
				resultRef.supervisorRequest = request;
				resultRef.currentAction = expectsReply ? "正在等待主会话回复" : request.message;
				resultRef.currentTool = "contact_supervisor";
				input.onProgress?.(resultRef);
			}
			if (!expectsReply) {
				return {
					content: [{ type: "text", text: "Progress update delivered to the supervisor." }],
					details: { requestId: id, reason: params.reason },
				};
			}
			const reply = await new Promise<string>((resolveReply, rejectReply) => {
				pendingSupervisor.set(id, { resolve: resolveReply, reject: rejectReply });
				const abort = () => {
					pendingSupervisor.delete(id);
					rejectReply(new Error("Supervisor request cancelled"));
				};
				if (signal?.aborted) abort();
				else signal?.addEventListener("abort", abort, { once: true });
			});
			if (resultRef?.supervisorRequest?.id === id) resultRef.supervisorRequest = null;
			if (resultRef) {
				resultRef.currentAction = "已收到主会话回复，正在继续任务";
				resultRef.currentTool = "";
				input.onProgress?.(resultRef);
			}
			return {
				content: [{ type: "text", text: `Supervisor reply: ${reply}` }],
				details: { requestId: id, reason: params.reason },
			};
		},
	};
	const customTools: ToolDefinition[] = [makeStatusTool(), contactSupervisorTool];
	if (safeTools.includes("webfetch")) customTools.push(makeWebFetchTool());
	const mcpAccess = await resolveSubagentMcpAccess(input.cwd, input.agent, input.projectTrusted);
	const readonlyMcpExtension = process.env.DRONE_RESEARCH_WORKBENCH_ROOT
		? join(process.env.DRONE_RESEARCH_WORKBENCH_ROOT, "extensions", "subagent-mcp-readonly.mjs")
		: fileURLToPath(new URL("../../../../../.pi/extensions/subagent-mcp-readonly.mjs", import.meta.url));
	const childExtensionFactories = [
		makePermissionGateExtension(agentDir, {
			projectRoot: input.cwd,
			confirm: childGateConfirm,
		}),
	];
	if (mcpAccess === "read-local" && existsSync(readonlyMcpExtension)) {
		const readonlyMcp = (await import(pathToFileURL(readonlyMcpExtension).href)) as {
			makeSubagentReadonlyMcp: (cwd: string) => (pi: unknown) => void;
		};
		childExtensionFactories.push(readonlyMcp.makeSubagentReadonlyMcp(input.cwd) as never);
	} else if (process.env.DRONE_KNOWLEDGE_DIR) {
		// Children without Vault permission return labeled material, not a checked parent answer.
		const modulePath = process.env.DRONE_RESEARCH_WORKBENCH_ROOT
			? join(process.env.DRONE_RESEARCH_WORKBENCH_ROOT, "lib", "knowledge", "publication.mjs")
			: fileURLToPath(new URL("../../../../../.pi/lib/knowledge/publication.mjs", import.meta.url));
		const publication = (await import(pathToFileURL(modulePath).href)) as {
			registerAnswerPublication: (
				pi: unknown,
				options: { getCurrent: () => null; evidenceOnly: boolean },
			) => { begin(required: boolean): void };
		};
		childExtensionFactories.push(((pi: unknown) =>
			publication
				.registerAnswerPublication(pi, { getCurrent: () => null, evidenceOnly: true })
				.begin(false)) as never);
	}
	const resourceLoader = new DefaultResourceLoader({
		cwd: input.cwd,
		agentDir,
		settingsManager: childSettings,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		appendSystemPrompt: [
			input.agent.systemPrompt,
			"For multi-step work, use set_status when the current activity meaningfully changes. Keep status short, concrete, present-tense, and user-visible; never include hidden reasoning, conclusions, confidence, or percentages.",
			"You have a live supervisor channel. Use contact_supervisor(reason=progress_update) only for meaningful discoveries that change the plan. Use need_decision when blocked and interview_request when structured clarification is required. Do not wait silently when a decision is required.",
		],
		extensionFactories: childExtensionFactories,
	});
	await resourceLoader.reload();

	const sessionManager = SessionManager.create(input.cwd, sessionDir);
	const { session } = await createAgentSession({
		cwd: input.cwd,
		agentDir,
		modelRuntime: runtime,
		model,
		tools: safeTools,
		customTools,
		sessionManager,
		settingsManager: childSettings,
		resourceLoader,
	});
	// 子会话没有主会话的 message_start 自动命名器；创建后立即把任务首行写进自己的 jsonl。
	session.setSessionName(subagentSessionName(input.agent.name, input.task));
	await session.bindExtensions({ uiContext: makeUiContext(deps.gate), mode: "tui" });
	const result: SingleResult = {
		agent: input.agent.name,
		sessionId: session.sessionId,
		task: input.task,
		model: modelLabel(session.model),
		exitCode: -1,
		usage: structuredClone(EMPTY_USAGE),
		artifactPaths: { jsonlPath: session.sessionFile },
		startedAt: Date.now(),
	};
	resultRef = result;
	let settled = false;
	let failure: string | undefined;
	let unsubscribeEvents: (() => void) | undefined;
	let agentStatus: { text: string; phase?: string } | null = null;
	let hostStatus: { text: string; phase?: string; toolCallId: string } | null = null;
	const publishStatus = () => {
		const current = hostStatus ?? agentStatus;
		if (current) {
			result.statusText = current.text;
			result.statusPhase = current.phase;
		} else {
			delete result.statusText;
			delete result.statusPhase;
		}
		input.onProgress?.(result);
	};
	const unregisterLiveChild = deps.registerLiveChild?.(session.sessionId, {
		steer: async (message, mode = "steer") => {
			if (mode === "followUp") await session.followUp(message);
			else await session.steer(message);
			result.lastSteerAt = Date.now();
			result.currentAction = "已收到主会话指导，正在调整执行";
			input.onProgress?.(result);
		},
		reply: (requestId, message) => {
			const pending = pendingSupervisor.get(requestId);
			if (!pending) return false;
			pendingSupervisor.delete(requestId);
			pending.resolve(message);
			return true;
		},
	});
	// 等待 agent_settled 而非 agent_end：_runAgentPrompt 的 finally 保证 settled 在全部路径
	// （正常结束 / 异常逃逸 / abort）都触发；agent_end 在 overflow 重试（willRetry）或异常时不算终结。
	const endPromise = new Promise<void>((resolve) => {
		unsubscribeEvents = session.subscribe((event: AgentSessionEvent) => {
			if (deps.onEvent) deps.onEvent(session.sessionId, event);
			else {
				const published = projectKnowledgeEvent(event);
				if (published) deps.traces.record(session.sessionId, published as AgentSessionEvent);
			}
			if (event.type === "tool_execution_start") {
				const args = (event.args ?? {}) as Record<string, unknown>;
				if (event.toolName === "set_status") {
					const text = typeof args.text === "string" ? args.text.replace(/\s+/g, " ").trim() : "";
					if (text) {
						agentStatus = {
							text: [...text].slice(0, 30).join(""),
							phase: typeof args.phase === "string" ? args.phase : undefined,
						};
						publishStatus();
					}
				} else if (event.toolName !== "contact_supervisor") {
					result.currentTool = event.toolName;
					result.currentAction = describeSubagentActivity(event.toolName, args);
					input.onProgress?.(result);
					const descriptor = `${event.toolName} ${JSON.stringify(args)}`.toLowerCase();
					const inferred =
						descriptor.includes("research-zotero") || descriptor.includes("research_zotero")
							? { text: "正在检索 Zotero 文献库…", phase: "literature-search" }
							: descriptor.includes("research-obsidian") || descriptor.includes("research_obsidian")
								? { text: "正在搜索 Obsidian 知识库…", phase: "knowledge-search" }
								: descriptor.includes("web_search") || descriptor.includes("web-search")
									? { text: "正在联网检索相关研究…", phase: "web-search" }
									: descriptor.includes("fetch")
										? { text: "正在读取并核对原始来源…", phase: "reading" }
										: null;
					if (inferred) {
						hostStatus = { ...inferred, toolCallId: event.toolCallId };
						publishStatus();
					}
				}
			}
			if (event.type === "tool_execution_end" && hostStatus?.toolCallId === event.toolCallId) {
				hostStatus = null;
				publishStatus();
			}
			if (
				event.type === "tool_execution_end" &&
				result.currentTool === event.toolName &&
				event.toolName !== "contact_supervisor"
			) {
				result.currentTool = "";
				result.currentAction = agentStatus?.text ?? "正在继续任务";
				input.onProgress?.(result);
			}
			if (event.type === "message_end") {
				addSubagentUsage(result.usage, usageFromMessage(event.message));
				input.onProgress?.(result);
			}
			if (event.type === "agent_settled") {
				settled = true;
				resolve();
			}
		});
	});
	const abort = () => {
		void session.abort();
	};
	if (input.signal) {
		if (input.signal.aborted) abort();
		else input.signal.addEventListener("abort", abort, { once: true });
	}
	try {
		// sessionFile 已在创建时落盘；先通知父工具/UI，用户即可在首个模型事件前进入实时子会话。
		input.onProgress?.(result);
		await deps.traces.start(session.sessionId, session.sessionManager.getSessionDir());
		// expandPromptTemplates: false——子会话无任何模板/命令，任务文本以 "/" 开头也不触发命令解析
		await session.prompt(input.task, { expandPromptTemplates: false });
		if (!settled) await endPromise;
		result.content = assistantText(session);
		result.exitCode = input.signal?.aborted ? 1 : 0;
		// 子会话 LLM 错误不一定 throw（stopReason "error" 体现在最后一条 assistant 消息上）
		const lastAssistant = [...session.messages]
			.reverse()
			.find((message) => (message as { role?: string }).role === "assistant") as
			| { stopReason?: string; errorMessage?: string }
			| undefined;
		if (lastAssistant?.stopReason === "error") {
			result.exitCode = 1;
			result.error = lastAssistant.errorMessage ?? "subagent model error";
		}
	} catch (error) {
		failure = error instanceof Error ? error.message : String(error);
		result.exitCode = 1;
		result.error = failure;
	} finally {
		unsubscribeEvents?.();
		unregisterLiveChild?.();
		for (const pending of pendingSupervisor.values())
			pending.reject(new Error("Subagent finished before supervisor reply"));
		pendingSupervisor.clear();
		input.signal?.removeEventListener("abort", abort);
		await deps.traces.stop(session.sessionId);
		session.dispose();
	}
	if (failure && !result.error) result.error = failure;
	// totalTokens 从未上报时回落 input+output（卡片 tokens 展示用）
	if (result.usage.totalTokens.tokens === 0) {
		result.usage.totalTokens.tokens = result.usage.input + result.usage.output;
	}
	// 子会话在任何消息落盘前失败时 sessionFile 不存在——不给卡片一个打不开的点击目标
	if (result.artifactPaths.jsonlPath && !existsSync(result.artifactPaths.jsonlPath)) {
		result.artifactPaths = {};
	}
	return result;
}
