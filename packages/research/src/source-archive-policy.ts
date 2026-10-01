import { basename, isAbsolute, relative, resolve, sep } from "node:path";

export const SOURCE_CATEGORIES = ["papers", "supplementary", "software", "manuals"] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface ContentValidation {
	ok: boolean;
	mime?: string;
	reason?: string;
}

export interface SourceMetadata {
	doi?: unknown;
	pmid?: unknown;
	pmcid?: unknown;
	commit?: unknown;
	version?: unknown;
	license?: unknown;
	title?: unknown;
	authors?: unknown;
	repository?: unknown;
	open_access?: unknown;
	[key: string]: unknown;
}

export function isWithin(root: string, child: string): boolean {
	const rel = relative(resolve(root), resolve(child));
	return (
		rel === "" ||
		(!isAbsolute(rel) && !rel.startsWith(`..${sep}`) && rel !== ".." && !rel.includes(`..${sep}`))
	);
}

export function validateRunDir(resultsRoot: string, candidate: string): string {
	const runDir = resolve(candidate);
	const rel = relative(resolve(resultsRoot), runDir);
	const parts = rel.split(sep);
	if (!rel || !isWithin(resultsRoot, runDir) || parts.length !== 2 || !parts[1]?.startsWith("run-"))
		throw new Error("run_dir must point to a run directory directly inside the configured results root");
	return runDir;
}

export function safeFilename(input: unknown, fallback: string): string {
	const value = String(input || "").trim();
	const candidate = [...basename(value)]
		.map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? "-" : char))
		.join("")
		.replace(/\s+/g, " ")
		.trim();
	if (!candidate || candidate === "." || candidate === "..") return fallback;
	return candidate.slice(0, 180);
}

export function looksLikeChallenge(status: number, contentType: string, sample: string): boolean {
	if ([401, 403, 407, 429].includes(status)) return true;
	if (!contentType.toLowerCase().includes("text/html")) return false;
	return /cf-chl|cloudflare|captcha|verify you are human|access denied|sign in|log in|login required/i.test(
		sample,
	);
}

export function hasMagic(bytes: Uint8Array): boolean {
	if (bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-") return true;
	if (
		bytes.length >= 4 &&
		bytes[0] === 0x50 &&
		bytes[1] === 0x4b &&
		(bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
	)
		return true;
	return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export function validateContent(
	category: SourceCategory,
	contentType: string,
	filename: string,
	bytes: Uint8Array,
): ContentValidation {
	const mime = contentType.toLowerCase().split(";", 1)[0]?.trim() ?? "";
	const head = new TextDecoder().decode(bytes.subarray(0, 16));
	const executable =
		/\.(?:exe|dll|msi|com|bat|cmd|ps1|sh)$/i.test(filename) ||
		/application\/(?:x-msdownload|x-dosexec)/.test(mime);
	if (executable) return { ok: false, reason: "executable content is not archived" };
	if (category === "papers" && !head.startsWith("%PDF-"))
		return { ok: false, reason: "papers must be PDF content" };
	if (
		category === "supplementary" &&
		!(mime.includes("pdf") || mime.includes("zip") || mime.includes("gzip") || hasMagic(bytes))
	)
		return { ok: false, reason: "unsupported supplementary MIME or file signature" };
	if (category === "software" && mime === "text/html")
		return { ok: false, reason: "HTML is not a software archive" };
	if (category === "manuals" && !mime && !bytes.length) return { ok: false, reason: "empty manual content" };
	return { ok: true, mime };
}

export function normalizeMetadata(metadata: SourceMetadata = {}): Record<string, unknown> {
	const allowed = [
		"doi",
		"pmid",
		"pmcid",
		"commit",
		"version",
		"license",
		"title",
		"authors",
		"repository",
		"open_access",
	] as const;
	return Object.fromEntries(
		allowed
			.filter((key) => metadata[key] != null && String(metadata[key]).trim() !== "")
			.map((key) => [key, metadata[key]]),
	);
}
