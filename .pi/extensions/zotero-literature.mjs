import {
	bootstrapZotero,
	inspectZotero,
	registerZoteroMcp,
	setupZoteroAgentMessage,
	ZOTERO_SETUP_BINDING,
} from "../lib/zotero-setup.mjs";

async function startSetup(pi, args, ctx) {
	if (!ctx.hasUI) throw new Error("Zotero /zotero-setup requires an interactive desktop UI");
	const bootstrap = await bootstrapZotero({
		confirm: (title, message) => ctx.ui.confirm(title, message),
	});
	if (bootstrap.cancelled && bootstrap.steps.length === 0 && !bootstrap.status.commands.zoteroMcp) {
		ctx.ui.notify?.("已取消安装 zotero-mcp-server", "warning");
	} else if (bootstrap.steps.some((step) => step.action === "install")) {
		ctx.ui.notify?.("已安装 zotero-mcp-server；可选 MCP 已写入用户配置（默认关闭）");
	}
	const payload = setupZoteroAgentMessage({
		status: bootstrap.status,
		bootstrap,
		preferences: args || "",
	});
	setTimeout(() => {
		void pi.sendUserMessage(payload, { deliverAs: "followUp", expandPromptTemplates: true });
	}, 0);
}

export default function zoteroLiterature(pi) {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;

	pi.registerTool({
		name: "research_zotero_status",
		label: "Zotero literature status",
		description:
			"Read-only: report zotero-cli/zotero-mcp paths, installer availability, local Zotero API reachability, and MCP registration. Does not install software or write the Vault.",
		parameters: { type: "object", properties: {} },
		async execute() {
			const status = await inspectZotero();
			return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }], details: status };
		},
	});

	pi.registerTool({
		name: "research_setup_zotero",
		label: "Install Zotero CLI and register optional MCP",
		description:
			"Host-owned from-zero setup: optionally install zotero-mcp-server with a fixed uv/pip/pipx command after UI confirm, then register the optional MCP server (disabled by default). Does not install Zotero desktop, does not enable the local API checkbox, and does not copy the library into the Vault.",
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["bootstrap", "install", "register-mcp"],
					description:
						"bootstrap = install if missing then register MCP (default). install = package only. register-mcp = config only.",
				},
				enable: {
					type: "boolean",
					description:
						"Enable the MCP server immediately. Default false; skill/CLI remains the preferred path.",
				},
			},
		},
		async execute(_id, params, _signal, _update, ctx) {
			const action = params.action || "bootstrap";
			if (action === "register-mcp") {
				const status = await inspectZotero();
				const command = status.commands.zoteroMcp;
				if (!command)
					throw new Error(
						`zotero-mcp is not on PATH. Run /zotero-setup or research_setup_zotero(action=bootstrap) to install ${ZOTERO_SETUP_BINDING.package}.`,
					);
				const mcp = await registerZoteroMcp({ command, enable: params.enable === true });
				const result = {
					mcp,
					reloadRequired: true,
					preferred: "zotero-cli via the zotero-literature skill; MCP schemas are optional and expensive",
				};
				return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
			}
			if (!ctx.hasUI) throw new Error("Installing zotero-mcp-server requires an interactive desktop UI");
			const bootstrap = await bootstrapZotero({
				confirm: (title, message) => ctx.ui.confirm(title, message),
				enableMcp: params.enable === true,
			});
			if (action === "install" && bootstrap.cancelled)
				throw new Error("User cancelled zotero-mcp-server installation");
			return {
				content: [{ type: "text", text: JSON.stringify(bootstrap, null, 2) }],
				details: bootstrap,
			};
		},
	});

	pi.registerCommand(ZOTERO_SETUP_BINDING.command, {
		perchoMenu: {
			version: 1,
			canonical: ZOTERO_SETUP_BINDING.command,
			skill: ZOTERO_SETUP_BINDING.skill,
			role: "primary",
		},
		description: `Zotero · 从零安装并接入文献库（${ZOTERO_SETUP_BINDING.skill} skill）`,
		handler: async (args, ctx) => startSetup(pi, args, ctx),
	});
}
