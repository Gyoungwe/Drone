import { cardLink, literatureCard } from "../lib/knowledge/flow-cards.mjs";
import { recordZoteroWrite } from "../lib/literature-operations.mjs";
import { normalizeDoi } from "../lib/literature-receipt.mjs";
import { registerAcceptanceVerifier } from "../lib/tasks/acceptance.mjs";
import { registerTool } from "../lib/tool-manifest.mjs";
import { createCompositeZoteroReconciler } from "../lib/zotero-reconcile.mjs";
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
export function registerZoteroAcceptance() {
	const reconcile = createCompositeZoteroReconciler();
	return registerAcceptanceVerifier("zotero_item", {
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
	});
}

/** 计划时未点名 DOI 的槽位：同一任务里每个槽位同时只放行一次写入（并行批量写入时两篇不会争同一槽位）。 */
const slotClaims = new Map();
function claimSlot(taskId, milestoneId) {
	const key = String(taskId || "");
	const claimed = slotClaims.get(key) || new Set();
	if (claimed.has(milestoneId)) return false;
	claimed.add(milestoneId);
	slotClaims.delete(key);
	slotClaims.set(key, claimed);
	while (slotClaims.size > 64) slotClaims.delete(slotClaims.keys().next().value);
	return true;
}
/**
 * Task-level consent covers DOIs named by zotero_item milestones of an authorized, unchanged plan,
 * plus the DOI-less slots that plan declared ("one paper written after close reading"): the host lists
 * only slots not yet bound by a write receipt, so each slot admits exactly one write.
 */
async function taskConsentFor(pi, ctx, doi) {
	let grant = null;
	await pi.events?.emit?.("drone:task-write-consent", {
		cwd: ctx.cwd,
		sessionId: ctx.sessionManager?.getSessionId?.(),
		respond: (value) => {
			grant = value;
		},
	});
	const items = Array.isArray(grant?.acceptances) ? grant.acceptances : [];
	const named = items.find((entry) => entry?.kind === "zotero_item" && normalizeDoi(entry?.doi) === doi);
	if (named)
		return { taskId: grant.taskId || null, milestoneId: named.milestoneId || null, via: "task-plan" };
	for (const entry of items) {
		if (entry?.kind !== "zotero_item" || !entry.slot || !entry.milestoneId) continue;
		if (!claimSlot(grant.taskId, entry.milestoneId)) continue;
		return {
			taskId: grant.taskId || null,
			milestoneId: entry.milestoneId,
			via: "task-plan-slot",
			release: () => slotClaims.get(String(grant.taskId || ""))?.delete(entry.milestoneId),
		};
	}
	return null;
}
// Same desktop AskGate/AskDialog as ask_user and task authorization; only an exact host-owned choice writes.
async function consentToZoteroSave(pi, ctx, plan, signal) {
	const task = await taskConsentFor(pi, ctx, plan.doi);
	if (task) return { granted: true, ...task };
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
		try {
			receipt = consent.granted
				? await executeZoteroSave(plan, { signal, ...deps })
				: receiptWithoutWrite({ ...plan, action: "cancelled", reason: "user-declined" });
		} catch (error) {
			consent.release?.();
			throw error;
		}
		// 槽位写入没有成功读回：把槽位还回去，下一篇（或重试）还能用；成功的写入由宿主绑定回执后自然占住这一项
		if (!SAVE_BOUND_STATUSES.has(receipt.status)) consent.release?.();
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
	registerZoteroAcceptance();

	registerTool(pi, {
		name: "research_zotero_status",
		label: "Zotero literature status",
		drone: {
			readOnly: true,
			capabilities: ["research", "external"],
			activity: { text: "正在检查 Zotero 接入状态…", phase: "verification" },
			// MCP 代理工具 research-zotero_*（含子代理只读通道）的状态条 / 动作文案由这里声明
			families: [
				{
					match: "research-zotero",
					label: "Zotero",
					readOnly: true,
					capabilities: ["research", "external"],
					activity: {
						text: "正在检索 Zotero 文献库…",
						phase: "literature-search",
						verb: "正在检索 Zotero",
						queryKeys: ["query", "q", "search", "search_text", "text"],
					},
				},
			],
		},
		description:
			"Read-only: report zotero-cli/zotero-mcp paths, installer availability, local Zotero API reachability, and MCP registration. Does not install software or write the Vault.",
		parameters: { type: "object", properties: {} },
		async execute() {
			const status = await inspectZotero();
			return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }], details: status };
		},
	});

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

	registerTool(pi, {
		name: "research_zotero_save",
		label: "Save one paper to Zotero (host-controlled)",
		drone: {
			capabilities: ["research", "external"],
			subagent: "exclude",
			activity: { text: "正在写入 Zotero 文献库…", phase: "literature-write" },
			flow: "literature",
			flowCards: (event) => literatureCard(event, { write: true }),
		},
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
