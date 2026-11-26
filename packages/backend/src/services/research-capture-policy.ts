import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { contractContentHash, createKnowledgeSnapshot } from "@drone/shared";
import type { KnowledgeSnapshot } from "@gyoungwe/plugin-api/knowledge";

export const TEXT_EXTENSIONS = new Set([
	".txt",
	".md",
	".markdown",
	".csv",
	".tsv",
	".json",
	".yaml",
	".yml",
	".xml",
	".fa",
	".fasta",
	".fna",
	".faa",
	".ffn",
	".frn",
	".fas",
	".fastq",
	".fq",
	".bed",
	".bedgraph",
	".gff",
	".gff3",
	".gtf",
	".vcf",
	".sam",
	".aln",
	".clustal",
	".clw",
	".sto",
	".stk",
	".stockholm",
	".phy",
	".phylip",
	".afa",
	".msa",
	".mfa",
	".nwk",
	".newick",
	".tree",
	".treefile",
	".tre",
	".contree",
	".log",
]);

export function isoNow(): string {
	return new Date().toISOString();
}

export function hashBytes(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

export function formatFor(path: string): string {
	const filename = path.replaceAll("\\", "/").split("/").pop() ?? path;
	const lower = filename.toLowerCase();
	const compression = [".gz", ".bgz", ".bz2", ".xz"].find((suffix) => lower.endsWith(suffix));
	const logicalName = compression ? lower.slice(0, -compression.length) : lower;
	const ext = extname(logicalName);
	if (ext === ".pdf") return "pdf";
	if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".tif", ".tiff"].includes(ext)) return "image";
	if (TEXT_EXTENSIONS.has(ext)) return ext.slice(1) || "text";
	if (compression && ext) return ext.slice(1);
	return ext.slice(1) || (compression ? compression.slice(1) : "binary");
}

export function projectKey(
	cwd: string,
	relativePath: string,
	byteHash: string,
	scope: "project" | "workspace",
): string {
	return contractContentHash({ cwd: resolve(cwd), relativePath, byteHash, scope });
}

export function captureId(key: string): string {
	return `research-capture-${key.slice(0, 24)}`;
}

export function safeRelativePath(value: string): string {
	if (!value.trim() || isAbsolute(value)) throw new Error("Capture path must be project-relative");
	const normalized = value.replaceAll("\\", "/");
	if (normalized.split("/").some((segment) => segment === ".."))
		throw new Error("Capture path escapes project root");
	return normalized.replace(/^\.\//, "");
}

export async function resolveProjectFile(
	cwd: string,
	relativePath: string,
): Promise<{ absolute: string; root: string; relativePath: string }> {
	if (!isAbsolute(cwd)) throw new Error("Capture cwd must be absolute");
	const safePath = safeRelativePath(relativePath);
	const root = await realpath(cwd);
	const candidate = resolve(root, safePath);
	const absolute = await realpath(candidate);
	const rel = relative(root, absolute);
	if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
		throw new Error("Capture path escapes project root");
	const info = await stat(absolute);
	if (!info.isFile()) throw new Error("Only regular files can be captured");
	return { absolute, root, relativePath: rel.split(sep).join("/") };
}

export function parentRef(snapshot: KnowledgeSnapshot) {
	return {
		kind: snapshot.kind,
		id: snapshot.id,
		revision: snapshot.revision,
		contentHash: snapshot.contentHash,
	};
}

export function withApproval(
	snapshot: KnowledgeSnapshot,
	approval: "approved" | "revoked",
): KnowledgeSnapshot {
	const { schemaVersion: _schemaVersion, contentHash: _contentHash, kind: _kind, ...body } = snapshot;
	return createKnowledgeSnapshot({
		...body,
		approval,
		revision: snapshot.revision + 1,
		parentRefs: [...snapshot.parentRefs, parentRef(snapshot)],
	});
}
