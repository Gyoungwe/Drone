/** 机构访问配置（~/.pi/agent/institutional.json，用户级；合法机构通道） */
export interface InstitutionalConfig {
	version: 1;
	/** EZproxy 模板，例如 https://ezproxy.example.edu/login?url=%s 或 https://ezproxy.example.edu/login?url= */
	ezproxyTemplate?: string;
	/** OpenURL 解析器基地址，例如 https://resolver.example.edu/openurl */
	openUrlResolver?: string;
	/** 机构显示名（可选，仅展示用） */
	institutionName?: string;
	/** 是否允许任务在授权后自动通过机构会话下载（默认 true） */
	autoDownloadEnabled: boolean;
	/** 每任务自动下载上限（默认 20） */
	perTaskLimit: number;
	/** 上次登录时间 ISO */
	lastLoginAt?: string;
	/** 上次登录时打开的 URL（便于下次直接打开） */
	lastLoginUrl?: string;
	/** 是否已配置（至少有一项模板或曾经登录过） */
	configured?: boolean;
}

export function emptyInstitutionalConfig(): InstitutionalConfig {
	return {
		version: 1,
		autoDownloadEnabled: true,
		perTaskLimit: 20,
	};
}

export interface InstitutionalSessionInfo {
	/** Cookie 数量 */
	cookiesCount: number;
	/** 是否有会话 Cookie（启发式判断已登录） */
	hasSessionCookies: boolean;
	/** 分区名 */
	partition: string;
	/** 最近访问时间（如果有） */
	lastAccessAt?: string;
}

export interface InstitutionalStatus {
	config: InstitutionalConfig;
	session: InstitutionalSessionInfo;
	/** 是否认为已登录（hasSessionCookies || lastLoginAt 在 7 天内） */
	loggedIn: boolean;
	/** 是否可用 Electron 会话（桌面端才为 true） */
	electronAvailable: boolean;
}

export interface InstitutionalTestResult {
	url: string;
	proxiedUrl?: string;
	status: number;
	ok: boolean;
	contentType?: string;
	redirected?: boolean;
	finalUrl?: string;
	error?: string;
	via: "direct" | "ezproxy" | "institutional_session";
}

export interface InstitutionalSaveInput {
	ezproxyTemplate?: string;
	openUrlResolver?: string;
	institutionName?: string;
	autoDownloadEnabled?: boolean;
	perTaskLimit?: number;
}
