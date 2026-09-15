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
