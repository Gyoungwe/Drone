import { join } from "node:path";
import { JsonStore } from "../json-store";
import { getAgentDir } from "../session-engine/sdk";

/**
 * WebDAV 知识库密码：用户在设置页手动输入后保存在 agentDir/knowledge-webdav.json（0600，与 zotero-web.json 同类 secret 文件）。
 * 环境变量 DRONE_WEBDAV_PASSWORD 优先，界面保存的值不会覆盖它。密码不会出现在状态、日志或 IPC 返回值中。
 */
interface StoredWebDavCredentials {
	version: 1;
	password: string;
	savedAt: string;
}

export const MAX_WEBDAV_PASSWORD_LENGTH = 256;

export interface WebDavCredentialStore {
	load(): Promise<string | null>;
	save(password: string): Promise<void>;
	clear(): Promise<void>;
}

export function validateWebDavPassword(password: string): string {
	if (
		!password ||
		password.length > MAX_WEBDAV_PASSWORD_LENGTH ||
		Array.from(password).some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)
	)
		throw new Error(`WebDAV 密码无效：需为 1–${MAX_WEBDAV_PASSWORD_LENGTH} 个字符，且不含控制字符`);
	return password;
}

export function createWebDavCredentialStore(): WebDavCredentialStore {
	const store = () =>
		new JsonStore<StoredWebDavCredentials | null>({
			path: join(getAgentDir(), "knowledge-webdav.json"),
			storageId: "agent-knowledge-webdav",
			defaultValue: () => null,
			mode: 0o600,
		});
	return {
		async load() {
			try {
				const value = await store().read();
				return value && typeof value.password === "string" && value.password ? value.password : null;
			} catch {
				// 文件损坏时视为未配置；重新保存即可覆盖
				return null;
			}
		},
		async save(password) {
			await store().write({
				version: 1,
				password: validateWebDavPassword(password),
				savedAt: new Date().toISOString(),
			});
		},
		async clear() {
			await store().write(null);
		},
	};
}
