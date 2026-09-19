import { recordZoteroWrite } from "../lib/literature-operations.mjs";
import { normalizeDoi } from "../lib/literature-receipt.mjs";
import {
	bootstrapZotero,
	inspectZotero,
	registerZoteroMcp,
	setupZoteroAgentMessage,
	ZOTERO_SETUP_BINDING,
} from "../lib/zotero-setup.mjs";
import {
	describeZoteroSavePlan,
	executeZoteroSave,
	prepareZoteroSave,
	receiptWithoutWrite,
	ZOTERO_ITEM_TYPES,
} from "../lib/zotero-write.mjs";

const SAVE_ALLOW = "同意写入 Zotero",
	SAVE_DENY = "暂不写入";

/** Task-level consent covers only DOIs named by zotero_item milestones of an authorized, unchanged plan. */
async function taskConsentFor(pi, ctx, doi) {
	let grant = null;
	await pi.events?.emit?.("drone:task-write-consent", {
		cwd: ctx.cwd,
		sessionId: ctx.sessionManager?.getSessionId?.(),
		respond: (value) => {
			grant = value;
		},
	});
	const items = Array.isArray(grant?.zoteroItems) ? grant.zoteroItems : [];
	const match = items.find((entry) => normalizeDoi(entry?.doi) === doi);
	return match ? { taskId: grant.taskId || null, milestoneId: match.milestoneId || null } : null;
}
// Same desktop AskGate/AskDialog as ask_user and task authorization; only an exact host-owned choice writes.
async function consentToZoteroSave(pi, ctx, plan, signal) {
	const task = await taskConsentFor(pi, ctx, plan.doi);
	if (task) return { granted: true, via: "task-plan", ...task };
	if (!ctx.hasUI || !ctx.ui?.select)
		throw new Error(
			"Writing to Zotero needs an authorized task plan naming this DOI as a zotero_item milestone, or an interactive desktop confirmation. Neither is available here; no write performed.",
		);
	const selected = await ctx.ui.select(
		`ask_user · 写入 Zotero 文献库？\n\n${describeZoteroSavePlan(plan)}`,
		[SAVE_DENY, SAVE_ALLOW],
		{ signal },
	);
	return { granted: selected === SAVE_ALLOW && !signal?.aborted, via: "ask-card" };
}
export async function runZoteroSave(pi, params, ctx, signal, deps = {}) {
	const plan = await prepareZoteroSave(params, { signal, ...deps });
	let receipt,
		consent = { via: "not-needed" };
	if (plan.action !== "create") receipt = receiptWithoutWrite(plan);
	else {
		consent = await consentToZoteroSave(pi, ctx, plan, signal);
		receipt = consent.granted
			? await executeZoteroSave(plan, { signal, ...deps })
			: receiptWithoutWrite({ ...plan, action: "cancelled", reason: "user-declined" });
	}
	receipt.consent = {
		via: consent.via,
		taskId: consent.taskId || null,
		milestoneId: consent.milestoneId || null,
	};
	if (params.run_dir) {
		try {
			receipt.journal = await recordZoteroWrite({ cwd: ctx.cwd, runDir: params.run_dir, receipt });
		} catch (error) {
			receipt.journal = { error: String(error.message || error).slice(0, 200) };
		}
	}
	receipt.next = receipt.zoteroKey
		? `research_deposit_knowledge type=paper zotero_key=${receipt.zoteroKey} doi=${receipt.doi}, then research_verify_literature.`
		: "Do not retry automatically. Inspect Zotero or ask the user before any further write.";
	return receipt;
}

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

	pi.registerTool({
		name: "research_zotero_save",
		label: "Save one paper to Zotero (host-controlled)",
		description:
			"Write ONE bibliographic item into the user's Zotero library, keyed by exact DOI. Host-controlled: dedups by DOI first (an existing item is reused, never duplicated), asks the user on a native card unless an authorized task plan lists this DOI as a zotero_item milestone, writes once through Zotero desktop (connector, preferred) or the Zotero Web API (write-scoped ZOTERO_API_KEY from the environment), then reads the item back by DOI. Never retries, deletes, merges or moves items. Attachments are URL-based only: Zotero desktop downloads attachment_url itself; the Web API records it as a linked URL. Returns the receipt (status, zoteroKey, library, fulltextStatus). Follow with research_deposit_knowledge type=paper and research_verify_literature; the Vault note stays the citable object.",
		parameters: {
			type: "object",
			required: ["doi", "title"],
			properties: {
				doi: { type: "string", description: "Exact DOI, e.g. 10.1038/s41586-020-2649-2" },
				title: { type: "string" },
				item_type: {
					type: "string",
					enum: [...ZOTERO_ITEM_TYPES],
					description: "Zotero item type; default journalArticle.",
				},
				creators: {
					type: "array",
					description: "Authors in order. Use last_name/first_name, or name for organisations.",
					items: {
						type: "object",
						properties: {
							last_name: { type: "string" },
							first_name: { type: "string" },
							name: { type: "string" },
							creator_type: { type: "string", description: "author (default), editor, contributor" },
						},
					},
				},
				date: { type: "string" },
				publication: { type: "string", description: "Journal, proceedings, book or repository title." },
				volume: { type: "string" },
				issue: { type: "string" },
				pages: { type: "string" },
				url: { type: "string" },
				abstract: { type: "string" },
				tags: { type: "array", items: { type: "string" } },
				attachment_url: {
					type: "string",
					description:
						"Optional http(s) URL of an open-access PDF whose license allows saving. The host never uploads local files.",
				},
				attachment_title: { type: "string" },
				channel: {
					type: "string",
					enum: ["auto", "connector", "web"],
					description: "auto (default) prefers Zotero desktop, then the Web API.",
				},
				target: {
					type: "string",
					description:
						'Connector only: "L<libraryID>" or "C<collectionID>" as reported by Zotero desktop. Default: the library/collection currently selected in Zotero.',
				},
				collection_key: {
					type: "string",
					description: "Web API only: 8-character collection key to file the item into.",
				},
				run_dir: {
					type: "string",
					description:
						"Research run directory; the receipt is journaled to <run>/literature-operations.json.",
				},
			},
		},
		async execute(_id, params, signal, _update, ctx) {
			const receipt = await runZoteroSave(pi, params || {}, ctx, signal);
			return { content: [{ type: "text", text: JSON.stringify(receipt, null, 2) }], details: receipt };
		},
	});

	pi.registerCommand(ZOTERO_SETUP_BINDING.command, {
		droneMenu: {
			version: 1,
			canonical: ZOTERO_SETUP_BINDING.command,
			skill: ZOTERO_SETUP_BINDING.skill,
			role: "primary",
		},
		description: `Zotero · 从零安装并接入文献库（${ZOTERO_SETUP_BINDING.skill} skill）`,
		handler: async (args, ctx) => startSetup(pi, args, ctx),
	});
}
