import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
export const MAX_NOTE_BYTES = 1024 * 1024;
const OMIT = new Set([
	"node_modules",
	"dist",
	"build",
	"out",
	"coverage",
	"vendor",
	"venv",
	"__pycache__",
	"Attachments",
	"Templates",
	"_template",
]);
export function allowedSegment(name) {
	return (
		!!name &&
		!name.startsWith(".") &&
		!OMIT.has(name) &&
		!/^(?:secrets?|credentials?|id_rsa|id_ed25519)(?:[.\-_]|$)/i.test(name)
	);
}
export function validateNote(path) {
	if (
		typeof path !== "string" ||
		isAbsolute(path) ||
		path.includes("\\") ||
		!path.endsWith(".md") ||
		!path.split("/").every(allowedSegment)
	)
		throw new Error("Expected an allowed Vault-relative Markdown path");
	const reserved = ["Projects", "Library", "Wiki", "Attachments", "Templates", "Indexes", "Inbox"];
	const first = path.split("/")[0];
	if (reserved.some((name) => name.toLowerCase() === first.toLowerCase() && name !== first))
		throw new Error("Reserved Vault directories require canonical casing");
	return path;
}
export function noteScope(path) {
	return path.startsWith("Projects/") && path.split("/").length > 2 ? path.split("/")[1] : "shared";
}
export function canRead(path, project) {
	const scope = noteScope(path);
	return scope === "shared" || scope === project;
}
export function fileVersion(stat) {
	return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`;
}
export async function safeNotePath(vault, path) {
	validateNote(path);
	let full = vault;
	for (const part of path.split("/")) {
		full = join(full, part);
		if ((await lstat(full)).isSymbolicLink()) throw new Error("Knowledge reads do not follow symlinks");
	}
	const actual = await realpath(full),
		rel = relative(vault, actual);
	if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
		throw new Error("Note is outside the bound Vault");
	return actual;
}
export async function inspectNote(vault, path) {
	const full = await safeNotePath(vault, path),
		stat = await lstat(full);
	if (!stat.isFile()) throw new Error("Expected a regular note");
	return { full, stat, signature: fileVersion(stat) };
}
export async function readNoteFile(vault, path) {
	const { full } = await inspectNote(vault, path);
	const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
	try {
		const before = await handle.stat();
		if (!before.isFile() || before.size > MAX_NOTE_BYTES)
			throw new Error("Note exceeds the 1 MiB indexing limit");
		// A fixed-size buffer prevents a growing file from defeating the limit.
		const buffer = Buffer.alloc(Number(before.size) + 1);
		let offset = 0;
		while (offset < buffer.length) {
			const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
			if (!bytesRead) break;
			offset += bytesRead;
		}
		const after = await handle.stat();
		const current = await inspectNote(vault, path);
		if (
			fileVersion(before) !== fileVersion(after) ||
			fileVersion(after) !== current.signature ||
			offset !== before.size
		) {
			throw new Error("Note changed while reading; retry against its latest version");
		}
		const bytes = buffer.subarray(0, offset);
		return {
			path,
			text: bytes.toString("utf8"),
			hash: createHash("sha256").update(bytes).digest("hex"),
			signature: fileVersion(after),
			bytes: offset,
		};
	} finally {
		await handle.close();
	}
}
export function snippet(text, { startLine = 1, maxChars = 5000 } = {}) {
	const lines = text.split("\n");
	const start = Math.max(0, Math.floor(startLine) - 1),
		selected = [];
	let chars = 0;
	for (let i = start; i < lines.length; i++) {
		if (chars + lines[i].length + 1 > maxChars) {
			if (!selected.length) selected.push(lines[i].slice(0, maxChars));
			break;
		}
		selected.push(lines[i]);
		chars += lines[i].length + 1;
	}
	return {
		text: selected.join("\n"),
		startLine: start + 1,
		endLine: start + selected.length,
		totalLines: lines.length,
		truncated:
			start > 0 ||
			start + selected.length < lines.length ||
			(selected.length === 1 && selected[0].length < (lines[start]?.length || 0)),
	};
}
