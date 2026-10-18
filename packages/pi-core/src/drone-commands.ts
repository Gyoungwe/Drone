import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** Public command/report contract used by native Pi and the Desktop command palette. */
export const DRONE_COMMAND_SCHEMA_VERSION = 1 as const;
export const PI_CORE_PACKAGE_VERSION = "0.1.1" as const;
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

const EXAMPLE_TOOLS = [
	"knowledge_status",
	"knowledge_search",
	"research_search_sources",
	"research_read_source",
	"research_answer_sources",
] as const;

type CheckStatus = "pass" | "blocked" | "unknown";

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
	status: "needs-data" | "blocked" | "ready" | "started";
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
		const entry = require.resolve("@earendil-works/pi-coding-agent");
		const packagePath = join(dirname(entry), "..", "package.json");
		const metadata = JSON.parse(readFileSync(packagePath, "utf8"));
		if (typeof metadata.version === "string" && metadata.version.length > 0)
			return { version: metadata.version, source: "resolved-package" };
	} catch {
		// A host can expose only the extension API (for example a test fixture).
	}
	return { version: null as unknown as string, source: "unavailable" };
}

function snapshot(pi: any): { tools: string[]; commands: string[] } {
	const tools: string[] =
		typeof pi?.getAllTools === "function"
			? pi.getAllTools().map((tool: { name?: unknown }) => String(tool?.name || "")).filter(Boolean)
			: typeof pi?.getActiveTools === "function"
				? pi.getActiveTools().map((name: unknown) => String(name)).filter(Boolean)
				: [];
	const commands: string[] =
		typeof pi?.getCommands === "function"
			? pi.getCommands().map((command: { name?: unknown }) => String(command?.name || "")).filter(Boolean)
			: [];
	return { tools: [...new Set(tools)].sort(), commands: [...new Set(commands)].sort() };
}

export function buildDoctorReport(
	pi: any,
	options: { hostKind?: DoctorReport["host"]["kind"]; hostVersion?: string | null } = {},
): DoctorReport {
	const current = snapshot(pi);
	const missingTools = CORE_TOOLS.filter((name) => !current.tools.includes(name));
	const missingCommands = ["drone-doctor", "drone-example"].filter((name) => !current.commands.includes(name));
	const resolved = options.hostVersion === undefined ? packageVersion() : { version: options.hostVersion, source: "host-contract" };
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
			detail: missingCommands.length ? "Drone onboarding commands are missing" : "doctor and example commands are registered",
			...(missingCommands.length ? { missing: missingCommands } : {}),
		},
		{
			id: "pi-host-version",
			status: resolved.version ? "pass" : "unknown",
			detail: resolved.version ? `resolved Pi host ${resolved.version}` : "Pi host version is not exposed by this host",
		},
	];
	const blocked = checks.some((check) => check.status === "blocked");
	return {
		schemaVersion: DRONE_COMMAND_SCHEMA_VERSION,
		command: "drone-doctor",
		status: blocked ? "blocked" : resolved.version ? "pass" : "unknown",
		plugin: { name: "@gyoungwe/pi-core", version: PI_CORE_PACKAGE_VERSION, piRange: PI_HOST_RANGE },
		host: { kind: hostKind, version: resolved.version || null, source: resolved.source },
		checks,
		commands: current.commands,
		tools: current.tools,
		next: blocked ? "安装或重新加载缺失的 Drone 插件后重试 /drone-doctor" : null,
	};
}

export function buildExampleReport(pi: any, mode: ExampleReport["mode"] = "preview", question?: string): ExampleReport {
	const current = snapshot(pi);
	const missingTools = EXAMPLE_TOOLS.filter((name) => !current.tools.includes(name));
	const hasQuestion = Boolean(question?.trim());
	const status: ExampleReport["status"] = missingTools.length ? "blocked" : mode === "run" && hasQuestion ? "started" : hasQuestion ? "ready" : "needs-data";
	return {
		schemaVersion: DRONE_COMMAND_SCHEMA_VERSION,
		command: "drone-example",
		status,
		mode,
		title: "Evidence-gated local research example",
		steps: ["inspect local knowledge", "read at least two sources", "answer with source receipts"],
		requiredTools: [...EXAMPLE_TOOLS],
		missingTools: [...missingTools],
		next: missingTools.length
			? "安装并启用 pi-knowledge 与 pi-research 后重试 /drone-example"
			: hasQuestion
				? mode === "run"
					? "研究回合已排队；等待真实来源回执"
					: "运行 /drone-example --run <研究问题> 开始只读示例"
				: "提供一个研究问题：/drone-example --run <研究问题>",
		...(hasQuestion ? { question: question?.trim() } : {}),
	};
}

function emitReport(report: DoctorReport | ExampleReport, ctx: ExtensionCommandContext): void {
	const message = JSON.stringify(report);
	if (ctx.mode === "print" || ctx.mode === "json") console.log(message);
	else ctx.ui.notify(message, report.status === "blocked" ? "warning" : "info");
}

/** Register the stable onboarding commands used by native Pi and Desktop. */
export function registerDroneCommands(pi: ExtensionAPI, options: { hostKind?: DoctorReport["host"]["kind"] } = {}): void {
	pi.registerCommand("drone-doctor", {
		description: "Check the resolved Pi host, core tools and Drone command contract",
		handler: async (_args, ctx) => emitReport(buildDoctorReport(pi, options), ctx),
	});
	pi.registerCommand("drone-example", {
		description: "Preview or start a read-only evidence-gated research example",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const run = trimmed.startsWith("--run");
			const question = run ? trimmed.slice("--run".length).trim() : trimmed;
			const report = buildExampleReport(pi, run ? "run" : "preview", question || undefined);
			if (run && report.status === "started" && typeof pi.sendUserMessage === "function") {
				await pi.sendUserMessage(
					`Run a read-only Drone research example for this question: ${question}\nUse local evidence first, read at least two sources, preserve source URIs and hashes, and report blocked/unknown states instead of guessing.`,
					{ deliverAs: "followUp", expandPromptTemplates: true },
				);
			}
			emitReport(report, ctx);
		},
	});
}
