import { createHash, randomBytes } from "node:crypto";
import { MAX_NOTE_BYTES, validateNote } from "@drone/knowledge/files";
import { DOMParser } from "@xmldom/xmldom";

export class KnowledgeWebDavError extends Error {
	constructor(
		readonly code:
			| "not_configured"
			| "offline"
			| "unauthorized"
			| "forbidden"
			| "not_found"
			| "conflict"
			| "protocol",
		message: string,
		readonly status: number | null = null,
	) {
		super(message);
		this.name = "KnowledgeWebDavError";
	}
}

export function cloudError(error: unknown): string {
	return error instanceof KnowledgeWebDavError
		? error.message
		: "知识库操作失败；本地文件或绑定可能已变化，请刷新后重试";
}

export function httpError(status: number): KnowledgeWebDavError {
	if (status === 401)
		return new KnowledgeWebDavError("unauthorized", "WebDAV 认证失败，请检查团队密钥", status);
	if (status === 403) return new KnowledgeWebDavError("forbidden", "WebDAV 拒绝访问，请检查目录权限", status);
	if (status === 404) return new KnowledgeWebDavError("not_found", "WebDAV 目录或笔记不存在", status);
	if ([409, 412, 423, 428].includes(status))
		return new KnowledgeWebDavError(
			"conflict",
			"云端版本已变化、父目录缺失或资源被锁定，请重新读取后处理",
			status,
		);
	return new KnowledgeWebDavError("protocol", `WebDAV 返回无法处理的响应（HTTP ${status}）`, status);
}

export function strongEtag(value: string | null | undefined): string | null {
	return value && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value) && value.length <= 1024 ? value : null;
}

