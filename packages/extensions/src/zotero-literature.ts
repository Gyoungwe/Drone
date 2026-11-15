// @ts-nocheck
import { cardLink } from "@gyoungwe/pi-knowledge/host";
import {
	bootstrapZotero,
	createCompositeZoteroReconciler,
	inspectZotero,
	normalizeDoi,
	registerZoteroMcp,
	setupZoteroAgentMessage,
	ZOTERO_SETUP_BINDING,
} from "@gyoungwe/pi-research/host";
import { bindRuntime, withHostRuntime } from "./internal/runtime/runtime-bridge";
import { registerTool } from "./internal/runtime/tool-manifest";

const ZOTERO_KEY = /^[A-Z0-9]{8}$/;
/** 把只读读回结果补成通用证据行（摘要 / 附注 / 动作链接）：桌面端不认识 Zotero，措辞与链接都在这里。 */
export function describeZoteroEvidence(result) {
	const key = ZOTERO_KEY.test(result?.itemId || "") ? result.itemId : null;
	const state = result?.state || "unknown";
	const summary =
		state === "found" && key
			? `Zotero 已找到条目 ${key}`
			: state === "not-found"
				? "Zotero 中未找到该 DOI"
				: state === "ambiguous"
					? "Zotero 中有多条同 DOI 条目"
					: `Zotero 暂不可核对：${result?.reason || state}`;
	const via =
		result?.verifier === "zotero-local-api-item-identity" ? "本机" : result?.verifier ? "云端" : null;
	const pdf = (result?.attachments || []).some((a) => a?.contentType === "application/pdf");
	const note = [via, state === "found" ? (pdf ? "有 PDF 附件（未读）" : "仅元数据") : null]
		.filter(Boolean)
		.join(" · ");
	return {
		...result,
		summary,
		note: note || null,
		links: key
			? [
					cardLink(
						"resource",
						`zotero://select/library/items/${key}`,
						"在 Zotero 中打开",
						"flow.link.openInZotero",
					),
				]
			: [],
	};
}

const SAVE_BOUND_STATUSES = new Set(["saved", "reused"]);
/** 写入回执 → 可绑定到 zotero_item 里程碑的身份：只认宿主自己读回过的条目（saved / reused + 8 位 key）。 */
export function identifyZoteroReceipt(event, details) {
	if (event?.toolName !== "research_zotero_save") return null;
	const receipt = details && typeof details === "object" ? details : {};
	if (!SAVE_BOUND_STATUSES.has(receipt.status) || !ZOTERO_KEY.test(receipt.zoteroKey || "")) return null;
	const doi = normalizeDoi(receipt.doi);
	return /^10\.\d{4,9}\/\S+$/.test(doi) ? { doi } : null;
}
/**
 * zotero_item 里程碑验收（挂钩 2）：只读回 Zotero 条目身份（DOI → item key / 附件元数据），
 * 不写入、不代表读过全文。同意决策仍在宿主任务工作台。
 * DOI 可以在计划时留空（检索/精读后才知道是哪篇）：写入回执经 identify 绑定后再读回；
 * 计划里写错了 DOI 时由 task_wait kind=rebind 请用户确认更换。
 */
export function zoteroAcceptanceDefinition() {
	const reconcile = createCompositeZoteroReconciler();
	return {
		fields: ["doi", "libraryId", "collection"],
		evidenceKind: "zotero-read-only-item-identity",
		label: (acceptance) =>
			acceptance.doi
				? `文献进入 Zotero（${acceptance.doi}）`
				: "文献进入 Zotero（本任务精读后写入的一篇；写入时不再单独询问）",
		verify: async (acceptance) =>
			acceptance.doi
				? describeZoteroEvidence(await reconcile(acceptance))
				: { state: "pending", reason: "doi-unbound", summary: "还没有文献绑定到这一项" },
		identify: identifyZoteroReceipt,
		// 已批准契约里点名的 DOI：写入同意可复用任务授权，不再弹第二张卡。
		// 计划时留空 DOI 的一项是"精读后写入的一篇"槽位：授权卡上写明了这一点，
		// 宿主只把尚未绑定的槽位列进写入同意，每个槽位放行一次写入。
		consent: (acceptance) => ({
			...(acceptance.doi ? { doi: acceptance.doi } : { slot: true }),
			libraryId: acceptance.libraryId || null,
			collection: acceptance.collection || null,
		}),
		pending: (m) =>
			m.acceptance.doi
				? {
						reason: `Zotero 里还没有读回这条文献（${m.acceptance.doi}）的身份`,
						next: "先用 research_zotero_save / research_verify_literature 写入并核对，再继续；若这个 DOI 本身不对，用 task_wait kind=rebind 请用户确认换成真实文献",
					}
				: {
						reason: "这一项还没有对应的文献：精读后写入 Zotero 的回执会把 DOI 绑定过来",
						next: "对精读过的每篇调用 research_zotero_save（任务授权已涵盖，不再逐条询问），宿主读回后自动绑定并验收",
					},
	};
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
	bindRuntime(pi);
	const run = (operation) => withHostRuntime(pi, operation);
	const declaration = { version: 1, kind: "zotero_item", definition: zoteroAcceptanceDefinition() };
	const publishAcceptance = () => pi.events.emit("drone:acceptance-verifier/v1", declaration);
	const removeAcceptance = pi.events.on("drone:acceptance-verifier/request/v1", (payload) => {
		if (payload?.version === 1) publishAcceptance();
	});
	pi.on("session_shutdown", removeAcceptance);
	publishAcceptance();

	registerTool(pi, {
		name: "research_setup_zotero",
		label: "Install Zotero CLI and register optional MCP",
		drone: {
			capabilities: ["research", "external"],
			subagent: "exclude",
			activity: { text: "正在配置 Zotero 接入…", phase: "setup" },
		},
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
			return run(async () => {
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
			});
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
