import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export function normalizeDoi(value) {
	const doi = String(value || "")
		.trim()
		.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "")
		.toLowerCase();
	return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}
export function exactDoiItems(items, doi) {
	const wanted = normalizeDoi(doi);
	return wanted
		? items.filter((item) => normalizeDoi(item.data?.DOI || item.doi || item.DOI) === wanted)
		: [];
}
// Read-only verification. Never certifies claim support or proves a PDF was read.
export async function verifyLiteratureReceipt({
	doi,
	zotero_key,
	note_path,
	vault,
	signal,
	fetcher = fetch,
}) {
	doi = normalizeDoi(doi);
	if (!doi || !/^[A-Z0-9]{8}$/.test(zotero_key || "")) throw new Error("Valid DOI and Zotero key required");
	const receipt = {
		doi,
		zoteroKey: zotero_key,
		zotero: { status: "unavailable" },
		obsidian: { status: "unavailable" },
		scientificallyVerified: false,
	};
	const get = async (path) => {
		const response = await fetcher(`http://127.0.0.1:23119/api/users/0/${path}`, {
			signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
			redirect: "error",
		});
		if (!response.ok) throw new Error(`Zotero HTTP ${response.status}`);
		return response.json();
	};
	try {
		const item = await get(`items/${zotero_key}`);
		receipt.zotero = {
			status: exactDoiItems([item], doi).length ? "verified" : "identity-mismatch",
			title: item.data?.title,
			collections: item.data?.collections || [],
		};
		if (receipt.zotero.status === "verified") {
			try {
				const children = await get(`items/${zotero_key}/children`);
				receipt.zotero.pdfAttachmentKeys = children
					.filter((x) => x.data?.contentType === "application/pdf")
					.map((x) => x.key);
				receipt.zotero.fulltextStatus = receipt.zotero.pdfAttachmentKeys.length
					? "attachment-indexed-not-read"
					: "metadata-only";
			} catch {
				receipt.zotero.fulltextStatus = "unavailable";
			}
		}
	} catch (error) {
		receipt.zotero.error = error.name === "TimeoutError" ? "timeout" : "local-api-unavailable";
	}
	let vaultResolved = false;
	try {
		if (
			!vault ||
			!/^Library\/Papers\/.+\.md$/.test(note_path || "") ||
			note_path.split("/").includes("..") ||
			note_path.includes("\\")
		)
			throw new Error("invalid-note-path");
		const root = await realpath(vault);
		vaultResolved = true;
		const file = await realpath(resolve(root, note_path));
		const rel = relative(root, file);
		if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("outside-vault");
		if ((await stat(file)).size > 1024 * 1024) throw new Error("note-too-large");
		const text = await readFile(file, "utf8");
		const linked =
			text.includes(`zotero:${zotero_key}`) ||
			new RegExp(`zotero://select/library/items/${zotero_key}(?=[)\\s<>]|$)`).test(text) ||
			new RegExp(`^zotero_key: *["']?${zotero_key}["']? *$`, "m").test(text);
		const dois = text.match(/10\.\d{4,9}\/[^\s<>"'\])]+/gi) || [];
		receipt.obsidian = {
			status:
				linked && dois.some((x) => normalizeDoi(x.replace(/[.,;]+$/, "")) === doi)
					? "verified"
					: "identity-mismatch",
			path: note_path,
			vault: root,
			hash: createHash("sha256").update(text).digest("hex"),
		};
	} catch (error) {
		if (vaultResolved && error.code === "ENOENT") {
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
