import { useI18nStore } from "../../i18n";

/** Zotero 面板文案（独立于 Obsidian 知识库 copy.ts；同样 zh 为键源、en 必须镜像每个键）。 */
export const zoteroZh = {
	title: "Zotero 文献库",
	subtitle: "Zotero 管来源（PDF、条目、标注）；Obsidian 管可引用的知识。二者分开接入。",
	refresh: "刷新",
	loading: "加载中…",
	statusTitle: "接入状态",
	statusLine: "Zotero 桌面端 · 本机 API · 写入方式",
	localApiOk: "本机 API 可达",
	localApiNo: "本机 API 不可达",
	desktopMissing: "未检测到 Zotero 桌面端",
	version: "版本 {version}",
	writeModeLocal: "本机写入（Zotero 10+）",
	writeModeWeb: "网页 API（Zotero 9 及以下）",
	advancedLegacy: "旧版 Zotero / 高级写入方式",
	crossTitle: "与知识库的关系",
	crossHint:
		"Zotero 只是来源上游；命中的文献要整理为 Obsidian 的 Library/Papers 笔记后才可被引用。先建 Vault。",
	gotoObsidian: "打开 Obsidian 知识库",
	statusUnavailable: "本机 API 不可达，请启动 Zotero 后刷新。",
	localTitle: "本机写入（Zotero 10+，推荐）",
	localHint:
		"在 Zotero 里授权一次，Agent 就能在本机把已有条目归入分类、挂 PDF，不需要网页 API 密钥，PDF 不占 Zotero 云存储。每次修改仍会先征求你的同意。",
	localAuthorize: "在 Zotero 中授权",
	localAuthorizing: "请到 Zotero 弹出的对话框里选「始终允许」…",
	localAuthorized: "已授权：Agent 可以在本机修改已有条目。",
	localFromEnv: "来自环境变量 ZOTERO_LOCAL_API_KEY，在设置里不可更改。",
	localNotAuthorized:
		"未授权。点按钮后 Zotero 会弹出对话框，请选「始终允许」（「允许」只能用一次，不会保存）。",
	localStale: "已保存的授权属于另一个 Zotero 数据库（换过数据目录），请重新授权。",
	localUnsupported: "当前 Zotero 版本不支持本机写入（需要 Zotero 10 或更新），请用下面的网页 API。",
	localUnreachable:
		"连不上 Zotero 桌面端：请先启动 Zotero，并在 设置 → 高级 勾选「允许此计算机上的其他应用程序与 Zotero 通讯」。",
	localClear: "移除授权",
	localClearHint:
		"移除后 Drone 不再保存这把 key；Zotero 自己的授权记录可在 Zotero 设置 → 高级 →「清除写入授权」里清除。",
	webTitle: "网页 API（修改已有条目）",
	webHint:
		"Zotero 9 及更早版本的本机 API 是只读的：把已有条目归入分类、挂 PDF 要走网页 API。Zotero 10+ 优先用上面的本机写入，不需要这个密钥。新建条目也不需要它。",
	webSteps:
		"在 Zotero 网站 → Settings → Security → Applications → Create new private key，勾选「Allow library access」和「Allow write access」，复制密钥粘贴到这里。",
	webKeyLabel: "API 密钥",
	webKeyPlaceholder: "粘贴私钥（只保存在本机，不进对话）",
	webGroupLabel: "群组库 ID（可选，留空 = 个人库）",
	webSave: "校验并保存",
	webClear: "移除密钥",
	webConfigured: "已配置：{library}（密钥 …{hint}）",
	webNotConfigured: "未配置：Agent 只能新建条目，不能修改已有条目的分类或附件。",
	webFromEnv: "来自环境变量 ZOTERO_API_KEY（…{hint}），在设置里不可更改。",
	webSaved: "已保存，Agent 现在可以修改已有条目（每次修改仍会先征求你的同意）。",
	webInvalidInput: "没有保存：密钥应为 16–64 位字母或数字，群组库 ID 最多 20 位数字。",
	instTitle: "机构访问（一次登录，自动保存模板）",
	instIntro:
		"Agent 在归档文献时若遇到付费墙，会自动请求机构登录。点“登录机构账号”后在弹出窗口完成学校/图书馆登录（支持 EZproxy / Shibboleth / CARSI / OpenAthens / WebVPN），系统会自动从 URL 中识别并保存 EZproxy 模板（例如 .../login?url=%s），无需手动填写。登录态保存在持久分区，重启仍有效。任务授权后会自动尝试下载（每任务最多 {limit} 篇），仅在过期或验证码时再次弹窗。",
	instLoginState: "登录状态",
	instLoggedIn: "已登录",
	instLoggedOut: "未登录",
	instCookies: "Cookie 数",
	instLastLogin: "上次登录",
	instNever: "从未",
	instTemplate: "自动模板",
	instNoTemplate: "未自动识别（直连会话）",
	instName: "机构名",
	instUnset: "未填",
	instAutoDownload: "自动下载",
	instOn: "开启",
	instOff: "关闭",
	instPerTask: "每任务上限",
	instPapers: "{n} 篇",
	instLogin: "登录机构账号（自动保存模板）",
	instRefresh: "刷新状态",
	instClear: "清除登录状态",
	instTestTitle: "测试访问（经机构会话/自动模板尝试）",
	instTesting: "测试中…",
	instTest: "测试",
	instWorkflow:
		"工作流：Agent 调用 research_archive_source → OA 失败 → 返回 institutional_auth_required → Agent 自动调用 research_institutional_login 打开窗口 → 你登录 → 系统自动识别模板（如 https://ezproxy.xxx.edu/login?url=%s）并保存到 ~/.pi/agent/institutional.json → 重试下载。不需要手动设置模板。",
	instWebvpn:
		"提示：若你的学校使用 WebVPN（如 https://webvpn.xxx.edu.cn/https/443/www.nature.com/...），直接登录即可，无需模板，系统靠持久 Cookie 直连。EZproxy 会自动保存，下次无需再登录。",
} as const;

