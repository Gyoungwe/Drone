import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionContext, InlineExtension } from "../../session-engine/sdk";
import { platformLine } from "./platform";

/** 会话内的执行位置选择（/run-on），随会话分支持久化 */
export const RUN_ON_CUSTOM_TYPE = "drone-run-on-v1";

/** 超过这个大小的测序/比对/变异等数据文件不允许整份读进上下文 */
export const LARGE_BIO_FILE_BYTES = 4 * 1024 * 1024;

const BIO_FORMATS: { test: RegExp; label: string; preview: string }[] = [
	{
		test: /\.(?:fastq|fq)(?:\.gz)?$/i,
		label: "FASTQ",
		preview: "seqkit stats FILE; seqkit head -n 4 FILE (or: zcat -f FILE | head -n 8)",
	},
	{
		test: /\.(?:bam|cram|sam)$/i,
		label: "SAM/BAM/CRAM",
		preview: "samtools view -H FILE | head; samtools flagstat FILE; samtools idxstats FILE",
	},
	{
		test: /\.(?:vcf|bcf)(?:\.gz)?$/i,
		label: "VCF/BCF",
		preview: "bcftools view -h FILE | tail -n 5; bcftools stats FILE | grep ^SN",
	},
	{
		test: /\.(?:fa|fasta|fna|faa|ffn)(?:\.gz)?$/i,
		label: "FASTA",
		preview: "seqkit stats FILE; seqkit fx2tab -n -l FILE | head",
	},
	{
		test: /\.(?:gff3?|gtf|bed)(?:\.gz)?$/i,
		label: "annotation/intervals",
		preview: "head -n 20 FILE; cut -f3 FILE | sort | uniq -c",
	},
	{
		test: /\.(?:h5ad|loom|h5|mtx)(?:\.gz)?$/i,
		label: "matrix",
		preview: "python -c 'import anndata; print(anndata.read_h5ad(\"FILE\"))'",
	},
];

/** read 工具打开大于阈值的生信数据文件时的拦截原因（含预览命令）；不需拦截返回 null */
export async function largeBioFileReason(cwd: string, rawPath: unknown): Promise<string | null> {
	if (typeof rawPath !== "string" || !rawPath) return null;
	const format = BIO_FORMATS.find((item) => item.test.test(rawPath));
	if (!format) return null;
	const path = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
	let size: number;
	try {
		size = (await stat(path)).size;
	} catch {
		return null;
	}
	if (size <= LARGE_BIO_FILE_BYTES) return null;
	const mb = (size / 1024 ** 2).toFixed(1);
	return `${rawPath} is a ${mb} MB ${format.label} file; reading it whole would flood the context. Inspect it with a preview command instead, e.g.: ${format.preview.replaceAll("FILE", rawPath)}`;
}

export type RunOn = "auto" | "local" | { host: string };

export function runOnLabel(value: RunOn): string {
	return value === "auto" ? "auto" : value === "local" ? "local" : value.host;
}

/** 环境工作流：探测 → 复用登记表 → mamba 创建 → 登记 → 运行；远程同理（带 host）。 */
export const ENVIRONMENT_WORKFLOW =
	"Analysis environments: bio_environment (platform, tools, registered envs) → bio_env_registry find + verify to reuse → only if none, create with mamba/bioconda inside the approved task plan (Windows: prefer WSL or a Linux host for bioconda tools) → bio_env_registry record → run via `<manager> run -n <env> <tool>`. Remote: the same steps with host=<alias> (ssh needs approval per connection; keys/ssh config only, never passwords). Missing tools are a setup step, not a reason to stop.";

/** 每轮注入的执行位置说明：用户指定的位置优先，auto 时按规则判断并说明理由 */
export function placementGuidance(value: RunOn): string {
	if (value === "local")
		return "Execution placement: the user chose LOCAL. Run analyses on this machine; do not move work to a remote host unless the user asks.";
	if (typeof value === "object")
		return `Execution placement: the user chose the remote host "${value.host}". Run heavy analyses there over SSH (each connection needs approval) and keep data on that host; only small results come back.`;
	return [
		"Execution placement (auto): before a heavy analysis, call bio_environment for this machine and, if useful, for registered hosts (ssh_hosts), then decide where to run and say why in one line.",
		"Prefer local when the needed tools are installed and the job fits (input under ~20 GB, threads within local CPUs, memory within free RAM).",
		"Prefer a remote host when a required tool exists only there, the data already lives there, or the job needs more CPUs, memory or disk than this machine has.",
		"The user can fix the choice with /run-on local, /run-on <host> or /run-on auto.",
	].join(" ");
}

/**
 * 生信执行扩展：/run-on 选择执行位置（本地 / 远程主机 / 自动）、每轮注入位置规则，
 * 并拦截 read 整份读取大型 FASTQ/BAM/VCF 等数据文件。
 */
export function makeBioExtension(): InlineExtension {
	return {
		name: "bio-execution",
		factory: (pi) => {
			let runOn: RunOn = "auto";
			const restore = (ctx: ExtensionContext) => {
				runOn = "auto";
				try {
					const entries = ctx.sessionManager.getBranch() as {
						type?: string;
						customType?: string;
						data?: unknown;
					}[];
					for (const entry of entries)
						if (entry.type === "custom" && entry.customType === RUN_ON_CUSTOM_TYPE) {
							const value = (entry.data as { runOn?: RunOn } | undefined)?.runOn;
							if (
								value === "auto" ||
								value === "local" ||
								(value && typeof value === "object" && typeof value.host === "string")
							)
								runOn = value;
						}
				} catch {
					/* fresh session */
				}
			};
			pi.on("session_start", (_event, ctx) => restore(ctx));
			pi.on("session_tree", (_event, ctx) => restore(ctx));
			pi.registerCommand?.("run-on", {
				description: "执行位置：local（本地）/ <主机别名>（远程）/ auto（由 Agent 判断）",
				handler: async (args: string, ctx: ExtensionContext) => {
					const value = String(args || "").trim();
					if (value) {
						runOn = value === "auto" ? "auto" : value === "local" ? "local" : { host: value };
						pi.appendEntry?.(RUN_ON_CUSTOM_TYPE, { runOn });
					}
					ctx.ui?.notify?.(`执行位置：${runOnLabel(runOn)}`, "info");
				},
			});
			pi.on("before_agent_start", (event) => ({
				systemPrompt: [event.systemPrompt, placementGuidance(runOn), platformLine(), ENVIRONMENT_WORKFLOW]
					.filter(Boolean)
					.join("\n\n"),
			}));
			pi.on("tool_call", async (event, ctx) => {
				if (event.toolName !== "read") return undefined;
				const input = event.input as { path?: unknown; file_path?: unknown } | undefined;
				const reason = await largeBioFileReason(ctx.cwd, input?.path ?? input?.file_path);
				return reason ? { block: true, reason } : undefined;
			});
		},
	};
}
