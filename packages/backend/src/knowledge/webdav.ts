import { createHash } from "node:crypto";
import { MAX_NOTE_BYTES } from "@drone/knowledge/files";
import type { KnowledgeCloudNote, KnowledgeCloudStatus, KnowledgeCloudWriteResult } from "@drone/shared";
import { syncCloudNotes } from "./webdav-sync";
import {
	cloudError,
	cloudNotePath,
	httpError,
	KnowledgeWebDavError,
	strongEtag,
	WebDavTransport,
} from "./webdav-transport";

export { KnowledgeWebDavError } from "./webdav-transport";
export const DEFAULT_WEBDAV_ENDPOINT = "http://10.126.126.1:8080";
export const DEFAULT_WEBDAV_USERNAME = "gaoyangwei";
export const DEFAULT_WEBDAV_FOLDER = "Drone-Knowledge";

export interface KnowledgeWebDavOptions {
	endpoint?: string;
	username?: string;
	folder?: string;
	password?: () => string | undefined;
	fetch?: typeof fetch;
	now?: () => Date;
	timeoutMs?: number;
}

/** 显式单次云端操作；本地 Vault、索引和知识回执继续保留原有语义。 */
export class KnowledgeWebDavService {
	private readonly transport: WebDavTransport;
	private readonly folder: string;
	private readonly password: () => string | undefined;
	private readonly now: () => Date;
	private lastStatus: KnowledgeCloudStatus;