export const zoteroEn: Record<keyof typeof zoteroZh, string> = {
	title: "Zotero Library",
	subtitle:
		"Zotero holds sources (PDFs, items, annotations); Obsidian holds citable knowledge. Set up separately.",
	refresh: "Refresh",
	loading: "Loading…",
	statusTitle: "Connection status",
	statusLine: "Zotero desktop · local API · write mode",
	localApiOk: "Local API reachable",
	localApiNo: "Local API unreachable",
	desktopMissing: "Zotero desktop was not detected",
	version: "Version {version}",
	writeModeLocal: "Local writes (Zotero 10+)",
	writeModeWeb: "Web API (Zotero 9 and older)",
	advancedLegacy: "Older Zotero / advanced write mode",
	crossTitle: "Relationship to the knowledge base",
	crossHint:
		"Zotero is only the source upstream; hits must be deposited as Obsidian Library/Papers notes before they can be cited. Set up the Vault first.",
	gotoObsidian: "Open Obsidian knowledge",
	statusUnavailable: "The local API is unreachable. Start Zotero and refresh.",
	localTitle: "Local writes (Zotero 10+, recommended)",
	localHint:
		"Authorize once in Zotero and the agent can file existing items into collections and attach PDFs on this computer — no Web API key, and PDFs do not use Zotero storage. It still asks you before each change.",
	localAuthorize: "Authorize in Zotero",
	localAuthorizing: "In the dialog Zotero shows, choose “Always Allow”…",
	localAuthorized: "Authorized: the agent can change existing items locally.",
	localFromEnv: "From the ZOTERO_LOCAL_API_KEY environment variable; not editable here.",
	localNotAuthorized:
		"Not authorized. Zotero will show a dialog — choose “Always Allow” (“Allow” works for one write only and is not saved).",
	localStale:
		"The saved authorization belongs to a different Zotero database (data directory changed); authorize again.",
	localUnsupported:
		"This Zotero version has no local write support (Zotero 10 or newer is needed); use the Web API below.",
	localUnreachable:
		"Zotero desktop is not reachable: start Zotero and enable Settings → Advanced → “Allow other applications on this computer to communicate with Zotero”.",
	localClear: "Remove authorization",
	localClearHint:
		"Drone forgets the key; Zotero's own record of the grant is cleared under Zotero Settings → Advanced → “Clear Write Authorizations”.",
	webTitle: "Web API (change existing items)",
	webHint:
		"On Zotero 9 and older the local API is read-only, so filing an existing item into a collection or attaching a PDF goes through the Web API. On Zotero 10+ local writes above are used first and this key is not needed. Creating new items does not need it either.",
	webSteps:
		"On zotero.org → Settings → Security → Applications → Create new private key, tick “Allow library access” and “Allow write access”, then paste the key here.",
	webKeyLabel: "API key",
	webKeyPlaceholder: "Paste the private key (stored on this computer only, never in chat)",
	webGroupLabel: "Group library ID (optional; empty = personal library)",
	webSave: "Verify and save",
	webClear: "Remove key",
	webConfigured: "Configured: {library} (key …{hint})",
	webNotConfigured:
		"Not configured: the agent can create items but cannot change collections or attachments of existing ones.",
	webFromEnv: "From the ZOTERO_API_KEY environment variable (…{hint}); not editable here.",
	webSaved: "Saved. The agent can now change existing items (it still asks you before each change).",
	webInvalidInput:
		"Not saved: the key must be 16–64 letters or digits and the group library ID at most 20 digits.",
	instTitle: "Institutional access (log in once, template saved automatically)",
	instIntro:
		"When the agent hits a paywall while archiving literature, it asks for an institutional login. Click “Log in to institution” and sign in to your university/library in the pop-up (EZproxy / Shibboleth / CARSI / OpenAthens / WebVPN); the EZproxy template (e.g. .../login?url=%s) is recognised from the URL and saved automatically. The login lives in a persistent partition and survives restarts. After a task is authorized, downloads are tried automatically (up to {limit} per task); you are only asked again when the login expires or a CAPTCHA appears.",
	instLoginState: "Login state",
	instLoggedIn: "Logged in",
	instLoggedOut: "Not logged in",
	instCookies: "Cookies",
	instLastLogin: "Last login",
	instNever: "Never",
	instTemplate: "Template",
	instNoTemplate: "Not detected (direct session)",
	instName: "Institution",
	instUnset: "Not set",
	instAutoDownload: "Automatic download",
	instOn: "On",
	instOff: "Off",
	instPerTask: "Per-task limit",
	instPapers: "{n} papers",
	instLogin: "Log in to institution (saves the template)",
	instRefresh: "Refresh status",
	instClear: "Clear login",
	instTestTitle: "Test access (through the institutional session / template)",
	instTesting: "Testing…",
	instTest: "Test",
	instWorkflow:
		"Workflow: the agent calls research_archive_source → open access fails → institutional_auth_required → the agent calls research_institutional_login to open the window → you log in → the template (e.g. https://ezproxy.xxx.edu/login?url=%s) is detected and saved to ~/.pi/agent/institutional.json → the download is retried. No manual template setup is needed.",
	instWebvpn:
		"Tip: if your university uses WebVPN (e.g. https://webvpn.xxx.edu.cn/https/443/www.nature.com/...), just log in — no template is needed; the persistent cookies are used directly. EZproxy is saved automatically so you do not need to log in again.",
};

export function formatZoteroText(template: string, params: Record<string, string | number> = {}): string {
	return template.replace(/\{([a-zA-Z0-9_]+)\}/gu, (placeholder, key: string) =>
		Object.hasOwn(params, key) ? String(params[key]) : placeholder,
	);
}

export function useZoteroText() {
	const language = useI18nStore((s) => s.language);
	const dictionary = language === "zh" ? zoteroZh : zoteroEn;
	return (key: keyof typeof zoteroZh, params?: Record<string, string | number>) =>
		formatZoteroText(dictionary[key], params);
}
