/**
 * 文件类型注册表：扩展名 → mime / 是否文本 / 语言 / previewKind。
 * 主进程 file-preview 与渲染层 PreviewHost 共用这张表，新增格式只改这里。
 */
export type PreviewKind =
	| "text"
	| "code"
	| "markdown"
	| "json"
	| "table"
	| "notebook"
	| "mermaid"
	| "sequence"
	| "alignment"
	| "tree"
	| "html"
	| "svg"
	| "image"
	| "pdf"
	| "audio"
	| "video"
	| "array"
	| "mesh"
	| "typst"
	| "latex"
	| "molecule"
	| "binary";

export interface FileTypeEntry {
	ext: string;
	mime: string;
	text: boolean;
	language: string;
	previewKind: PreviewKind;
	/** 有渲染视图且能切到源码 */
	hasSource: boolean;
}

type Row = [exts: string, mime: string, kind: PreviewKind, language?: string];
const TEXT_KINDS = new Set<PreviewKind>([
	"text",
	"code",
	"markdown",
	"json",
	"table",
	"notebook",
	"mermaid",
	"sequence",
	"alignment",
	"tree",
	"html",
	"svg",
	"typst",
	"latex",
	"molecule",
]);
const ROWS: Row[] = [
	["txt log out err fai dict", "text/plain", "text"],
	["md markdown mdown rmd", "text/markdown", "markdown", "markdown"],
	["json", "application/json", "json", "json"],
	["jsonl ndjson", "application/x-ndjson", "code", "json"],
	["csv", "text/csv", "table"],
	["tsv gff gff3 gtf bed bedgraph vcf sam", "text/tab-separated-values", "table"],
	["ipynb", "application/x-ipynb+json", "notebook", "json"],
	["mmd mermaid", "text/vnd.mermaid", "mermaid", "mermaid"],
	["fa fasta fna faa ffn frn fas fq fastq", "text/x-fasta", "sequence"],
	["aln clustal clw sto stk stockholm phy phylip afa msa mfa", "text/plain", "alignment"],
	["nwk newick tree treefile tre contree", "text/x-newick", "tree"],
	["html htm", "text/html", "html", "html"],
	["svg", "image/svg+xml", "svg", "xml"],
	["typ", "text/x-typst", "typst", "typst"],
	["tex latex", "text/x-latex", "latex", "latex"],
	["pdb cif mmcif sdf mol mol2 xyz", "chemical/x-pdb", "molecule"],
	["png", "image/png", "image"],
	["jpg jpeg", "image/jpeg", "image"],
	["gif", "image/gif", "image"],
	["webp", "image/webp", "image"],
	["bmp", "image/bmp", "image"],
	["ico", "image/x-icon", "image"],
	["avif", "image/avif", "image"],
	["pdf", "application/pdf", "pdf"],
	["mp3", "audio/mpeg", "audio"],
	["wav", "audio/wav", "audio"],
	["ogg oga", "audio/ogg", "audio"],
	["flac", "audio/flac", "audio"],
	["m4a aac", "audio/mp4", "audio"],
	["mp4 m4v", "video/mp4", "video"],
	["webm", "video/webm", "video"],
	["mov", "video/quicktime", "video"],
	["npy", "application/x-npy", "array"],
	["stl", "model/stl", "mesh"],
	["obj", "model/obj", "mesh"],
	["py pyi pyw ipy smk", "text/x-python", "code", "python"],
	["r rprofile rhistory rscript", "text/x-r", "code", "r"],
	["js mjs cjs", "text/javascript", "code", "javascript"],
	["jsx", "text/javascript", "code", "jsx"],
	["ts mts cts", "text/typescript", "code", "typescript"],
	["tsx", "text/typescript", "code", "tsx"],
	["yml yaml", "text/yaml", "code", "yaml"],
	["toml", "text/toml", "code", "toml"],
	["sh bash zsh", "text/x-shellscript", "code", "bash"],
	["fish", "text/x-shellscript", "code", "fish"],
	["ps1", "text/plain", "code", "powershell"],
	["sql", "text/x-sql", "code", "sql"],
	["c h", "text/x-c", "code", "c"],
	["cpp hpp cc cxx", "text/x-c++", "code", "cpp"],
	["java", "text/x-java", "code", "java"],
	["go", "text/x-go", "code", "go"],
	["rs", "text/x-rust", "code", "rust"],
	["css", "text/css", "code", "css"],
	["scss", "text/x-scss", "code", "scss"],
	["xml", "application/xml", "code", "xml"],
	["jl", "text/x-julia", "code", "julia"],
	["nf", "text/plain", "code", "groovy"],
	["zip tar 7z rar exe dll so dylib bin", "application/octet-stream", "binary"],
];
const RENDERED_WITH_SOURCE = new Set<PreviewKind>([
	"markdown",
	"json",
	"table",
	"notebook",
	"mermaid",
	"sequence",
	"alignment",
	"tree",
	"html",
	"svg",
	"typst",
	"latex",
	"molecule",
]);

const REGISTRY = new Map<string, FileTypeEntry>();
for (const [exts, mime, previewKind, language = "text"] of ROWS)
	for (const ext of exts.split(" "))
		REGISTRY.set(ext, {
			ext,
			mime,
			text: TEXT_KINDS.has(previewKind),
			language,
			previewKind,
			hasSource: RENDERED_WITH_SOURCE.has(previewKind),
		});
const SPECIAL_LANGUAGE: Record<string, string> = {
	dockerfile: "dockerfile",
	makefile: "makefile",
	snakefile: "python",
	readme: "text",
	license: "text",
	licence: "text",
	authors: "text",
	changelog: "text",
};
function specialEntry(name: string): FileTypeEntry | undefined {
	const language = SPECIAL_LANGUAGE[name];
	if (!language) return undefined;
	return {
		ext: "",
		mime: "text/plain",
		text: true,
		language,
		previewKind: language === "text" ? "text" : "code",
		hasSource: false,
	};
}
export const UNKNOWN_FILE_TYPE: FileTypeEntry = Object.freeze({
	ext: "",
	mime: "application/octet-stream",
	text: false,
	language: "text",
	previewKind: "binary",
	hasSource: false,
});

export interface FileTypeLookup extends FileTypeEntry {
	/** 文件名带 .gz，需要先解压前缀 */
	gzip: boolean;
}

/** 按文件名查表；.gz 先剥掉再查内层扩展名，查不到返回 binary 兜底。 */
export function fileTypeOf(name: string): FileTypeLookup {
	const base = (name.toLowerCase().replaceAll("\\", "/").split("/").pop() || "").trim();
	const gzip = base.endsWith(".gz");
	const inner = gzip ? base.slice(0, -3) : base;
	const special = specialEntry(inner);
	if (special) return { ...special, gzip };
	const dot = inner.lastIndexOf(".");
	const ext = dot >= 0 ? inner.slice(dot + 1) : "";
	const hit = ext ? REGISTRY.get(ext) : undefined;
	return hit ? { ...hit, gzip } : { ...UNKNOWN_FILE_TYPE, ext, gzip };
}

/** 注册表全部扩展名（调试 / 样张页用）。 */
export function registeredExtensions(): string[] {
	return [...REGISTRY.keys()].sort();
}
