import { join } from "node:path";
import type { ZoteroLocalWriteStatus } from "@drone/shared";
import { JsonStore } from "../json-store";
import { getAgentDir } from "../session-engine/sdk";

/**
 * Zotero 10+ 本机写入：本机 API 的写接口要求两个请求头——Zotero-Server-ID（标识 Zotero 数据库，
 * 缺了返回 428）与 Zotero-API-Key（本机 key，缺了或失效返回 401）。本机 key 只能由 Zotero 弹窗授权
 * 发放（POST /api/local/authorize），与 zotero.org 密钥无关。
 *
 * 只有用户选「始终允许」（remember=true）才保存：一次性的 key 用过一次就失效，存下来反而会在之后
 * 每次写入时先撞 401。key 保存在 agentDir/zotero-local.json（0600），启动与授权后注入
 * ZOTERO_LOCAL_API_KEY / ZOTERO_LOCAL_SERVER_ID（与 zotero-mcp 同名），研究扩展的写入通道直接读取。
 * 用户自己在环境里设置的 ZOTERO_LOCAL_API_KEY 优先，界面不覆盖。
 */
interface StoredLocalKey {
	version: 1;
	key: string;
	serverId: string;
	savedAt: string;
}

export const ZOTERO_LOCAL_API = "http://127.0.0.1:23119/api";
const APP_NAME = "Drone";
/** 授权要等用户在 Zotero 里点按钮，给足时间 */
const AUTHORIZE_TIMEOUT_MS = 60_000;
const INJECTED = "DRONE_ZOTERO_LOCAL_FROM_SETTINGS";

function store(): JsonStore<StoredLocalKey | null> {
	return new JsonStore<StoredLocalKey | null>({
		path: join(getAgentDir(), "zotero-local.json"),
		storageId: "agent-zotero-local",
		defaultValue: () => null,
		mode: 0o600,
	});
}

function envOwnedByUser(env: NodeJS.ProcessEnv): boolean {
	return Boolean(env.ZOTERO_LOCAL_API_KEY) && env[INJECTED] !== "1";
}

function inject(env: NodeJS.ProcessEnv, value: StoredLocalKey | null): void {
	if (envOwnedByUser(env)) return;
	if (!value) {
		if (env[INJECTED] === "1") {
			delete env.ZOTERO_LOCAL_API_KEY;
			delete env.ZOTERO_LOCAL_SERVER_ID;
			delete env[INJECTED];
		}
		return;
	}
	env.ZOTERO_LOCAL_API_KEY = value.key;
	env.ZOTERO_LOCAL_SERVER_ID = value.serverId;
	env[INJECTED] = "1";
}

/** 启动时调用：把已保存的本机 key 注入环境（用户自己的环境变量优先） */
export async function applyStoredZoteroLocalKey(env: NodeJS.ProcessEnv = process.env): Promise<void> {
	try {
		inject(env, await store().read());
	} catch {
		// 文件损坏时不注入；设置页会显示未授权，重新授权即可
	}
}

/**
 * 当前 Zotero 数据库的 server ID：本机 API 每个响应都带 Zotero-Server-ID 头；不支持本机写入的旧版本
 * 不带。不可达返回 { reachable: false }。
 */
export async function probeZoteroServerId(
	fetchImpl: typeof fetch = fetch,
): Promise<{ reachable: boolean; serverId: string | null }> {
	try {
		const response = await fetchImpl(`${ZOTERO_LOCAL_API}/`, {
			headers: { "Zotero-API-Version": "3" },
			signal: AbortSignal.timeout(3000),
			redirect: "error",
		});
		const serverId = response.headers.get("zotero-server-id");
		return { reachable: true, serverId: serverId && /^[A-Za-z0-9]{1,64}$/.test(serverId) ? serverId : null };
	} catch {
		return { reachable: false, serverId: null };
	}
}

