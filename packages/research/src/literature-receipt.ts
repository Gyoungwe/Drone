import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface LiteratureItem {
	data?: { DOI?: unknown; title?: unknown; collections?: unknown };
	doi?: unknown;
	DOI?: unknown;
	[key: string]: unknown;
}

export interface LiteratureReceiptOptions {
	doi: unknown;
	zotero_key: unknown;
	note_path: unknown;
	vault: unknown;
	signal?: AbortSignal;
	fetcher?: (url: string, init?: RequestInit) => Promise<ReceiptResponse>;
}

interface ReceiptResponse {
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
}

export interface LiteratureReceipt {
	doi: string;
	zoteroKey: string;
	zotero: {
		status: "unavailable" | "verified" | "identity-mismatch";
		title?: unknown;
		collections?: unknown;
		pdfAttachmentKeys?: string[];
		fulltextStatus?: "attachment-indexed-not-read" | "metadata-only" | "unavailable";
		error?: string;
	};
	obsidian: {
		status: "unavailable" | "verified" | "identity-mismatch" | "missing";
		path?: string;
		vault?: string;
		hash?: string;
		error?: string;
	};
	scientificallyVerified: false;
	status?: "both-verified" | "partial";
}

export function normalizeDoi(value: unknown): string | null {
	const doi = String(value || "")
		.trim()
		.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "")
		.toLowerCase();
	return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}

export function exactDoiItems(items: readonly LiteratureItem[], doi: unknown): LiteratureItem[] {
	const wanted = normalizeDoi(doi);
	return wanted
		? items.filter((item) => normalizeDoi(item.data?.DOI || item.doi || item.DOI) === wanted)
		: [];
}

function errorName(error: unknown): string {
	return error instanceof Error ? error.name : "Error";
}

/** Read-only verification. It never certifies claim support or proves that a PDF was read. */
export async function verifyLiteratureReceipt({
	doi,
	zotero_key,
	note_path,
	vault,
	signal,
	fetcher = (url, init) => fetch(url, init),
}: LiteratureReceiptOptions): Promise<LiteratureReceipt> {
	const normalizedDoi = normalizeDoi(doi);
	const zoteroKey = String(zotero_key || "");
	if (!normalizedDoi || !/^[A-Z0-9]{8}$/.test(zoteroKey))
		throw new Error("Valid DOI and Zotero key required");
	const receipt: LiteratureReceipt = {
		doi: normalizedDoi,
		zoteroKey,
		zotero: { status: "unavailable" },
		obsidian: { status: "unavailable" },
		scientificallyVerified: false,
	};
	const get = async (path: string): Promise<unknown> => {
		const response = await fetcher(`http://127.0.0.1:23119/api/users/0/${path}`, {
			signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
			redirect: "error",
		});
		if (!response.ok) throw new Error(`Zotero HTTP ${response.status}`);
		return response.json();
	};
	try {
		const item = (await get(`items/${zoteroKey}`)) as { data?: Record<string, unknown> };
		const data = item?.data || {};
		receipt.zotero = {
			status: exactDoiItems([item], normalizedDoi).length ? "verified" : "identity-mismatch",
			title: data.title,
			collections: data.collections || [],
		};
		if (receipt.zotero.status === "verified") {
			try {
				const children = (await get(`items/${zoteroKey}/children`)) as Array<{
					data?: Record<string, unknown>;
				}>;
				receipt.zotero.pdfAttachmentKeys = children
					.filter((child) => child.data?.contentType === "application/pdf")
					.map((child) => String(child.data?.key || ""))
					.filter(Boolean);
				receipt.zotero.fulltextStatus = receipt.zotero.pdfAttachmentKeys.length
					? "attachment-indexed-not-read"
					: "metadata-only";
			} catch {
				receipt.zotero.fulltextStatus = "unavailable";
			}
		}
	} catch (error) {
		receipt.zotero.error = errorName(error) === "TimeoutError" ? "timeout" : "local-api-unavailable";
	}

	let vaultResolved = false;
	try {
		const notePath = String(note_path || "");
		if (
			!vault ||
			!/^(?:Library)\/Papers\/.+\.md$/.test(notePath) ||
			notePath.split("/").includes("..") ||
			notePath.includes("\\")
		)
			throw new Error("invalid-note-path");
		const root = await realpath(String(vault));
		vaultResolved = true;
		const file = await realpath(resolve(root, notePath));
		const rel = relative(root, file);
		if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("outside-vault");
		if ((await stat(file)).size > 1024 * 1024) throw new Error("note-too-large");
		const text = await readFile(file, "utf8");
		const linked =
			text.includes(`zotero:${zoteroKey}`) ||
			new RegExp(`zotero://select/library/items/${zoteroKey}(?=[)\\s<>]|$)`).test(text) ||
			new RegExp(`^zotero_key: *["']?${zoteroKey}["']? *$`, "m").test(text);
		const dois = text.match(/10\.\d{4,9}\/[^\s<>"'\])]+/gi) || [];
		receipt.obsidian = {
			status:
				linked && dois.some((item) => normalizeDoi(item.replace(/[.,;]+$/, "")) === normalizedDoi)
					? "verified"
					: "identity-mismatch",
			path: notePath,
			vault: root,
			hash: createHash("sha256").update(text).digest("hex"),
		};
	} catch (error) {
		if (vaultResolved && error instanceof Error && "code" in error && error.code === "ENOENT") {
			receipt.obsidian.status = "missing";
			receipt.obsidian.error = "note-missing";
		} else receipt.obsidian.error = "note-unavailable-or-invalid";
	}
	receipt.status =
		receipt.zotero.status === "verified" && receipt.obsidian.status === "verified"
			? "both-verified"
			: "partial";
	return receipt;
}
