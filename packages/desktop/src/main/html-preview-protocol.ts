import { randomBytes } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

/**
 * 交互式 HTML 预览协议：drone-html://<token>/<相对路径>。
 * 用户在结果查看器里显式切到「交互」后，主进程为该文件所在目录签发随机 token；
 * 协议只服务已签发目录内的文件（防穿越），响应带严格 CSP：允许内联脚本运行图表，
 * 禁止一切网络请求、表单和嵌套框架。renderer 侧再用 sandbox="allow-scripts"（无同源）隔离。
 */
export const HTML_PREVIEW_PROTOCOL = "drone-html";

export const HTML_PREVIEW_CSP = [
	"default-src 'none'",
	`script-src 'unsafe-inline' 'unsafe-eval' ${HTML_PREVIEW_PROTOCOL}: blob:`,
	`style-src 'unsafe-inline' ${HTML_PREVIEW_PROTOCOL}:`,
	`img-src data: blob: ${HTML_PREVIEW_PROTOCOL}:`,
	`font-src data: ${HTML_PREVIEW_PROTOCOL}:`,
	`media-src data: blob: ${HTML_PREVIEW_PROTOCOL}:`,
	"worker-src blob:",
	"connect-src 'none'",
	"frame-src 'none'",
	"object-src 'none'",
	"form-action 'none'",
	"base-uri 'none'",
].join("; ");

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_ROOTS = 32;

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".wasm": "application/wasm",
};

/** token → 允许读取的目录（插入顺序即新旧顺序，超过上限淘汰最旧的） */
const roots = new Map<string, string>();

/** 为一个本地 HTML 文件签发地址；同一目录复用 token */
export async function issueHtmlPreviewUrl(filePath: string): Promise<string> {
	if (!isAbsolute(filePath)) throw new Error("HTML preview needs an absolute path");
	const real = await realpath(filePath);
	if (!/\.html?$/i.test(real)) throw new Error("Only .html/.htm files can be previewed interactively");
	if (!(await stat(real)).isFile()) throw new Error("Not a file");
	const directory = dirname(real);
	let token = [...roots.entries()].find(([, root]) => root === directory)?.[0];
	if (token) roots.delete(token);
	token ??= randomBytes(16).toString("hex");
	roots.set(token, directory);
	while (roots.size > MAX_ROOTS) {
		const oldest = roots.keys().next().value;
		if (oldest === undefined) break;
		roots.delete(oldest);
	}
	return `${HTML_PREVIEW_PROTOCOL}://${token}/${encodeURIComponent(basename(real))}`;
}

/** 测试用 */
export function resetHtmlPreviewRoots(): void {
	roots.clear();
}

function denied(status: number, message: string): Response {
	return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** protocol.handle 的处理函数：只读、限定目录、带 CSP */
export async function handleHtmlPreviewRequest(request: Request): Promise<Response> {
	if (request.method !== "GET") return denied(405, "method not allowed");
	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		return denied(400, "bad url");
	}
	const root = roots.get(url.hostname);
	if (!root) return denied(404, "preview expired; reopen the file");
	let relativePath: string;
	try {
		relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
	} catch {
		return denied(400, "bad path");
	}
	const target = resolve(root, relativePath);
	const inside = (path: string) => {
		const rel = relative(root, path);
		return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) && !rel.split(sep).includes("..");
	};
	if (!inside(target)) return denied(403, "outside preview directory");
	try {
		const real = await realpath(target);
		if (!inside(real)) return denied(403, "outside preview directory");
		const info = await stat(real);
		if (!info.isFile()) return denied(404, "not found");
		if (info.size > MAX_BYTES) return denied(413, "file too large for preview");
		const body = await readFile(real);
		return new Response(body, {
			status: 200,
			headers: {
				"content-type": MIME[extname(real).toLowerCase()] ?? "application/octet-stream",
				"content-security-policy": HTML_PREVIEW_CSP,
				"x-content-type-options": "nosniff",
				"cache-control": "no-store",
				"referrer-policy": "no-referrer",
			},
		});
	} catch {
		return denied(404, "not found");
	}
}
