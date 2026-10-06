import { join } from "node:path";
import type { ZoteroWebApiSaveInput, ZoteroWebApiStatus } from "@drone/shared";
import { JsonStore } from "../json-store";
import { getAgentDir } from "../session-engine/sdk";

/**
 * Zotero 网页 API 凭据：修改已有条目（归入分类、挂 PDF）只有网页 API 能做——Zotero 7 本机 API 只读。
 * 密钥保存在 agentDir/zotero-web.json（与 models.json 同级的 secret 文件），启动时与保存后注入
 * process.env（ZOTERO_API_KEY / ZOTERO_LIBRARY_ID / ZOTERO_LIBRARY_TYPE），研究扩展的写入通道直接读取。
 * 用户自己在环境里设置的变量优先，界面不覆盖。
 */
interface StoredCredentials {
	version: 1;
	apiKey: string;
	libraryType: "users" | "groups";
	libraryId: string;
	username: string | null;
	write: boolean;
	savedAt: string;
}

const WEB_API = "https://api.zotero.org";
/** 由本模块注入 env 的标记：区分「用户自己设置的环境变量」与「设置页保存后注入的」 */
const INJECTED = "DRONE_ZOTERO_WEB_FROM_SETTINGS";

function store(): JsonStore<StoredCredentials | null> {
	return new JsonStore<StoredCredentials | null>({
		path: join(getAgentDir(), "zotero-web.json"),
		storageId: "agent-zotero-web",
		defaultValue: () => null,
		mode: 0o600,
	});
}

function envOwnedByUser(env: NodeJS.ProcessEnv): boolean {
	return Boolean(env.ZOTERO_API_KEY) && env[INJECTED] !== "1";
}

function inject(env: NodeJS.ProcessEnv, value: StoredCredentials | null): void {
	if (envOwnedByUser(env)) return;
	if (!value) {
		if (env[INJECTED] === "1") {
			delete env.ZOTERO_API_KEY;
			delete env.ZOTERO_LIBRARY_ID;
			delete env.ZOTERO_LIBRARY_TYPE;
			delete env[INJECTED];
		}
		return;
	}
	env.ZOTERO_API_KEY = value.apiKey;
	env.ZOTERO_LIBRARY_ID = value.libraryId;
	env.ZOTERO_LIBRARY_TYPE = value.libraryType;
	env[INJECTED] = "1";
}

/** 启动时调用：把已保存的凭据注入环境（用户自己的环境变量优先） */
export async function applyStoredZoteroWebCredentials(env: NodeJS.ProcessEnv = process.env): Promise<void> {
	try {
		inject(env, await store().read());
	} catch {
		// 文件损坏时不注入；设置页会显示未配置，重新保存即可
	}
}

export interface ZoteroKeyCheck {
	userID: string;
	username: string | null;
	write: boolean;
	library: boolean;
}

/** 用密钥本身查询权限（GET /keys/current），不把密钥写进任何日志 */
export async function checkZoteroKey(
	apiKey: string,
	libraryType: "users" | "groups",
	libraryId: string | null,
	fetchImpl: typeof fetch = fetch,
): Promise<ZoteroKeyCheck> {
	let response: Response;
	try {
		response = await fetchImpl(`${WEB_API}/keys/current`, {
			headers: { "Zotero-API-Version": "3", "Zotero-API-Key": apiKey, Accept: "application/json" },
			signal: AbortSignal.timeout(15000),
			redirect: "error",
		});
	} catch (error) {
		throw new Error(
			`Cannot reach api.zotero.org (${error instanceof Error ? error.message : String(error)}); check the network or proxy and try again`,
		);
	}
	if (response.status === 403 || response.status === 404) {
		// Zotero 对无效密钥返回纯文本 403；代理/防火墙拦截也可能是 403，把正文带上便于区分
		const body = (await response.text().catch(() => "")).trim().slice(0, 120);
		throw new Error(
			/invalid key|forbidden/i.test(body) || !body
				? "Zotero rejected this API key"
				: `api.zotero.org could not be reached as expected (HTTP ${response.status}: ${body})`,
		);
	}
	if (!response.ok) throw new Error(`Zotero Web API HTTP ${response.status}`);
	const json = (await response.json()) as {
		userID?: number | string;
		username?: string;
		access?: {
			user?: { library?: boolean; write?: boolean };
			groups?: Record<string, { library?: boolean; write?: boolean }>;
		};
	};
	const userID = String(json.userID ?? "");
	const scope =
		libraryType === "groups"
			? (json.access?.groups?.[String(libraryId)] ?? json.access?.groups?.all ?? {})
			: (json.access?.user ?? {});
	return {
		userID,
		username: typeof json.username === "string" ? json.username.slice(0, 100) : null,
		library: scope.library === true,
		write: scope.write === true,
	};
}

export async function getZoteroWebApiStatus(
	env: NodeJS.ProcessEnv = process.env,
): Promise<ZoteroWebApiStatus> {
	if (envOwnedByUser(env))
		return {
			configured: Boolean(env.ZOTERO_LIBRARY_ID || env.ZOTERO_USER_ID),
			source: "env",
			libraryType: env.ZOTERO_LIBRARY_TYPE === "groups" ? "groups" : "users",
			libraryId: env.ZOTERO_LIBRARY_ID || env.ZOTERO_USER_ID || null,
			username: null,
			write: null,
			keyHint: (env.ZOTERO_API_KEY ?? "").slice(-4) || null,
		};
	const saved = await store()
		.read()
		.catch(() => null);
	if (!saved)
		return {
			configured: false,
			source: null,
			libraryType: "users",
			libraryId: null,
			username: null,
			write: null,
			keyHint: null,
		};
	return {
		configured: true,
		source: "settings",
		libraryType: saved.libraryType,
		libraryId: saved.libraryId,
		username: saved.username,
		write: saved.write,
		keyHint: saved.apiKey.slice(-4),
	};
}

/** 校验密钥（必须有写权限）后保存并注入环境 */
export async function saveZoteroWebCredentials(
	input: ZoteroWebApiSaveInput,
	{ env = process.env, fetchImpl = fetch }: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
): Promise<ZoteroWebApiStatus> {
	if (envOwnedByUser(env))
		throw new Error(
			"ZOTERO_API_KEY is set in the environment; change it there or unset it to use Drone settings",
		);
	const apiKey = String(input.apiKey ?? "").trim();
	if (!/^[A-Za-z0-9]{16,64}$/.test(apiKey)) throw new Error("This does not look like a Zotero API key");
	const libraryType = input.libraryType === "groups" ? "groups" : "users";
	const requestedId = String(input.libraryId ?? "").trim();
	if (libraryType === "groups" && !/^\d+$/.test(requestedId))
		throw new Error("A group library needs its numeric group ID");
	const check = await checkZoteroKey(apiKey, libraryType, requestedId || null, fetchImpl);
	if (!check.write)
		throw new Error(
			"This key has no write access to the library. In Zotero → Settings → Security → Applications, create a key with “Allow library access” and “Allow write access”.",
		);
	const value: StoredCredentials = {
		version: 1,
		apiKey,
		libraryType,
		libraryId: libraryType === "groups" ? requestedId : check.userID,
		username: check.username,
		write: check.write,
		savedAt: new Date().toISOString(),
	};
	await store().write(value);
	inject(env, value);
	return getZoteroWebApiStatus(env);
}

export async function clearZoteroWebCredentials(
	env: NodeJS.ProcessEnv = process.env,
): Promise<ZoteroWebApiStatus> {
	await store().write(null);
	inject(env, null);
	return getZoteroWebApiStatus(env);
}
