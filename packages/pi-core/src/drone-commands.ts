import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** Public command/report contract used by native Pi and the Desktop command palette. */
export const DRONE_COMMAND_SCHEMA_VERSION = 1 as const;
export const PI_CORE_PACKAGE_VERSION = "0.1.3" as const;
export const PI_HOST_RANGE = ">=1.1.0 <2.0.0" as const;

const CORE_TOOLS = [
	"ask_user",
	"set_status",
	"todo",
	"deliver_files",
	"memory_save",
	"task_plan",
	"task_status",
	"task_wait",
	"task_reconcile",
	"task_evidence_restore",
] as const;

export type ExampleKind = "knowledge" | "research" | "analysis" | "evidence";
type KnowledgeStatus = "configured" | "unconfigured" | "unknown";

const EXAMPLE_PROFILES: Record<
	ExampleKind,
	{
		title: string;
		steps: readonly string[];
		requiredTools: readonly string[];
		missingToolsNext: string;
		missingDataNext: string;
		requiresContainer?: boolean;
	}
> = {
	knowledge: {
		title: "Knowledge Vault example",
		steps: ["check the local Vault", "search local knowledge", "cite the retrieved note paths"],
		requiredTools: ["knowledge_status", "knowledge_search"],
		missingToolsNext: "安装并启用 pi-knowledge 后重试 /drone-example knowledge",
		missingDataNext: "提供一个知识问题：/drone-example knowledge --run <问题>",
	},
	research: {
		title: "Evidence-gated local research example",
		steps: ["inspect local knowledge", "read at least two sources", "answer with source receipts"],
		requiredTools: ["research_search_sources", "research_read_source", "research_answer_sources"],
		missingToolsNext: "安装并启用 pi-research 后重试 /drone-example research",
		missingDataNext: "提供一个研究问题：/drone-example research --run <研究问题>",
	},
	analysis: {
		title: "Analysis readiness example",
		requiresContainer: true,
		steps: [
			"list compatible analysis adapters",
			"assess input readiness",
			"report missing data before execution",
		],
		requiredTools: ["analysis_list_adapters", "analysis_assess_readiness"],
		missingToolsNext: "安装并启用 pi-analysis 后重试 /drone-example analysis",
		missingDataNext: "提供输入与分析问题：/drone-example analysis --run <分析问题>",
	},
	evidence: {
		title: "Evidence validation example",
		steps: ["validate an artifact manifest", "validate an evidence capsule", "verify replay metadata"],
		requiredTools: ["evidence_validate_manifest", "evidence_validate_capsule", "evidence_verify_replay"],
		missingToolsNext: "安装并启用 pi-evidence 后重试 /drone-example evidence",
		missingDataNext: "提供待核验的证据对象：/drone-example evidence --run <对象>",
	},
};
const EXAMPLE_KINDS = new Set<ExampleKind>(Object.keys(EXAMPLE_PROFILES) as ExampleKind[]);

type CheckStatus = "pass" | "blocked" | "incompatible" | "unknown";

export interface DoctorReport {
	schemaVersion: typeof DRONE_COMMAND_SCHEMA_VERSION;
	command: "drone-doctor";
	status: CheckStatus;
	plugin: { name: "@gyoungwe/pi-core"; version: string; piRange: string };
	host: { kind: "native-pi" | "drone-desktop" | "unknown"; version: string | null; source: string };
	checks: Array<{ id: string; status: CheckStatus; detail: string; missing?: string[] }>;
	commands: string[];
	tools: string[];
	next: string | null;
}

export interface ExampleReport {
	schemaVersion: typeof DRONE_COMMAND_SCHEMA_VERSION;
	command: "drone-example";
	example: ExampleKind;
	status: "unconfigured" | "needs-data" | "needs-container" | "blocked" | "ready" | "started";
	mode: "preview" | "run";
	title: string;
	steps: string[];
	requiredTools: string[];
	missingTools: string[];
	next: string;
	question?: string;
}

function packageVersion(): { version: string; source: string } {
	const configured = process.env.PI_VERSION?.trim();
	if (configured) return { version: configured, source: "PI_VERSION" };
	try {
		const require = createRequire(import.meta.url);
		// The Pi package intentionally exposes ESM entrypoints without a CommonJS
		// export. Resolve the search paths, then read the installed package metadata
		// directly so doctor works in both native Pi and test hosts.
		for (const base of require.resolve.paths("@earendil-works/pi-coding-agent") ?? []) {
			const packagePath = join(base, "@earendil-works/pi-coding-agent", "package.json");
			try {
				const metadata = JSON.parse(readFileSync(packagePath, "utf8"));
				if (typeof metadata.version === "string" && metadata.version.length > 0)
					return { version: metadata.version, source: "resolved-package" };
			} catch {
				// Try the next Node module search path.
			}
		}
	} catch {
		// A host can expose only the extension API (for example a test fixture).
	}
	return { version: null as unknown as string, source: "unavailable" };
}

