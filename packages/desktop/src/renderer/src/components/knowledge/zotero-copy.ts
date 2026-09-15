import { useI18nStore } from "../../i18n";

/** Zotero 面板文案（独立于 Obsidian 知识库 copy.ts；同样 zh 为键源、en 必须镜像每个键）。 */
export const zoteroZh = {
	title: "Zotero 文献库",
	subtitle: "Zotero 管来源（PDF、条目、标注）；Obsidian 管可引用的知识。二者分开接入。",
	refresh: "刷新",
	loading: "加载中…",
	statusTitle: "接入状态",
	registered: "已注册 MCP",
	notRegistered: "未注册 MCP",
	enabledState: "已启用（生效）",
	disabledState: "已注册但未启用",
	localApiOk: "本机 API 可达",
	localApiNo: "本机 API 不可达",
	desktopOk: "检测到 Zotero 桌面端",
	desktopNo: "未检测到 Zotero 桌面端",
	enableLabel: "启用 Zotero MCP",
	enableHintNeedSetup: "请先完成下方「一键接入」注册 MCP，再启用。",
	reloadHint: "MCP 开关变更将在下一次会话重载/重启后对工具生效。",
	toggleFailed: "切换失败，请重试。",
	setupTitle: "从零接入",
	setupHint: "安装 zotero-mcp-server 并注册可选 MCP（默认关闭）。安装流程与确认会在当前会话中进行。",
	setupSteps: "准备：安装 Zotero 桌面端 → 打开「允许本机其他应用通信」→ 接入 CLI。",
	setupButton: "一键接入 / 安装",
	setupNoCwd: "请先选择一个项目或打开会话，再接入。",
	openApp: "打开 Zotero",
	openDocs: "zotero-mcp 文档",
	download: "下载 Zotero",
	crossTitle: "与知识库的关系",
	crossHint:
		"Zotero 只是来源上游；命中的文献要沉淀成 Obsidian 的 Library/Papers 笔记后才可被引用。先建 Vault。",
	gotoObsidian: "打开 Obsidian 知识库",
} as const;

export const zoteroEn: Record<keyof typeof zoteroZh, string> = {
	title: "Zotero Library",
	subtitle:
		"Zotero holds sources (PDFs, items, annotations); Obsidian holds citable knowledge. Set up separately.",
	refresh: "Refresh",
	loading: "Loading…",
	statusTitle: "Connection status",
	registered: "MCP registered",
	notRegistered: "MCP not registered",
	enabledState: "Enabled (active)",
	disabledState: "Registered but not enabled",
	localApiOk: "Local API reachable",
	localApiNo: "Local API unreachable",
	desktopOk: "Zotero desktop detected",
	desktopNo: "Zotero desktop not detected",
	enableLabel: "Enable Zotero MCP",
	enableHintNeedSetup: "Run “Connect / install” below to register the MCP first, then enable.",
	reloadHint: "MCP toggle takes effect for tools after the next session reload/restart.",
	toggleFailed: "Toggle failed, please retry.",
	setupTitle: "Connect from zero",
	setupHint:
		"Installs zotero-mcp-server and registers the optional MCP (disabled by default). Install and confirmation happen in the current session.",
	setupSteps:
		"Preparation: install Zotero desktop → enable “Allow other applications to communicate” → connect the CLI.",
	setupButton: "Connect / install",
	setupNoCwd: "Select a project or open a session before connecting.",
	openApp: "Open Zotero",
	openDocs: "zotero-mcp docs",
	download: "Download Zotero",
	crossTitle: "Relationship to the knowledge base",
	crossHint:
		"Zotero is only the source upstream; hits must be deposited as Obsidian Library/Papers notes before they can be cited. Set up the Vault first.",
	gotoObsidian: "Open Obsidian knowledge",
};

export function useZoteroText() {
	const language = useI18nStore((s) => s.language);
	const dictionary = language === "zh" ? zoteroZh : zoteroEn;
	return (key: keyof typeof zoteroZh) => dictionary[key];
}