export function cloudNotePath(path: string): string {
	validateNote(path);
	// 不同步任意工作区产物；URL 解码链与 Windows 特殊文件名均拒绝。
	if (
		path.length > 1024 ||
		/[%:#?]/.test(path) ||
		Array.from(path).some(
			(character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f,
		) ||
		path.split("/").some((part) => /[. ]$/.test(part)) ||
		!/^(?:Home\.md|(?:Wiki|Library|Projects|Inbox)\/.+\.md)$/.test(path) ||
		path.split("/").some((part) => /^(?:results|sessions|credentials?|secrets?|auth)(?:\.|$)/i.test(part))
	)
		throw new KnowledgeWebDavError(
			"protocol",
			"请选择 Home.md 或 Wiki、Library、Projects、Inbox 内的知识笔记",
		);
	return path;
}

export interface WebDavTransportOptions {
	endpoint: string;
	username: string;
	password: () => string | undefined;
	fetch?: typeof fetch;
	timeoutMs?: number;
}

export interface DavResponse {
	status: number;
	headers: Headers;
	body: Buffer;
}

interface DigestChallenge {
	realm: string;
	nonce: string;
	algorithm: "MD5" | "MD5-SESS";
	qop: "auth" | null;
	opaque: string | null;
}

function digestHash(value: string): string {
	return createHash("md5").update(value, "utf8").digest("hex");
}

function parseDigestChallenge(value: string | null): DigestChallenge | null {
	const match = value?.match(/(?:^|[\s,])Digest\s+(.+)$/i);
	if (!match) return null;
	const challengeText = match[1];
	if (!challengeText) return null;
	const attributes: Record<string, string> = {};
	let part = "";
	let quoted = false;
	let escaped = false;
	const parts: string[] = [];
	for (const character of challengeText) {
		if (escaped) {
			part += character;
			escaped = false;
		} else if (character === "\\" && quoted) {
			escaped = true;
		} else if (character === '"') {
			quoted = !quoted;
			part += character;
		} else if (character === "," && !quoted) {
			parts.push(part);
			part = "";
		} else {
			part += character;
		}
	}
	parts.push(part);
	for (const item of parts) {
		const separator = item.indexOf("=");
		if (separator < 1) continue;
		const key = item.slice(0, separator).trim().toLowerCase();
		let itemValue = item.slice(separator + 1).trim();
		if (itemValue.startsWith('"') && itemValue.endsWith('"')) itemValue = itemValue.slice(1, -1);
		if (key) attributes[key] = itemValue;
	}
	const algorithm = (attributes.algorithm ?? "MD5").toUpperCase();
	const qops = (attributes.qop ?? "")
		.split(",")
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);
	if (!attributes.realm || !attributes.nonce || !["MD5", "MD5-SESS"].includes(algorithm)) return null;
	if (attributes.qop && !qops.includes("auth")) return null;
	return {
		realm: attributes.realm,
		nonce: attributes.nonce,
		algorithm: algorithm as DigestChallenge["algorithm"],
		qop: attributes.qop ? "auth" : null,
		opaque: attributes.opaque ?? null,
	};
}

function quoteDigest(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** 不跟随重定向，不返回原始异常或错误响应正文；超时覆盖 headers 和 body。 */
export class WebDavTransport {
	readonly endpoint: string;
	private digestChallenge: DigestChallenge | null = null;
	/** 服务端明确要求 Basic 后才为 true；首次请求不带任何凭据，避免向只支持 Digest 的服务端泄露可还原的密码。 */
	private basicRequested = false;
	private readonly digestNonceCounts = new Map<string, number>();
	constructor(private readonly options: WebDavTransportOptions) {
		let url: URL;
		try {
			url = new URL(options.endpoint);
		} catch {
			throw new KnowledgeWebDavError("protocol", "WebDAV 地址无效");
		}
		if (
			!["http:", "https:"].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			url.pathname !== "/"
		)
			throw new KnowledgeWebDavError("protocol", "WebDAV 地址必须是无凭据、无路径参数的 http(s) 根地址");
		if (!options.username || /[:\r\n]/.test(options.username))
			throw new KnowledgeWebDavError("protocol", "WebDAV 用户名无效");
		this.endpoint = url.origin;
	}

	async request(
		method: string,
		path: string,
		headers: Record<string, string> = {},
		body?: string,
	): Promise<DavResponse> {
		const password = this.options.password();
		if (!password)
			throw new KnowledgeWebDavError(
				"not_configured",
				"请在设置中输入 WebDAV 密码（或设置环境变量 DRONE_WEBDAV_PASSWORD）",
			);
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
		try {
			const url = `${this.endpoint}/${path}`;
			const send = (authorization: string | null) =>
				(this.options.fetch ?? fetch)(url, {
					method,
					redirect: "manual",
					signal: controller.signal,
					body,
					headers: authorization ? { ...headers, Authorization: authorization } : headers,
				});
			const basic = () => `Basic ${Buffer.from(`${this.options.username}:${password}`).toString("base64")}`;
			// 只使用服务端已协商过的方案；尚未协商时先不带凭据，由 401 挑战决定。
			let response = await send(
				this.digestChallenge
					? this.digestAuthorization(this.digestChallenge, method, url, password)
					: this.basicRequested
						? basic()
						: null,
			);
			if (response.status === 401) {
				const header = response.headers.get("www-authenticate");
				const challenge = parseDigestChallenge(header);
				await response.body?.cancel();
				if (challenge) {
					this.digestChallenge = challenge;
					this.basicRequested = false;
					response = await send(this.digestAuthorization(challenge, method, url, password));
				} else if (header && /(?:^|[\s,])Basic\b/i.test(header) && !this.basicRequested) {
					this.basicRequested = true;
					this.digestChallenge = null;
					response = await send(basic());
				}
			}
			// 错误正文可能包含凭据或私有内容，直接丢弃。
			if (!response.ok) {
				await response.body?.cancel();
				return { status: response.status, headers: response.headers, body: Buffer.alloc(0) };
			}
			const limit = method === "PROPFIND" ? 64 * 1024 : MAX_NOTE_BYTES;
			if (Number(response.headers.get("content-length")) > limit) {
				await response.body?.cancel();
				throw new KnowledgeWebDavError("protocol", "WebDAV 响应超过大小限制");
			}
			const reader = response.body?.getReader();
			const chunks: Uint8Array[] = [];
			let bytes = 0;
			if (reader) {
				try {
					while (true) {
						const next = await reader.read();
						if (next.done) break;
						bytes += next.value.byteLength;
						if (bytes > limit) throw new KnowledgeWebDavError("protocol", "WebDAV 响应超过大小限制");
						chunks.push(next.value);
					}
				} finally {
					await reader.cancel().catch(() => {});
				}
			}
			return { status: response.status, headers: response.headers, body: Buffer.concat(chunks) };
		} catch (error) {
			if (error instanceof KnowledgeWebDavError) throw error;
			throw new KnowledgeWebDavError(
				"offline",
				controller.signal.aborted
					? "WebDAV 请求超时；写入结果可能尚未确认"
					: "WebDAV 暂时不可达，请检查网络或服务地址",
			);
		} finally {
			clearTimeout(timer);
		}
	}

	private digestAuthorization(
		challenge: DigestChallenge,
		method: string,
		url: string,
		password: string,
	): string {
		const target = new URL(url);
		const uri = `${target.pathname}${target.search}`;
		const count = (this.digestNonceCounts.get(challenge.nonce) ?? 0) + 1;
		this.digestNonceCounts.set(challenge.nonce, count);
		const nonceCount = count.toString(16).padStart(8, "0");
		const cnonce = randomBytes(16).toString("hex");
		let ha1 = digestHash(`${this.options.username}:${challenge.realm}:${password}`);
		if (challenge.algorithm === "MD5-SESS") ha1 = digestHash(`${ha1}:${challenge.nonce}:${cnonce}`);
		const ha2 = digestHash(`${method}:${uri}`);
		const response = challenge.qop
			? digestHash(`${ha1}:${challenge.nonce}:${nonceCount}:${cnonce}:${challenge.qop}:${ha2}`)
			: digestHash(`${ha1}:${challenge.nonce}:${ha2}`);
		const parts = [
			`username=${quoteDigest(this.options.username)}`,
			`realm=${quoteDigest(challenge.realm)}`,
			`nonce=${quoteDigest(challenge.nonce)}`,
			`uri=${quoteDigest(uri)}`,
			`response=${quoteDigest(response)}`,
			`algorithm=${challenge.algorithm}`,
		];
		if (challenge.qop)
			parts.push(`qop=${challenge.qop}`, `nc=${nonceCount}`, `cnonce=${quoteDigest(cnonce)}`);
		if (challenge.opaque) parts.push(`opaque=${quoteDigest(challenge.opaque)}`);
		return `Digest ${parts.join(", ")}`;
	}

	async collection(path: string): Promise<boolean> {
		const result = await this.request(
			"PROPFIND",
			path,
			{ Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
			'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
		);
		if (result.status === 404) return false;
		if (result.status !== 200 && result.status !== 207) throw httpError(result.status);
		const invalid = () => {
			throw new KnowledgeWebDavError("protocol", "WebDAV 未返回有效目录；请检查服务和同名文件");
		};
		const xml = result.body.toString("utf8");
		if (/<!DOCTYPE|<!ENTITY/i.test(xml)) invalid();
		let doc: Document;
		try {
			doc = new DOMParser({
				errorHandler: { warning: invalid, error: invalid, fatalError: invalid },
			}).parseFromString(xml, "application/xml");
		} catch {
			return invalid();
		}
		if (doc.documentElement.namespaceURI !== "DAV:" || doc.documentElement.localName !== "multistatus")
			invalid();
		const responses = doc.getElementsByTagNameNS("DAV:", "response");
		for (let i = 0; i < responses.length; i++) {
			const item = responses.item(i);
			if (!item) continue;
			const href = item.getElementsByTagNameNS("DAV:", "href").item(0)?.textContent;
			if (!href) continue;
			let target: URL;
			try {
				target = new URL(href, `${this.endpoint}/${path}`);
			} catch {
				return invalid();
			}
			const expected = new URL(`${this.endpoint}/${path}`);
			if (
				target.origin !== expected.origin ||
				target.pathname.replace(/\/$/, "") !== expected.pathname.replace(/\/$/, "")
			)
				continue;
			const statuses = item.getElementsByTagNameNS("DAV:", "status");
			const directStatus = Array.from({ length: statuses.length }, (_, j) => statuses.item(j)).find(
				(el) => !!el && el.parentNode === item,
			);
			if (directStatus) throw httpError(Number(directStatus.textContent?.split(" ")[1]));
			const props = item.getElementsByTagNameNS("DAV:", "propstat");
			for (let j = 0; j < props.length; j++) {
				const prop = props.item(j);
				if (!prop) continue;
				const status = prop.getElementsByTagNameNS("DAV:", "status").item(0)?.textContent ?? "";
				if (!/^HTTP\/\S+ 200(?: |$)/.test(status)) continue;
				if (
					prop.getElementsByTagNameNS("DAV:", "resourcetype").length &&
					prop.getElementsByTagNameNS("DAV:", "collection").length
				)
					return true;
			}
			invalid();
		}
		return invalid();
	}

	async ensureCollection(path: string): Promise<void> {
		if (await this.collection(path)) return;
		const result = await this.request("MKCOL", path);
		if (result.status !== 201 && result.status !== 405) throw httpError(result.status);
		// 405 可能是另一个客户端刚创建，也可能是同名文件：必须验证。
		if (!(await this.collection(path)))
			throw new KnowledgeWebDavError("protocol", "WebDAV 目录创建后无法读取");
	}
}
