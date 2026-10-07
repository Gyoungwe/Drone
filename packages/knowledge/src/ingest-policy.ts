/**
 * 知识入库标准的分类器：把一个文件或一次写入判定为 知识（knowledge）/ 运行结果（run-result）/
 * 临时内容（ephemeral）。九条规则按顺序执行，第一条命中即生效；每条都只依赖可机器判定的信号。
 * 纯函数：不读写文件，调用方提供路径、来源与（可选）正文。规则说明见 docs/knowledge-ingest-standard.md。
 */
import { extractIdentifiers } from "./ingest-identity";
import {
	classForType,
	type IngestClass,
	isKnowledgeType,
	isNoteType,
	KNOWLEDGE_TYPES,
	type KnowledgeType,
	type NoteType,
	parseFrontmatter,
} from "./ingest-frontmatter";

/** 运行结果的用途（与 inquiry `ArtifactPurpose` 对齐，另加日志、来源、摘要、卡片和展示层）。 */
export type IngestPurpose =
	| "deliverable"
	| "intermediate"
	| "log"
	| "source"
	| "summary"
	| "cards"
	| "presentation"
	| "navigation";

export type IngestRule = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const INGEST_RULES: Readonly<Record<IngestRule, string>> = {
	1: "ephemeral-path",
	2: "explicit-declaration",
	3: "tool-origin",
	4: "run-record-filename",
	5: "card-container",
	6: "data-or-figure",
	7: "cited-markdown-candidate",
	8: "confirmed-inquiry-record",
	9: "location-fallback",
};

export interface IngestOrigin {
	/** 产生内容的工具，如 `research_deposit_knowledge`、`research_summarize_run`。 */
	tool?: string;
	/** 工具参数里的类型（deposit 的 `type`）。 */
	type?: string;
	/** inquiry 账本记录（规则 8）。 */
	inquiry?: {
		kind: "finding" | "decision";
		/** finding.reviewStatus 或 decision.status。 */
		status: string;
	};
}

export interface IngestInput {
	/** 相对路径（工作区或 Vault），`/` 或 `\` 分隔均可。inquiry 记录可以为空。 */
	path?: string;
	/** 路径所在位置；`vault` 时启用规范目录判定（规则 2）。缺省按路径推断。 */
	location?: "vault" | "workspace";
	origin?: IngestOrigin;
	/** Markdown 正文（可含 frontmatter）。用于规则 2 与规则 7。 */
	text?: string;
	/** 已解析的 frontmatter（优先于从 `text` 解析）。 */
	frontmatter?: Record<string, unknown> | null;
	/** 文件是否命中某个任务里程碑的验收（决定数据/图表是 deliverable 还是 intermediate）。 */
	acceptance?: boolean;
	/** 调用方已确认文件位于某个运行目录内。缺省按路径中的 `results/`、`runs/`、`run-*` 推断。 */
	inRunDir?: boolean;
}

export interface IngestDecision {
	class: IngestClass;
	/** 推断出的笔记类型；运行产物文件和临时内容为 null。 */
	type: NoteType | null;
	purpose: IngestPurpose | null;
	rule: IngestRule;
	ruleId: string;
	/** 是知识候选（需要经过质量门 / 审核队列），而不是已确认的知识。 */
	candidate: boolean;
	/** 运行结果容器里含有可抽取的知识原子（如逐篇证据卡）。 */
	extractAtoms: boolean;
	reasons: string[];
}

const EPHEMERAL_DIRS = new Set([
	"tmp",
	"temp",
	".tmp",
	".cache",
	"cache",
	"scratch",
	"__pycache__",
	"node_modules",
	".ipynb_checkpoints",
	".git",
	".trash",
	"browser-downloads",
]);
const EPHEMERAL_FILE =
	/(?:\.(?:tmp|temp|swp|swo|bak|pyc|pyo|part|crdownload|lock)$|~$|^\.ds_store$|^thumbs\.db$|^desktop\.ini$|^\.~lock\.)/i;

