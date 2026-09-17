export type TextPreviewKind = "markdown" | "table" | "fasta" | "fastq" | "html" | "json" | "code" | "text";
export const TEXT_PREVIEW_BYTES = 128 * 1024;
export const PREVIEW_ROWS = 200;
export const PREVIEW_COLUMNS = 60;
const languages: Record<string, string> = {
	py: "python",
 pyi:"python", pyw:"python", ipy:"python",
	r: "r",
 rprofile:"r", rhistory:"r", rscript:"r",
	rmd: "markdown",
	js: "javascript",
	jsx: "jsx",
	ts: "typescript",
	tsx: "tsx",
	jsonl: "json",
	ndjson: "json",
	yml: "yaml",
	yaml: "yaml",
	toml: "toml",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	fish: "fish",
	ps1: "powershell",
	sql: "sql",
	c: "c",
	h: "c",
	cpp: "cpp",
	hpp: "cpp",
	java: "java",
	go: "go",
	rs: "rust",
	css: "css",
	scss: "scss",
	xml: "xml",
	tex: "latex",
	jl: "julia",
	nf: "groovy",
	smk: "python",
	ipynb: "json",
};
export function resourceFormat(name: string): {
	kind: TextPreviewKind;
	label: string;
	language: string;
	ext: string;
	supported: boolean;
} {
	const base = name.toLowerCase().replaceAll("\\", "/").split("/").pop()?.replace(/\.gz$/, "") || "",
		ext = base.split(".").pop() || "";
	const make = (kind: TextPreviewKind, label: string, language = "text", supported = true) => ({
		kind,
		label,
		language,
		ext,
		supported,
	});
	if (["readme", "license", "licence", "authors", "changelog"].includes(base)) return make("text", "文本");
	if (["dockerfile", "makefile", "snakefile"].includes(base))
		return make("code", base, base === "snakefile" ? "python" : base);
	if (["md", "markdown", "mdown", "rmd"].includes(ext)) return make("markdown", "Markdown", "markdown");
	if (["csv", "tsv", "gff", "gff3", "gtf", "bed", "bedgraph", "vcf", "sam"].includes(ext))
		return make("table", ext.toUpperCase());
	if (["fa", "fasta", "fna", "faa", "ffn", "frn", "fas"].includes(ext)) return make("fasta", "FASTA");
	if (["fq", "fastq"].includes(ext)) return make("fastq", "FASTQ");
	if (["html", "htm"].includes(ext)) return make("html", "HTML", "html");
	if (ext === "json") return make("json", "JSON", "json");
	if (languages[ext]) return make("code", ext.toUpperCase(), languages[ext]);
	return make(
		"text",
		ext.toUpperCase() || "文本",
		"text",
		["txt", "log", "out", "err", "fai", "dict", "aln", "phy", "nwk", "newick", "pdb", "cif", "sdf"].includes(
			ext,
		),
	);
}
export function filePreviewDirectory(path: string): string {
	const normalized = path.replaceAll("\\", "/"),
		index = normalized.lastIndexOf("/");
	return index === 0
		? "/"
		: index === 2 && /^[a-z]:/i.test(normalized)
			? normalized.slice(0, 3)
			: index >= 0
				? normalized.slice(0, index)
				: ".";
}
export interface PreviewTable {
	headers: string[];
	rows: string[][];
	clipped: boolean;
	warnings: string[];
	metadata: string[];
}
export function parseDelimited(
	text: string,
	delimiter: string,
	maxRows = PREVIEW_ROWS + 1,
	quotes = true,
): { rows: string[][]; clipped: boolean; incomplete: boolean } {
	const rows: string[][] = [];
	let row: string[] = [],
		field = "",
		quoted = false,
		column = 0,
		clipped = false,
		i = 0;
	const pushField = () => {
		if (column < PREVIEW_COLUMNS) row.push(field);
		else clipped = true;
		column++;
		field = "";
	};
	const pushRow = () => {
		pushField();
		if (row.some((s) => s.length)) rows.push(row);
		row = [];
		column = 0;
	};
	for (; i < text.length; i++) {
		const c = text[i];
		if (quotes && c === '"' && (quoted || field.length === 0)) {
			if (quoted && text[i + 1] === '"') {
				if (field.length < 2000) field += '"';
				i++;
			} else quoted = !quoted;
		} else if (!quoted && c === delimiter) pushField();
		else if (!quoted && (c === "\n" || c === "\r")) {
			if (c === "\r" && text[i + 1] === "\n") i++;
			pushRow();
			if (rows.length >= maxRows) {
				i++;
				break;
			}
		} else if (field.length < 2000) field += c;
		else clipped = true;
	}
	if ((field.length || row.length) && rows.length < maxRows) pushRow();
	return { rows, clipped: clipped || i < text.length, incomplete: quoted };
}
export function tablePreview(text: string, ext: string, firstRowHeader = true): PreviewTable {
	const metadata: string[] = [];
	const warnings: string[] = [];
	let source = text;
	const scientific = ["gff", "gff3", "gtf", "bed", "bedgraph", "vcf", "sam"].includes(ext);
	let headers: string[] = [];
	if (scientific) {
		const lines: string[] = [];
		for (const line of text.split(/\r?\n/)) {
			if (line === "##FASTA") {
				warnings.push("GFF 内嵌 FASTA 区段未作为注释记录读取；可切换源码查看。");
				break;
			}
			if (ext === "vcf" && line.startsWith("#CHROM")) headers = line.slice(1).split("\t");
			else if (
				line.startsWith("#") ||
				(ext === "sam" && /^@(HD|SQ|RG|PG|CO)\t/.test(line)) ||
				(/^(track|browser)\s/.test(line) && ["bed", "bedgraph"].includes(ext))
			) {
				if (metadata.length < 30) metadata.push(line.slice(0, 2000));
			} else lines.push(line);
		}
		source = lines.join("\n");
		if (["gff", "gff3", "gtf"].includes(ext))
			headers = [
				"seqid",
				"source",
				"type",
				"start (1-based)",
				"end (inclusive)",
				"score",
				"strand",
				"phase",
				"attributes",
			];
		if (ext === "bed")
			headers = [
				"chrom",
				"start (0-based)",
				"end (exclusive)",
				"name",
				"score",
				"strand",
				"thickStart",
				"thickEnd",
				"itemRgb",
				"blockCount",
				"blockSizes",
				"blockStarts",
			];
		if (ext === "bedgraph") headers = ["chrom", "start (0-based)", "end (exclusive)", "value"];
		if (ext === "sam")
			headers = ["QNAME", "FLAG", "RNAME", "POS", "MAPQ", "CIGAR", "RNEXT", "PNEXT", "TLEN", "SEQ", "QUAL"];
		if (ext === "vcf" && !headers.length)
			warnings.push("片段中未找到 #CHROM 表头，使用列序号，不推断样本信息。");
	}
	const parsed = parseDelimited(
		source.replace(/^\uFEFF/, ""),
		ext === "csv" ? "," : "\t",
		PREVIEW_ROWS + 1,
		!scientific,
	);
	let rows = parsed.rows;
	if (!scientific && firstRowHeader) headers = rows.shift() || [];
	if (["bed", "sam"].includes(ext)) headers = headers.slice(0, Math.max(...rows.map((r) => r.length), 0));
	const columns = Math.min(PREVIEW_COLUMNS, Math.max(headers.length, ...rows.map((r) => r.length), 0));
	while (headers.length < columns) headers.push(`列 ${headers.length + 1}`);
	if (headers.length > PREVIEW_COLUMNS) headers = headers.slice(0, PREVIEW_COLUMNS);
	if (parsed.incomplete) warnings.push("片段末尾存在未闭合引号，请查看源码或完整文件。");
	if (rows.some((r) => r.length !== headers.length))
		warnings.push("部分行的字段数与表头不同；保留原始字段，不自动修正。");
	const clipped =
		parsed.clipped ||
		rows.length > PREVIEW_ROWS ||
		(ext === "vcf" &&
			text
				.split(/\r?\n/)
				.some((line) => line.startsWith("#CHROM") && line.split("\t").length > PREVIEW_COLUMNS));
	rows = rows.slice(0, PREVIEW_ROWS);
	return { headers, rows, clipped, warnings, metadata };
}
export interface SequenceRecord {
	name: string;
	sequence: string;
	quality?: string;
	length: number;
	warning?: string;
}
export function sequencePreview(
	text: string,
	kind: "fasta" | "fastq",
): { records: SequenceRecord[]; warnings: string[]; clipped: boolean } {
	const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/),
		records: SequenceRecord[] = [],
		warnings: string[] = [];
	let i = 0;
	if (kind === "fasta") {
		let current: SequenceRecord | null = null;
		for (; i < lines.length; i++) {
			const line = lines[i] || "";
			if (!line.trim() || line.startsWith(";")) continue;
			if (line.startsWith(">")) {
				if (current) records.push(current);
				if (records.length >= 20) break;
				current = { name: line.slice(1).slice(0, 500), sequence: "", length: 0 };
			} else if (current) {
				const seq = line.replace(/\s/g, "");
				current.length += seq.length;
				current.sequence = (current.sequence + seq).slice(0, 600);
			} else if (!warnings.length) warnings.push("序列前缺少 FASTA 标题（>）；无标题片段不计为记录。");
		}
		if (current && records.length < 20) records.push(current);
	} else {
		while (i < lines.length && records.length < 20) {
			if (!(lines[i] || "").trim()) {
				i++;
				continue;
			}
			if (!(lines[i] || "").startsWith("@")) {
				warnings.push(`第 ${i + 1} 行不是 FASTQ 标题；停止解析，避免错位。`);
				break;
			}
			const name = (lines[i++] || "").slice(1).slice(0, 500);
			let sequence = "",
				quality = "";
			while (i < lines.length && !(lines[i] || "").startsWith("+")) sequence += (lines[i++] || "").trim();
			const plus = i < lines.length;
			i++;
			while (i < lines.length && quality.length < sequence.length) quality += lines[i++] || "";
			const warning =
				!plus || !sequence.length || quality.length !== sequence.length
					? "片段不完整或序列/质量长度不一致；不能视为已通过格式校验。"
					: undefined;
			records.push({
				name,
				sequence: sequence.slice(0, 600),
				quality: quality.slice(0, 600),
				length: sequence.length,
				warning,
			});
		}
	}
	return { records, warnings, clipped: i < lines.length || records.some((r) => r.length > 600) };
}
