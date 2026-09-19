import { knowledgeDirectory, readKnowledgeBinding } from "../lib/knowledge/config.mjs";
import { registerKnowledgeInterface } from "../lib/knowledge/extension.mjs";
import { cardLink, flowCard } from "../lib/knowledge/flow-cards.mjs";
import {
	inspectObsidianSetup,
	OBSIDIAN_SETUP_BINDING,
	resolveSetupVault,
	setupAgentMessage,
} from "../lib/obsidian-setup.mjs";
import {
	configureObsidian,
	createObsidianProject,
	depositKnowledge,
	obsidianStatus,
	researchSetupOptions,
} from "../lib/obsidian-workbench.mjs";
import { USER_QUESTION_FOCUS } from "../lib/reply-focus.mjs";
import { registerTool } from "../lib/tool-manifest.mjs";

/** MCP 代理工具 research-obsidian_*（含子代理只读通道）的状态条 / 动作文案。 */
const OBSIDIAN_FAMILY = {
	match: "research-obsidian",
	label: "Obsidian",
	readOnly: true,
	capabilities: ["research", "knowledge"],
	activity: {
		text: "正在搜索 Obsidian 知识库…",
		phase: "knowledge-search",
		verb: "正在检索 Obsidian",
		queryKeys: ["query", "q", "search", "text", "path"],
	},
};
function setupCard(event) {
	const d = event.result?.details || {};
	return flowCard({
		key: event.toolCallId,
		kind: "setup",
		title: "Obsidian setup",
		status: d.cancelled ? "cancelled" : d.state === "ready" ? "setup-complete" : "failed",
		path: d.vault,
		detail: "Global binding and missing structure only.",
		source: event.toolName,
	});
}
function depositCard(event) {
	const d = event.result?.details || {};
	return flowCard({
		key: d.note || event.toolCallId,
		kind: "note",
		title: d.type || event.toolName,
		status: d.note ? "note-written" : "failed",
		path: d.note,
		detail: d.scope,
		links: [d.note ? cardLink("note", d.note, "打开笔记", "flow.link.openNote") : null],
		source: event.toolName,
	});
}

async function startSetup(pi, args, ctx) {
	if (!ctx.hasUI) throw new Error("Obsidian MCP /obsidian-setup requires an interactive desktop UI");
	const current = await obsidianStatus(ctx.cwd);
	let selectedPath = null;
	let preferences = typeof args === "string" ? args : "";
	if (preferences.trim().startsWith("{")) {
		try {
			const supplied = JSON.parse(preferences);
			if (typeof supplied.vaultPath === "string") selectedPath = supplied.vaultPath;
			if (typeof supplied.vaultPath === "string") preferences = "";
		} catch {
			/* ordinary user preferences */
		}
	}
	// Vault-only. Zotero literature is a separate flow now (/zotero-setup + the Zotero panel);
	// this setup no longer installs or bootstraps Zotero. Hand off to the model immediately.
	const vault = selectedPath ? resolveSetupVault(selectedPath, ctx.cwd) : null;
	const context = await inspectObsidianSetup({ cwd: ctx.cwd, vault });
	const vaultPayload = setupAgentMessage({ context, current, preferences });
	const options = { deliverAs: "followUp", expandPromptTemplates: true };
	// Critical: do NOT await sendUserMessage inside this slash turn; run the model handoff
	// only after the slash command returns and the session is idle.
	setTimeout(() => {
		void (async () => {
			try {
				await pi.sendUserMessage(vaultPayload, options);
			} catch (error) {
				const text = error instanceof Error ? error.message : String(error);
				ctx.ui.notify?.(`初始化交接失败：${text}`, "error");
			}
		})();
	}, 0);
}