const RUN_RECORD_FILES: ReadonlyArray<[RegExp, IngestPurpose]> = [
	[/^search[-_]?log.*\.(?:md|txt|json)$/i, "log"],
	[/receipts?.*\.(?:md|json|jsonl)$/i, "log"],
	[/^literature-operations\.json$/i, "log"],
	[/^metadata\.json$/i, "log"],
	[/^manifest.*\.json$/i, "log"],
	[/^failures?.*\.(?:json|md)$/i, "log"],
	[/^provenance.*\.(?:json|md)$/i, "log"],
	[/^summary\.md$/i, "summary"],
	[/^report.*\.html?$/i, "presentation"],
];
const CARD_CONTAINERS = /^(?:evidence-cards|claims?)(?:[-_.].*)?\.md$|-cards\.md$/i;

const DATA_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"svg",
	"webp",
	"tif",
	"tiff",
	"pdf",
	"eps",
	"csv",
	"tsv",
	"txt",
	"json",
	"jsonl",
	"xlsx",
	"xls",
	"parquet",
	"feather",
	"h5",
	"h5ad",
	"hdf5",
	"rds",
	"rdata",
	"npy",
	"npz",
	"pkl",
	"html",
	"nwk",
	"newick",
	"tre",
	"tree",
	"nex",
	"nexus",
	"fasta",
	"fa",
	"fna",
	"faa",
	"fastq",
	"fq",
	"aln",
	"phy",
	"sam",
	"bam",
	"cram",
	"vcf",
	"bcf",
	"bed",
	"gff",
	"gff3",
	"gtf",
	"mtx",
	"loom",
	"gz",
	"zip",
]);

/** Vault 规范目录 → 类型（规则 2）。 */
const LIBRARY_FOLDERS: Readonly<Record<string, NoteType>> = {
	Papers: "paper",
	Methods: "method",
	Software: "software",
	Datasets: "dataset",
	Concepts: "concept",
	Entities: "entity",
	Ideas: "idea",
	Explainers: "explainer",
};
const PROJECT_FOLDERS: Readonly<Record<string, NoteType>> = {
	Questions: "question",
	Concepts: "concept",
	Entities: "entity",
	Papers: "paper",
	Sources: "paper",
	Evidence: "evidence",
	Claims: "claim",
	Decisions: "decision",
	Wiki: "wiki",
	Runs: "run",
	Artifacts: "artifact",
};
const VAULT_ROOTS = new Set(["Library", "Projects", "Wiki", "Inbox"]);

/** 工具或宿主动作 → 判定（规则 3）。 */
const RUN_RESULT_TOOLS: Readonly<Record<string, { type: NoteType | null; purpose: IngestPurpose }>> = {
	research_summarize_run: { type: "run", purpose: "summary" },
	research_archive_source: { type: null, purpose: "source" },
	research_loop: { type: null, purpose: "log" },
	research_archive_explainer: { type: "explainer", purpose: "presentation" },
	research_zotero_save: { type: null, purpose: "log" },
	research_zotero_update: { type: null, purpose: "log" },
};
const KNOWLEDGE_TOOLS: Readonly<Record<string, KnowledgeType | "from-type">> = {
	research_deposit_knowledge: "from-type",
	research_propose_wiki_update: "wiki",
	/** 宿主动作：用户在「新想法」里点保存（ui-service `saveDiscoveryIdea`）。 */
	daily_discovery: "idea",
};

const METHOD_HEADING =
	/^#{1,4}\s*(?:methods?|protocols?|procedure|usage|installation|how to|workflow|方法|流程|步骤|用法|安装|使用方法|操作步骤)(?![\p{L}\p{N}])/imu;
const CONCLUSION_HEADING =
	/^#{1,4}\s*(?:conclusions?|findings?|key findings|results and discussion|summary of evidence|结论|发现|主要发现|要点)(?![\p{L}\p{N}])/imu;
export const CANDIDATE_MIN_CHARS = 300;

function segments(path: string): string[] {
	return path
		.replaceAll("\\", "/")
		.split("/")
		.filter((part) => part && part !== ".");
}

function decision(
	rule: IngestRule,
	value: Partial<IngestDecision> & Pick<IngestDecision, "class">,
	reasons: string[],
): IngestDecision {
	return {
		type: null,
		purpose: null,
		candidate: false,
		extractAtoms: false,
		...value,
		rule,
		ruleId: INGEST_RULES[rule],
		reasons,
	};
}