function snapshot(pi: any): { tools: string[]; commands: string[] } {
	const tools: string[] =
		typeof pi?.getAllTools === "function"
			? pi
					.getAllTools()
					.map((tool: { name?: unknown }) => String(tool?.name || ""))
					.filter(Boolean)
			: typeof pi?.getActiveTools === "function"
				? pi
						.getActiveTools()
						.map((name: unknown) => String(name))
						.filter(Boolean)
				: [];
	const commands: string[] =
		typeof pi?.getCommands === "function"
			? pi
					.getCommands()
					.map((command: { name?: unknown }) => String(command?.name || ""))
					.filter(Boolean)
			: [];
	return { tools: [...new Set(tools)].sort(), commands: [...new Set(commands)].sort() };
}

function isSupportedPiHost(version: string): boolean {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
	if (!match) return false;
	const major = Number(match[1]);
	const minor = Number(match[2]);
	const patch = Number(match[3]);
	return major === 1 && (minor > 1 || (minor === 1 && patch >= 0));
}

export function buildDoctorReport(
	pi: any,
	options: { hostKind?: DoctorReport["host"]["kind"]; hostVersion?: string | null } = {},
): DoctorReport {
	const current = snapshot(pi);
	const missingTools = CORE_TOOLS.filter((name) => !current.tools.includes(name));
	const missingCommands = ["drone-doctor", "drone-example"].filter(
		(name) => !current.commands.includes(name),
	);
	const resolved =
		options.hostVersion === undefined
			? packageVersion()
			: { version: options.hostVersion, source: "host-contract" };
	const hostCompatible = resolved.version ? isSupportedPiHost(resolved.version) : null;
	const hostKind = options.hostKind || "native-pi";
	const checks: DoctorReport["checks"] = [
		{
			id: "core-tools",
			status: missingTools.length ? "blocked" : "pass",
			detail: missingTools.length ? "pi-core tools are missing" : "all pi-core tools are registered",
			...(missingTools.length ? { missing: missingTools } : {}),
		},
		{
			id: "drone-commands",
			status: missingCommands.length ? "blocked" : "pass",
			detail: missingCommands.length
				? "Drone onboarding commands are missing"
				: "doctor and example commands are registered",
			...(missingCommands.length ? { missing: missingCommands } : {}),
		},
		{
			id: "pi-host-version",
			status: resolved.version ? (hostCompatible ? "pass" : "incompatible") : "unknown",
			detail: resolved.version
				? hostCompatible
					? `resolved Pi host ${resolved.version}`
					: `Pi host ${resolved.version} is outside ${PI_HOST_RANGE}`
				: "Pi host version is not exposed by this host",
		},
	];
	const blocked = checks.some((check) => check.status === "blocked");
	const incompatible = checks.some((check) => check.status === "incompatible");
	return {
		schemaVersion: DRONE_COMMAND_SCHEMA_VERSION,
		command: "drone-doctor",
		status: blocked ? "blocked" : incompatible ? "incompatible" : resolved.version ? "pass" : "unknown",
		plugin: { name: "@gyoungwe/pi-core", version: PI_CORE_PACKAGE_VERSION, piRange: PI_HOST_RANGE },
		host: { kind: hostKind, version: resolved.version || null, source: resolved.source },
		checks,
		commands: current.commands,
		tools: current.tools,
		next: blocked
			? "安装或重新加载缺失的 Drone 插件后重试 /drone-doctor"
			: incompatible
				? `升级 Pi 到 ${PI_HOST_RANGE} 后重试 /drone-doctor`
				: null,
	};
}