export default function obsidianWorkbench(pi) {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	const knowledge = registerKnowledgeInterface(pi);

	registerTool(pi, {
		name: "research_setup_options",
		label: "Obsidian MCP · research-vault setup options",
		drone: { readOnly: true, capabilities: ["research", "knowledge"], families: [OBSIDIAN_FAMILY] },
		description:
			"Read-only setup discovery: return the actual session workspace and optional Vault directory overview, current settings, built-in profiles, deposition modes and subagent MCP policies. Does not write or read file contents.",
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Optional absolute target Vault path already supplied by the user.",
				},
			},
		},
		async execute(_id, params, _signal, _update, ctx) {
			const current = await obsidianStatus(ctx.cwd);
			const context = await inspectObsidianSetup({ cwd: ctx.cwd, vault: params.path || current.vault });
			const options = { ...researchSetupOptions(), context, binding: OBSIDIAN_SETUP_BINDING };
			return {
				content: [{ type: "text", text: JSON.stringify({ current, ...options }, null, 2) }],
				details: { current, ...options },
			};
		},
	});

	registerTool(pi, {
		name: "research_setup_obsidian",
		label: "Obsidian MCP · apply research-vault setup",
		drone: {
			capabilities: ["research", "knowledge"],
			subagent: "exclude",
			activity: { text: "正在配置 Obsidian 知识库…", phase: "setup" },
			flow: "setup",
			flowCards: setupCard,
		},
		description:
			"Initialize/bind an independent Obsidian vault, select a built-in knowledge profile, configure controlled deposition, and make research-obsidian retrieval-only. Parent session only. Reload after setup.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				project: { type: "string" },
				profile: { type: "string", enum: ["project", "literature", "hybrid"] },
				deposit_mode: { type: "string", enum: ["run-only", "verified", "rich"] },
				subagent_mcp: { type: "string", enum: ["none", "read-local"] },
			},
			required: ["path", "profile", "deposit_mode", "subagent_mcp"],
		},
		async execute(_id, params, signal, _update, ctx) {
			if (!ctx.hasUI) throw new Error("Obsidian setup needs an interactive confirmation before writing");
			if (signal?.aborted) throw new Error("Obsidian setup aborted");
			const vault = resolveSetupVault(params.path, ctx.cwd);
			const options = researchSetupOptions();
			const profile = options.profiles.find((item) => item.id === params.profile);
			if (
				!profile ||
				!options.depositModes.some((item) => item.id === params.deposit_mode) ||
				!options.subagentMcpPolicies.some((item) => item.id === params.subagent_mcp)
			)
				throw new Error("Invalid setup options");
			const priorBinding = knowledgeDirectory() ? await readKnowledgeBinding({ fresh: true }) : null;
			const summary = [
				`实际项目：${ctx.cwd}`,
				`目标 Vault：${vault}`,
				`知识项目：${params.project || "暂不创建项目"}`,
				`模板：${profile.label}`,
				`项目目录：${profile.projectTypes.join(", ")}`,
				`共享 Library：${profile.libraryTypes.join(", ")}`,
				`知识沉淀：${params.deposit_mode}`,
				`子智能体 MCP：${params.subagent_mcp}`,
				knowledgeDirectory()
					? "作用范围：整个 Drone。所有项目与新会话使用此知识库；导航内容将提供给当前选择的模型。仅当前项目标识留在项目配置中。"
					: "将创建缺失的目录/模板并更新当前项目的 .pi/research-workspace.json 与 .mcp.json。",
				"不搬迁/删除已有笔记；索引仅更新 pi-agent 托管区块。",
			].join("\n");
			// A fresh Ask UI choice, not PermissionGate.confirm: an earlier
			// allowAlways permission must never silently approve a changed setup.
			const choice = await ctx.ui.select(
				`Obsidian · 确认应用初始化方案\n\n${summary}`,
				["确认应用此方案", "取消，不做修改"],
				{ signal },
			);
			const confirmed = choice === "确认应用此方案";
			if (!confirmed || signal?.aborted)
				return {
					content: [{ type: "text", text: "Obsidian setup cancelled. No setup writes were performed." }],
					details: { cancelled: true },
				};
			const result = await configureObsidian({
				cwd: ctx.cwd,
				vault,
				project: params.project || null,
				profile: params.profile,
				depositMode: params.deposit_mode,
				subagentMcpPolicy: params.subagent_mcp,
				expectedRevision: knowledgeDirectory() ? priorBinding?.revision || 0 : null,
			});
			knowledge.setupCompleted(ctx, result);
			return {
				content: [
					{
						type: "text",
						text: `${JSON.stringify(result, null, 2)}\n${result.scope === "application" ? "Application binding is active for subsequent turns. Indexed reads are native; no raw MCP connection is claimed." : "Run /reload before using the refreshed MCP connection."}`,
					},
				],
				details: result,
			};
		},
	});

	registerTool(pi, {
		name: "research_create_project",
		label: "Create research project",
		drone: { capabilities: ["research", "knowledge"], subagent: "exclude" },
		description:
			"Create a project using the configured knowledge profile and update project indexes. Existing projects and human edits are preserved.",
		parameters: {
			type: "object",
			properties: { project: { type: "string" }, title: { type: "string" } },
			required: ["project"],
		},
		async execute(_id, params, _signal, _update, ctx) {
			const result = await knowledge.withTurnBinding(ctx, () =>
				createObsidianProject({
					cwd: ctx.cwd,
					project: params.project,
					title: params.title || params.project,
				}),
			);
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
		},
	});

	registerTool(pi, {
		name: "research_deposit_knowledge",
		label: "Deposit verified research knowledge",
		drone: {
			capabilities: ["research", "knowledge"],
			subagent: "exclude",
			journal: true,
			activity: { text: "正在沉淀研究知识…", phase: "deposit" },
			flow: "note",
			flowCards: depositCard,
		},
		description:
			"Write a typed research object through the controlled managed-block deposition layer. Raw Obsidian MCP writes are intentionally not exposed.",
		parameters: {
			type: "object",
			properties: {
				project: { type: "string" },
				type: {
					type: "string",
					enum: [
						"question",
						"evidence",
						"claim",
						"decision",
						"wiki",
						"paper",
						"method",
						"software",
						"entity",
						"concept",
					],
				},
				title: { type: "string" },
				markdown: { type: "string" },
				source_links: { type: "array", items: { type: "string" } },
				status: { type: "string" },
				scope: {
					type: "string",
					enum: ["project", "shared"],
					description: "For Wiki only: shared publishes a cross-project topic.",
				},
				zotero_key: {
					type: "string",
					description: "8-character Zotero item key for paper notes. Not a publication receipt.",
				},
				zotero_citekey: {
					type: "string",
					description: "Optional Better BibTeX citekey for paper notes.",
				},
			},
			required: ["project", "type", "title", "markdown"],
		},
		async execute(_id, params, _signal, _update, ctx) {
			const result = await knowledge.withTurnBinding(ctx, () =>
				depositKnowledge({
					cwd: ctx.cwd,
					project: params.project,
					type: params.type,
					title: params.title,
					markdown: params.markdown,
					sourceLinks: params.source_links || [],
					status: params.status || "verified",
					targetScope: params.scope || "project",
					zoteroKey: params.zotero_key || null,
					zoteroCitekey: params.zotero_citekey || null,
				}),
			);
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
		},
	});

	const { command: setupCommand, skill, aliases } = OBSIDIAN_SETUP_BINDING;
	for (const name of [setupCommand, ...aliases]) {
		pi.registerCommand(name, {
			// Presentation metadata only. The SDK still registers old names for compatibility.
			droneMenu: {
				version: 1,
				canonical: setupCommand,
				skill,
				role: name === setupCommand ? "primary" : "alias",
			},
			description:
				name === setupCommand
					? `Obsidian MCP · 初始化知识库（${skill} skill）`
					: `Obsidian MCP · 兼容入口 → /${setupCommand}（${skill} skill）`,
			handler: async (args, ctx) => startSetup(pi, args, ctx),
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		const status = await obsidianStatus(ctx.cwd);
		if (status.state === "ready") {
			if (ctx.hasUI)
				ctx.ui.notify(
					`Obsidian: ${status.vault} · ${status.profile || "hybrid"} · ${status.scope === "application" ? "application indexed knowledge" : "MCP retrieval-only"}`,
					"info",
				);
		} else {
			pi.sendMessage(
				{
					customType: "obsidian-setup",
					content: `Obsidian setup required (${status.state}). Run /obsidian-setup (research-vault skill) to initialize an MCP-friendly research knowledge base.`,
					display: true,
				},
				{ triggerTurn: false },
			);
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const preparation = await knowledge.beforeStart(event, ctx);
		const status = await obsidianStatus(ctx.cwd);
		const guidance =
			status.state === "ready"
				? `Vault: ${status.vault}. Read with research_read_knowledge, then search with research_search_knowledge.`
				: `Obsidian setup is incomplete (${status.state}). Run /obsidian-setup before claiming knowledge was saved.`;
		const outputGuidance = `Workspace: ${ctx.cwd}.`;
		return {
			...(preparation.message ? { message: preparation.message } : {}),
			systemPrompt: `${event.systemPrompt}\n\n${guidance}\n${outputGuidance}\n${USER_QUESTION_FOCUS}\n${preparation.guidance || ""}`,
		};
	});
}