function inferLocation(parts: string[]): "vault" | "workspace" {
	return VAULT_ROOTS.has(parts[0] ?? "") ? "vault" : "workspace";
}

function looksLikeRunDir(parts: string[]): boolean {
	return parts.some((part) => /^(?:results|runs)$/i.test(part) || /^run-/i.test(part));
}

function vaultFolderDecision(parts: string[]): IngestDecision | null {
	const [root, second, third] = parts;
	const file = parts.at(-1) ?? "";
	const navigationDepth = root === "Projects" ? 3 : 2;
	if (parts.length === 1 || (parts.length === navigationDepth && /^(?:Index|Context|Home)\.md$/i.test(file)))
		return decision(2, { class: "knowledge", purpose: "navigation" }, ["Vault navigation page"]);
	if (root === "Wiki") return decision(2, { class: "knowledge", type: "wiki" }, ["Vault folder Wiki/"]);
	if (root === "Inbox")
		return decision(2, { class: "knowledge", candidate: true }, ["Vault folder Inbox/ holds unreviewed input"]);
	if (root === "Library" && second && LIBRARY_FOLDERS[second]) {
		const type = LIBRARY_FOLDERS[second] as NoteType;
		return decision(
			2,
			{ class: classForType(type), type, ...(type === "explainer" ? { purpose: "presentation" as const } : {}) },
			[`Vault folder Library/${second}/`],
		);
	}
	if (root === "Projects" && third && PROJECT_FOLDERS[third]) {
		const type = PROJECT_FOLDERS[third] as NoteType;
		return decision(2, { class: classForType(type), type }, [`Vault folder Projects/<project>/${third}/`]);
	}
	return null;
}

function frontmatterOf(input: IngestInput): Record<string, unknown> | null {
	if (input.frontmatter && typeof input.frontmatter === "object") return input.frontmatter;
	if (typeof input.text !== "string") return null;
	return parseFrontmatter(input.text).data;
}

function bodyOf(text: string | undefined): string {
	if (typeof text !== "string") return "";
	return parseFrontmatter(text).body;
}

function citesSources(body: string): boolean {
	const ids = extractIdentifiers(body);
	if (ids.doi.length || ids.pmid.length || ids.pmcid.length || ids.arxiv.length || ids.url.length) return true;
	return /\[\[(?:Library|Projects|Wiki)\/[^\]]+\]\]/.test(body);
}

function candidateType(body: string): KnowledgeType | null {
	if (METHOD_HEADING.test(body)) return "method";
	if (CONCLUSION_HEADING.test(body)) return "claim";
	return null;
}

/**
 * 按九条有序规则分类。
 *
 * 1. 临时路径（tmp/、.cache/、scratch/、*.tmp …）→ ephemeral
 * 2. 显式声明：frontmatter `class`/`type`，或 Vault 规范目录 → 按声明
 * 3. 工具来源（deposit / Wiki 提议 → knowledge；summarize / archive_source / research_loop / 讲解 → run-result）
 * 4. 运行记录文件名（search-log、*receipts*、metadata.json、manifest、failures、SUMMARY.md …）→ run-result
 * 5. 卡片容器（evidence-cards.md、*-cards.md、claims.md）→ run-result，并标记可抽取知识原子
 * 6. 数据 / 图表后缀 → run-result（命中验收为 deliverable，否则 intermediate）
 * 7. 带来源、≥300 字、含方法或结论标题的 Markdown → knowledge 候选
 * 8. inquiry 中已复核的 finding / 已确认的 decision → knowledge（claim / decision）
 * 9. 兜底：在运行目录内 → run-result（intermediate），否则 ephemeral
 */