export async function getZoteroLocalWriteStatus({
	env = process.env,
	fetchImpl = fetch,
}: {
	env?: NodeJS.ProcessEnv;
	fetchImpl?: typeof fetch;
} = {}): Promise<ZoteroLocalWriteStatus> {
	const probe = await probeZoteroServerId(fetchImpl);
	const supported = probe.reachable ? Boolean(probe.serverId) : null;
	if (envOwnedByUser(env)) {
		const pinned = env.ZOTERO_LOCAL_SERVER_ID || null;
		const staleServer = Boolean(pinned && probe.serverId && pinned !== probe.serverId);
		return { reachable: probe.reachable, supported, authorized: !staleServer, source: "env", staleServer };
	}
	const saved = await store()
		.read()
		.catch(() => null);
	const staleServer = Boolean(saved && probe.serverId && saved.serverId !== probe.serverId);
	return {
		reachable: probe.reachable,
		supported,
		authorized: Boolean(saved) && !staleServer,
		source: saved ? "settings" : null,
		staleServer,
	};
}

/**
 * 让 Zotero 弹出授权对话框（允许 / 始终允许 / 拒绝）。只保存「始终允许」发的 key。
 * Zotero 对这个接口限流：不要重试。
 */
export async function authorizeZoteroLocalWrite({
	env = process.env,
	fetchImpl = fetch,
}: {
	env?: NodeJS.ProcessEnv;
	fetchImpl?: typeof fetch;
} = {}): Promise<ZoteroLocalWriteStatus> {
	if (envOwnedByUser(env))
		throw new Error(
			"ZOTERO_LOCAL_API_KEY is set in the environment; change it there or unset it to authorize from Drone",
		);
	const probe = await probeZoteroServerId(fetchImpl);
	if (!probe.reachable)
		throw new Error(
			"Zotero desktop is not reachable. Start Zotero and enable Settings → Advanced → “Allow other applications on this computer to communicate with Zotero”.",
		);
	if (!probe.serverId)
		throw new Error(
			"This Zotero version has no local write support (Zotero 10 or newer is needed); use the Web API key below instead.",
		);
	let response: Response;
	try {
		response = await fetchImpl(`${ZOTERO_LOCAL_API}/local/authorize`, {
			method: "POST",
			headers: {
				"Zotero-API-Version": "3",
				"Zotero-Server-ID": probe.serverId,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ appName: APP_NAME }),
			signal: AbortSignal.timeout(AUTHORIZE_TIMEOUT_MS),
			redirect: "error",
		});
	} catch (error) {
		throw new Error(
			error instanceof Error && error.name === "TimeoutError"
				? "No answer from the Zotero authorization dialog; nothing was saved. Try again and answer the dialog in Zotero."
				: `Cannot reach Zotero desktop (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	if (response.status === 403) throw new Error("Zotero denied the authorization; nothing was saved.");
	if (response.status === 429)
		throw new Error("Zotero is rate-limiting authorization requests; wait a minute and try again.");
	if (!response.ok) throw new Error(`Zotero local authorization failed (HTTP ${response.status})`);
	const json = (await response.json().catch(() => null)) as { key?: unknown; remember?: unknown } | null;
	const key = typeof json?.key === "string" ? json.key.trim() : "";
	if (!/^[A-Za-z0-9]{8,128}$/.test(key))
		throw new Error("Zotero returned no usable local key; nothing was saved.");
	if (json?.remember !== true)
		throw new Error(
			"Zotero granted one-time access, which expires after a single write, so it was not saved. Authorize again and choose “Always Allow”.",
		);
	const value: StoredLocalKey = {
		version: 1,
		key,
		serverId: probe.serverId,
		savedAt: new Date().toISOString(),
	};
	await store().write(value);
	inject(env, value);
	return getZoteroLocalWriteStatus({ env, fetchImpl });
}

/** 忘掉 Drone 保存的 key；Zotero 自己的授权记录在 Zotero 设置 → 高级 → 清除写入授权 里清除 */
export async function clearZoteroLocalWrite({
	env = process.env,
	fetchImpl = fetch,
}: {
	env?: NodeJS.ProcessEnv;
	fetchImpl?: typeof fetch;
} = {}): Promise<ZoteroLocalWriteStatus> {
	await store().write(null);
	inject(env, null);
	return getZoteroLocalWriteStatus({ env, fetchImpl });
}
