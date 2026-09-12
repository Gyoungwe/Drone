import { knowledgeDirectory, readKnowledgeBinding } from "../lib/knowledge/config.mjs";
import { registerKnowledgeInterface } from "../lib/knowledge/extension.mjs";
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

async function startSetup(pi, args, ctx) {
	if (!ctx.hasUI) throw new Error("Obsidian MCP /obsidian-setup requires an interactive desktop UI");
	const skillCommand = `skill:${OBSIDIAN_SETUP_BINDING.skill}`;
	if (!pi.getCommands().some((command) => command.source === "skill" && command.name === skillCommand)) {
		throw new Error(
			"Obsidian MCP setup requires the research-vault skill. Load the bundled skill and run /reload before retrying /obsidian-setup.",
		);
	}
	const current = await obsidianStatus(ctx.cwd);
	let selectedPath = null;
	if (args?.trim().startsWith("{")) {
		try {
			const supplied = JSON.parse(args);
			if (typeof supplied.vaultPath === "string") {
				selectedPath = supplied.vaultPath;
				args = "";
			}
		} catch {
			/* ordinary user preferences */
		}
	}
	const input =
		selectedPath ||
		(await ctx.ui.input("Obsidian · Vault 路径", current.vault || "/absolute/path/to/your/Obsidian Vault"));
	if (!input) return;
	const vault = resolveSetupVault(input, ctx.cwd);
	const context = await inspectObsidianSetup({ cwd: ctx.cwd, vault });
	pi.sendUserMessage(setupAgentMessage({ context, current, preferences: args || "" }), {
		deliverAs: "followUp",
		expandPromptTemplates: true,
	});
}

export default function obsidianWorkbench(pi) {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	const knowledge = registerKnowledgeInterface(pi);

	pi.registerTool({
		name: "research_setup_options",
		label: "Obsidian MCP · research-vault setup options",
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

	pi.registerTool({
		name: "research_setup_obsidian",
		label: "Obsidian MCP · apply research-vault setup",
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
					? "作用范围：整个 Percho。所有项目与新会话使用此知识库；导航内容将提供给当前选择的模型。仅当前项目标识留在项目配置中。"
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

	pi.registerTool({
		name: "research_create_project",
		label: "Create research project",
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

	pi.registerTool({
		name: "research_deposit_knowledge",
		label: "Deposit verified research knowledge",
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
				}),
			);
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
		},
	});

	const { command: setupCommand, skill, aliases } = OBSIDIAN_SETUP_BINDING;
	for (const name of [setupCommand, ...aliases]) {
		pi.registerCommand(name, {
			// Presentation metadata only. The SDK still registers old names for compatibility.
			perchoMenu: {
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
				? `Paired Obsidian vault: ${status.vault}. Profile: ${status.profile || "hybrid"}; deposition: ${status.depositMode || "verified"}; subagent MCP: ${status.subagentMcpPolicy || "read-local"}. Use application research_read_knowledge / research_search_knowledge when application knowledge is enabled; legacy research-obsidian is retrieval-only. Raw MCP writes are intentionally disabled. The parent session publishes persistent knowledge only through research_deposit_knowledge and research_summarize_run, which preserve human review outside pi-agent managed blocks. Subagents may receive read-only local MCP access according to policy but never publish knowledge. Keep large artifacts under results. Finalize runs only after the research_loop evidence gate is answerable.`
				: `Obsidian setup is incomplete (${status.state}). Run /obsidian-setup with the research-vault skill and finish research_setup_obsidian before knowledge writes. Do not claim knowledge has been saved.`;
		const outputGuidance = `Actual session workspace: ${ctx.cwd}. Never substitute the extension installation directory for this project. For research subagents, resolve output files to absolute paths under the chosen run directory. Subagents return evidence and may query local knowledge read-only; they never own persistent Vault writes.`;
		return {
			...(preparation.message ? { message: preparation.message } : {}),
			systemPrompt: `${event.systemPrompt}\n\n${guidance}\n${outputGuidance}\n${preparation.guidance || ""}`,
		};
	});
}