export function buildExampleReport(
	pi: any,
	mode: ExampleReport["mode"] = "preview",
	question?: string,
	options: {
		example?: ExampleKind;
		knowledgeStatus?: KnowledgeStatus;
		containerAvailable?: boolean;
	} = {},
): ExampleReport {
	const example = options.example ?? "research";
	const profile = EXAMPLE_PROFILES[example];
	const current = snapshot(pi);
	const missingTools = profile.requiredTools.filter((name) => !current.tools.includes(name));
	const hasQuestion = Boolean(question?.trim());
	const knowledgeStatus =
		example === "knowledge"
			? (options.knowledgeStatus ?? (process.env.DRONE_KNOWLEDGE_DIR?.trim() ? "unknown" : "unconfigured"))
			: undefined;
	const containerAvailable = options.containerAvailable ?? Boolean(process.env.DRONE_CONTAINER_RUNTIME?.trim());
	const missingContainer = Boolean(profile.requiresContainer && !containerAvailable);
	const status: ExampleReport["status"] = missingTools.length
		? "blocked"
		: knowledgeStatus === "unconfigured"
			? "unconfigured"
			: knowledgeStatus === "unknown"
				? "needs-data"
				: missingContainer
					? "needs-container"
					: mode === "run" && hasQuestion
						? "started"
						: hasQuestion
							? "ready"
							: "needs-data";
	return {
		schemaVersion: DRONE_COMMAND_SCHEMA_VERSION,
		command: "drone-example",
		example,
		status,
		mode,
		title: profile.title,
		steps: [...profile.steps],
		requiredTools: [...profile.requiredTools],
		missingTools: [...missingTools],
		next: missingTools.length
			? profile.missingToolsNext
			: missingContainer
				? "登记并启用一个容器运行时后重试 /drone-example analysis"
				: knowledgeStatus === "unconfigured"
				? "先运行 /drone-init 绑定本地 Vault，再重试 /drone-example knowledge"
				: knowledgeStatus === "unknown"
					? "无法确认本地 Vault 状态；先运行 /drone-init 或检查知识库插件后重试"
					: hasQuestion
						? mode === "run"
							? `${profile.title} 已排队；等待真实回执`
							: `运行 /drone-example ${example} --run <问题> 开始只读示例`
						: profile.missingDataNext,
		...(hasQuestion ? { question: question?.trim() } : {}),
	};
}

export function parseExampleArgs(args: string): {
	mode: ExampleReport["mode"];
	example: ExampleKind;
	question?: string;
} {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	let mode: ExampleReport["mode"] = "preview";
	const remaining = tokens.filter((token) => {
		if (token === "--run") {
			mode = "run";
			return false;
		}
		return true;
	});
	const candidate = remaining[0]?.toLowerCase() as ExampleKind | undefined;
	const example = candidate && EXAMPLE_KINDS.has(candidate) ? candidate : "research";
	if (candidate && EXAMPLE_KINDS.has(candidate)) remaining.shift();
	const question = remaining.join(" ").trim();
	return { mode, example, ...(question ? { question } : {}) };
}

async function resolveKnowledgeStatus(pi: any, ctx: ExtensionCommandContext): Promise<KnowledgeStatus> {
	if (!process.env.DRONE_KNOWLEDGE_DIR?.trim()) return "unconfigured";
	const tool =
		typeof pi?.getAllTools === "function"
			? pi.getAllTools().find((candidate: { name?: unknown }) => candidate?.name === "knowledge_status")
			: undefined;
	if (typeof tool?.execute !== "function") return "unknown";
	try {
		const result = await tool.execute(
			"drone-example:knowledge-status",
			{},
			new AbortController().signal,
			() => undefined,
			ctx,
		);
		const status = result?.details?.status ?? result?.status;
		if (status === "unconfigured") return "unconfigured";
		if (status === "configured") return "configured";
	} catch {
		// A failed status probe must remain explicit and must not look ready.
	}
	return "unknown";
}

function emitReport(report: DoctorReport | ExampleReport, ctx: ExtensionCommandContext): void {
	const message = JSON.stringify(report);
	if (ctx.mode === "print" || ctx.mode === "json") console.log(message);
	else
		ctx.ui.notify(
			message,
			report.status === "blocked" || report.status === "unconfigured" || report.status === "needs-container" || report.status === "incompatible"
				? "warning"
				: "info",
		);
}

/** Register the stable onboarding commands used by native Pi and Desktop. */
export function registerDroneCommands(
	pi: ExtensionAPI,
	options: { hostKind?: DoctorReport["host"]["kind"] } = {},
): void {
	pi.registerCommand("drone-doctor", {
		description: "Check the resolved Pi host, core tools and Drone command contract",
		handler: async (_args, ctx) => emitReport(buildDoctorReport(pi, options), ctx),
	});
	pi.registerCommand("drone-example", {
		description: "Preview or start a read-only Drone knowledge, research, analysis or evidence example",
		handler: async (args, ctx) => {
			const parsed = parseExampleArgs(args);
			const knowledgeStatus =
				parsed.example === "knowledge" ? await resolveKnowledgeStatus(pi, ctx) : undefined;
			const report = buildExampleReport(pi, parsed.mode, parsed.question, {
				example: parsed.example,
				knowledgeStatus,
			});
			if (parsed.mode === "run" && report.status === "started" && typeof pi.sendUserMessage === "function") {
				await pi.sendUserMessage(
					`Run a read-only Drone ${report.example} example for this question: ${parsed.question}\nUse local evidence first, preserve source URIs and hashes, and report blocked/unknown states instead of guessing.`,
					{ deliverAs: "followUp", expandPromptTemplates: true },
				);
			}
			emitReport(report, ctx);
		},
	});
}
