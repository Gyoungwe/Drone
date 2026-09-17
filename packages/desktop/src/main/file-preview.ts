import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import {
	isLocalResourceTarget,
	type ResourcePreviewResult,
	resourceFormat,
	TEXT_PREVIEW_BYTES,
} from "@drone/shared";

const IMAGE_MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
	".ico": "image/x-icon",
	".svg": "image/svg+xml",
};
const BINARY_PREVIEW_LIMIT = 16 * 1024 * 1024;
const COMPRESSED_READ_LIMIT = 2 * 1024 * 1024;
export function resolveResourcePath(target: string, cwd?: string): string {
	if (typeof target !== "string" || !isLocalResourceTarget(target))
		throw new Error("not a local file target");
	let raw = target;
	if (/^file:\/\//i.test(target)) raw = fileURLToPath(target);
	else if (!isAbsolute(target) && !/^[a-z]:[\\/]/i.test(target)) {
		try {
			raw = decodeURIComponent(target);
		} catch {
			raw = target;
		}
	}
	return isAbsolute(raw) ? resolve(raw) : resolve(cwd || process.cwd(), raw);
}
async function readPrefix(path: string, limit: number): Promise<Buffer> {
	const file = await open(path, "r");
	try {
		const buffer = Buffer.alloc(limit);
		const { bytesRead } = await file.read(buffer, 0, limit, 0);
		return buffer.subarray(0, bytesRead);
	} finally {
		await file.close();
	}
}
/** Bounded streaming decompression; never extracts to disk or scans the full compressed file. */
async function gzipPrefix(path: string, size: number): Promise<{ bytes: Buffer; truncated: boolean }> {
	return new Promise((resolveResult, reject) => {
		const input = createReadStream(path, { end: COMPRESSED_READ_LIMIT - 1, highWaterMark: 32 * 1024 });
		const unzip = createGunzip({ chunkSize: 16 * 1024 });
		const chunks: Buffer[] = [];
		let length = 0,
			settled = false;
		const finish = (error?: Error, clipped = false) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			const deliver = () => {
				if (error) reject(error);
				else
					resolveResult({
						bytes: Buffer.concat(chunks, length),
						truncated: clipped || size > COMPRESSED_READ_LIMIT,
					});
			};
			if (input.closed) deliver();
			else input.once("close", deliver);
			input.destroy();
			unzip.destroy();
		};
		const timer = setTimeout(
			() => finish(new Error("Compressed preview exceeded its time limit; use an external data viewer.")),
			3000,
		);
		input.on("error", (e) => finish(e));
		unzip.on("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "Z_BUF_ERROR" && size > COMPRESSED_READ_LIMIT) finish(undefined, true);
			else
				finish(
					new Error("Cannot decode this gzip prefix; the file may be invalid, encrypted or incomplete."),
				);
		});
		unzip.on("data", (chunk: Buffer) => {
			const take = Math.min(TEXT_PREVIEW_BYTES - length, chunk.length);
			chunks.push(chunk.subarray(0, take));
			length += take;
			if (length >= TEXT_PREVIEW_BYTES) finish(undefined, true);
		});
		unzip.on("end", () => finish());
		input.pipe(unzip);
	});
}
function decodeText(bytes: Buffer): { text: string; encoding: string } {
	if (bytes[0] === 0xff && bytes[1] === 0xfe)
		return { text: new TextDecoder("utf-16le").decode(bytes), encoding: "UTF-16LE" };
	if (bytes[0] === 0xfe && bytes[1] === 0xff)
		return { text: new TextDecoder("utf-16be").decode(bytes), encoding: "UTF-16BE" };
	return { text: new TextDecoder("utf-8").decode(bytes), encoding: "UTF-8" };
}
export async function previewLocalFile(target: string, cwd?: string): Promise<ResourcePreviewResult> {
	const path = resolveResourcePath(target, cwd),
		info = await stat(path);
	if (!info.isFile()) throw new Error("resource is not a file");
	const name = basename(path),
		ext = extname(path).toLowerCase(),
		format = resourceFormat(name),
		base = { path, name, size: info.size };
	const mimeType = IMAGE_MIME[ext] ?? (ext === ".pdf" ? "application/pdf" : "text/plain");
	if (ext === ".gz" && format.supported) {
		const decoded = await gzipPrefix(path, info.size);
		const content = decodeText(decoded.bytes);
		if (content.text.includes("\u0000"))
			return { ...base, kind: "binary", mimeType: "application/octet-stream", compression: "gzip" };
		return {
			...base,
			kind: "text",
			mimeType: "text/plain",
			...content,
			compression: "gzip",
			truncated: decoded.truncated,
		};
	}
	if (format.supported || ext === ".svg") {
		const bytes = await readPrefix(path, Math.min(TEXT_PREVIEW_BYTES, info.size)),
			decoded = decodeText(bytes);
		if (decoded.text.includes("\u0000"))
			return { ...base, kind: "binary", mimeType: "application/octet-stream" };
		return {
			...base,
			mimeType,
			kind: ext === ".svg" ? "image" : "text",
			...decoded,
			...(ext === ".svg" ? { data: bytes.toString("base64") } : {}),
			truncated: info.size > bytes.length,
		};
	}
	if (IMAGE_MIME[ext] || ext === ".pdf") {
		const kind = ext === ".pdf" ? "pdf" : "image";
		if (info.size > BINARY_PREVIEW_LIMIT) return { ...base, mimeType, kind, truncated: true };
		const bytes = await readPrefix(path, Math.min(BINARY_PREVIEW_LIMIT, info.size));
		return { ...base, mimeType, kind, data: bytes.toString("base64"), truncated: info.size > bytes.length };
	}
	return { ...base, kind: "binary", mimeType: "application/octet-stream" };
}
