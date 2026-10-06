/** Zotero 文献库接入状态（Zotero 面板用；独立于 Obsidian 知识库） */
export interface ZoteroStatus {
	/** zotero MCP server 是否已写入 ~/.pi/agent/mcp.json */
	registered: boolean;
	/** 已注册且未被 disabled（=真正生效） */
	enabled: boolean;
	/** 注册的 zotero-mcp 命令路径（未注册为 null） */
	command: string | null;
	/** Zotero 本机 API（桌面端「允许本机其他应用通信」）是否可达 */
	localApiReachable: boolean;
	/** 是否检测到 Zotero 桌面端可执行文件 */
	desktopDetected: boolean;
	/** 检测到的 Zotero 桌面端路径（未检测到为 null） */
	desktopPath: string | null;
	/** zotero-mcp 文档地址 */
	docsUrl: string;
	/** Zotero 桌面端下载地址 */
	downloadUrl: string;
}

/** Zotero 网页 API（修改已有条目：归入分类、挂附件）的配置状态；不含密钥本身 */
export interface ZoteroWebApiStatus {
	configured: boolean;
	/** settings = 在 Drone 设置里保存的；env = 来自环境变量 ZOTERO_API_KEY（优先，不可在界面里改） */
	source: "settings" | "env" | null;
	libraryType: "users" | "groups";
	libraryId: string | null;
	username: string | null;
	/** 密钥是否有该库的写权限（未知为 null） */
	write: boolean | null;
	/** 密钥末 4 位，便于辨认 */
	keyHint: string | null;
}

export interface ZoteroWebApiSaveInput {
	apiKey: string;
	/** 默认个人库；群组库填 groups + 群组 ID */
	libraryType?: "users" | "groups";
	libraryId?: string;
}

/**
 * Zotero 10+ 本机写入：Zotero 弹窗授权（「始终允许」）后发的本机 key，与 zotero.org 密钥无关。
 * 有了它，归入分类、挂 PDF 都在本机完成，不需要网页 API 密钥。不含 key 本身。
 */
export interface ZoteroLocalWriteStatus {
	/** Zotero 桌面端本机 API 是否可达 */
	reachable: boolean;
	/** 当前 Zotero 是否支持本机写入（Zotero 10+：响应带 Zotero-Server-ID）；不可达时为 null */
	supported: boolean | null;
	/** 已保存的 key 属于当前这个 Zotero 数据库，可用于写入 */
	authorized: boolean;
	/** settings = Drone 授权保存的；env = 来自环境变量 ZOTERO_LOCAL_API_KEY */
	source: "settings" | "env" | null;
	/** 已保存的 key 属于别的 Zotero 数据库（换了数据目录），需要重新授权 */
	staleServer: boolean;
}