	constructor(options: KnowledgeWebDavOptions = {}) {
		this.password = options.password ?? (() => process.env.DRONE_WEBDAV_PASSWORD);
		this.folder = options.folder ?? DEFAULT_WEBDAV_FOLDER;
		if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(this.folder))
			throw new KnowledgeWebDavError("protocol", "WebDAV 知识库目录名无效");
		this.transport = new WebDavTransport({
			endpoint: options.endpoint ?? process.env.DRONE_WEBDAV_ENDPOINT ?? DEFAULT_WEBDAV_ENDPOINT,
			username: options.username ?? DEFAULT_WEBDAV_USERNAME,
			password: this.password,
			fetch: options.fetch,
			timeoutMs: options.timeoutMs,
		});
		this.now = options.now ?? (() => new Date());
		this.lastStatus = this.makeStatus("unchecked", null);
	}

	private makeStatus(mode: KnowledgeCloudStatus["mode"], message: string | null): KnowledgeCloudStatus {
		return {
			configured: Boolean(this.password()),
			endpoint: this.transport.endpoint,
			folder: this.folder,
			mode,
			reachable: false,
			authenticated: false,
			initialized: false,
			writable: null,
			lastCheckedAt: null,
			message,
			warnings: [
				"显式传输所选笔记；不自动同步、不覆盖已有不同内容。权限由 WebDAV 账号决定，不提供项目级访问控制。",
				...(this.transport.endpoint.startsWith("http:")
					? ["当前使用 HTTP，凭据和笔记未经过 TLS 加密；仅在可信网络使用"]
					: []),
			],
		};
	}

	/** 获取最近观测，不在打开设置或启动时访问网络。 */
	async getStatus(): Promise<KnowledgeCloudStatus> {
		if (!this.password()) return this.makeStatus("disabled", "未配置 WebDAV 密码（DRONE_WEBDAV_PASSWORD）");
		return structuredClone(this.lastStatus);
	}

	private async check(initialize: boolean): Promise<KnowledgeCloudStatus> {
		const status = this.makeStatus("unchecked", null);
		status.lastCheckedAt = this.now().toISOString();
		try {
			if (!this.password())
				throw new KnowledgeWebDavError("not_configured", "未配置 WebDAV 密码（DRONE_WEBDAV_PASSWORD）");
			let exists = await this.transport.collection(`${this.folder}/`);
			if (!exists) {
				if (!(await this.transport.collection("")))
					throw new KnowledgeWebDavError("protocol", "WebDAV 根目录不存在");
				if (initialize) {
					await this.transport.ensureCollection(`${this.folder}/`);
					exists = true;
				}
			}
			status.mode = "ready";
			status.reachable = true;
			status.authenticated = true;
			status.initialized = exists;
			status.message = exists ? "目录可读；笔记写权限将在实际写入时检查" : "连接成功；请初始化专用目录";
		} catch (error) {
			const code = error instanceof KnowledgeWebDavError ? error.code : "protocol";
			status.mode =
				code === "not_configured"
					? "disabled"
					: code === "offline"
						? "offline"
						: code === "unauthorized"
							? "unauthorized"
							: "error";
			status.reachable = error instanceof KnowledgeWebDavError && error.status !== null;
			status.writable = code === "forbidden" || code === "unauthorized" ? false : null;
			status.message = cloudError(error);
		}
		this.lastStatus = status;
		return structuredClone(status);
	}

	probe(): Promise<KnowledgeCloudStatus> {
		return this.check(false);
	}
	initialize(): Promise<KnowledgeCloudStatus> {
		return this.check(true);
	}

	private notePath(path: string): string {
		return `${this.folder}/${cloudNotePath(path).split("/").map(encodeURIComponent).join("/")}`;
	}

	async read(path: string): Promise<KnowledgeCloudNote> {
		const response = await this.transport.request("GET", this.notePath(path), {
			Accept: "text/markdown, text/plain",
		});
		if (response.status !== 200) throw httpError(response.status);
		let text: string;
		try {
			text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(response.body);
		} catch {
			throw new KnowledgeWebDavError("protocol", "云端笔记不是有效 UTF-8 文本");
		}
		return {
			path,
			text,
			hash: createHash("sha256").update(response.body).digest("hex"),
			version: strongEtag(response.headers.get("etag")),
			bytes: response.body.length,
			lastModified: response.headers.get("last-modified"),
		};
	}

	async write(input: {
		path: string;
		text: string;
		expectedVersion?: string;
	}): Promise<KnowledgeCloudWriteResult> {
		const path = this.notePath(input.path);
		if (Buffer.byteLength(input.text, "utf8") > MAX_NOTE_BYTES)
			throw new KnowledgeWebDavError("protocol", "云端笔记超过 1 MiB 限制");
		if (input.expectedVersion !== undefined && !strongEtag(input.expectedVersion))
			throw new KnowledgeWebDavError("protocol", "更新笔记需要读取时获得的强 ETag；不支持通配符或修改时间");
		const result: KnowledgeCloudWriteResult = {
			path: input.path,
			status: "unknown",
			version: null,
			hash: createHash("sha256").update(input.text).digest("hex"),
			message: null,
		};
		let putStarted = false;
		try {
			if (!(await this.transport.collection(`${this.folder}/`)))
				throw new KnowledgeWebDavError("not_found", "请先初始化 WebDAV 知识库目录");
			const parents = path.split("/").slice(0, -1);
			for (let i = 2; i <= parents.length; i++)
				await this.transport.ensureCollection(`${parents.slice(0, i).join("/")}/`);
			putStarted = true;
			const response = await this.transport.request(
				"PUT",
				path,
				{
					"Content-Type": "text/markdown; charset=utf-8",
					...(input.expectedVersion ? { "If-Match": input.expectedVersion } : { "If-None-Match": "*" }),
				},
				input.text,
			);
			if (![200, 201, 204].includes(response.status)) throw httpError(response.status);
			result.status = input.expectedVersion ? "updated" : "created";
			result.version = strongEtag(response.headers.get("etag"));
			result.message = result.version ? null : "云端已确认写入；未返回强 ETag，更新前需重新读取";
		} catch (error) {
			if (!(error instanceof KnowledgeWebDavError))
				throw new KnowledgeWebDavError("protocol", cloudError(error));
			if (error.code === "conflict") result.status = "conflict";
			else if (["forbidden", "unauthorized"].includes(error.code)) result.status = "forbidden";
			else if (error.code === "not_configured") result.status = "offline";
			else if (error.code === "offline") result.status = putStarted ? "unknown" : "offline";
			else if (putStarted) result.status = "unknown";
			else throw error;
			result.message =
				result.status === "unknown" ? "云端未确认写入结果；请重新读取核对，切勿盲目重试" : error.message;
		}
		return result;
	}

	sync(input: Parameters<typeof syncCloudNotes>[1]): ReturnType<typeof syncCloudNotes> {
		return syncCloudNotes(this, input);
	}
}