export function classifyIngest(input: IngestInput): IngestDecision {
	const parts = segments(String(input.path ?? ""));
	const file = parts.at(-1) ?? "";
	const extension = file.includes(".") ? (file.split(".").at(-1) ?? "").toLowerCase() : "";
	const location = input.location ?? inferLocation(parts);
	const inRunDir = input.inRunDir ?? looksLikeRunDir(parts);

	// 1. 临时路径
	const ephemeralDir = parts.slice(0, -1).find((part) => EPHEMERAL_DIRS.has(part.toLowerCase()));
	if (ephemeralDir) return decision(1, { class: "ephemeral" }, [`inside ${ephemeralDir}/`]);
	if (file && EPHEMERAL_FILE.test(file)) return decision(1, { class: "ephemeral" }, [`temporary file ${file}`]);

	// 2. 显式声明
	const frontmatter = frontmatterOf(input);
	if (frontmatter) {
		const declared = frontmatter.class;
		const type = String(frontmatter.type ?? "").toLowerCase();
		if (declared === "ephemeral") return decision(2, { class: "ephemeral" }, ["frontmatter class: ephemeral"]);
		if (declared === "knowledge" || declared === "run-result")
			return decision(
				2,
				{ class: declared, type: isNoteType(type) ? type : null, candidate: frontmatter.status === "candidate" },
				[`frontmatter class: ${declared}`],
			);
		if (isNoteType(type))
			return decision(2, { class: classForType(type), type, candidate: frontmatter.status === "candidate" }, [
				`frontmatter type: ${type}`,
			]);
	}
	if (location === "vault" && /\.md$/i.test(file)) {
		const folder = vaultFolderDecision(parts);
		if (folder) return folder;
	}

	// 3. 工具来源
	const tool = input.origin?.tool;
	if (tool && KNOWLEDGE_TOOLS[tool]) {
		const mapped = KNOWLEDGE_TOOLS[tool];
		const type = mapped === "from-type" ? String(input.origin?.type ?? "").toLowerCase() : mapped;
		if (isKnowledgeType(type)) return decision(3, { class: "knowledge", type }, [`written by ${tool} (${type})`]);
	}
	if (tool && RUN_RESULT_TOOLS[tool]) {
		const mapped = RUN_RESULT_TOOLS[tool];
		return decision(3, { class: "run-result", type: mapped.type, purpose: mapped.purpose }, [`written by ${tool}`]);
	}

	// 4. 运行记录文件名
	const inHistory = parts.slice(0, -1).some((part) => part.toLowerCase() === "summary-history");
	if (inHistory) return decision(4, { class: "run-result", purpose: "summary" }, ["summary-history/ snapshot"]);
	for (const [pattern, purpose] of RUN_RECORD_FILES)
		if (pattern.test(file)) return decision(4, { class: "run-result", purpose }, [`run record file ${file}`]);

	// 5. 卡片容器
	if (CARD_CONTAINERS.test(file))
		return decision(5, { class: "run-result", purpose: "cards", extractAtoms: true }, [
			`card container ${file}; each card may yield knowledge atoms`,
		]);

	// 6. 数据 / 图表
	if (extension && DATA_EXTENSIONS.has(extension)) {
		const purpose = input.acceptance ? "deliverable" : "intermediate";
		return decision(6, { class: "run-result", purpose }, [
			`data/figure file .${extension}`,
			input.acceptance ? "matches a milestone acceptance" : "not a milestone deliverable",
		]);
	}

	// 7. 带来源的 Markdown 知识候选
	if (/\.md$/i.test(file) && typeof input.text === "string") {
		const body = bodyOf(input.text);
		const length = [...body.trim()].length;
		const type = candidateType(body);
		if (length >= CANDIDATE_MIN_CHARS && type && citesSources(body))
			return decision(7, { class: "knowledge", type, candidate: true }, [
				`${length} chars with a ${type === "method" ? "method" : "conclusion"} heading and cited sources`,
			]);
	}

	// 8. inquiry 已确认记录
	const inquiry = input.origin?.inquiry;
	if (inquiry) {
		const status = String(inquiry.status || "").toLowerCase();
		if (inquiry.kind === "finding" && status === "reviewed")
			return decision(8, { class: "knowledge", type: "claim" }, ["finding reviewed by the user"]);
		if (inquiry.kind === "decision" && ["confirmed", "active", "accepted"].includes(status))
			return decision(8, { class: "knowledge", type: "decision" }, ["decision confirmed by the user"]);
	}

	// 9. 兜底
	if (inRunDir) return decision(9, { class: "run-result", purpose: "intermediate" }, ["inside a run directory"]);
	return decision(9, { class: "ephemeral" }, ["no knowledge or run-result signal"]);
}

/** 便于文档与 UI 展示：所有知识类型。 */
export const INGEST_KNOWLEDGE_TYPES: readonly KnowledgeType[] = KNOWLEDGE_TYPES;
