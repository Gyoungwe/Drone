import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { SessionEvent } from "@drone/shared";
import type { InquiryEventArtifact, InquiryLocalExecutionEvent, InquiryServicePort } from "./inquiry";

const execFile = promisify(execFileCallback);
const SCRIPT_INTERPRETERS = new Set([
	"python",
	"python3",
	"python3.11",
	"node",
	"bash",
	"sh",
	"zsh",
	"rscript",
]);
const OUTPUT_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".svg",
	".webp",
	".pdf",
	".csv",
	".json",
	".html",
	".md",
	".txt",
	".tsv",
]);
const MAX_FILES = 64;
const MAX_FILE_BYTES = 16 * 1024 * 1024;

type Pending = { readonly startedAt: number; readonly args: Record<string, unknown> };

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function tokens(command: string): string[] {
	return [...command.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s]+)/g)].map(
		(match) => match[1] ?? match[2] ?? match[3] ?? "",
	);
}
function scalar(value: string): string | number | boolean | null {
	if (value === "true" || value === "false") return value === "true";
	if (value === "null") return null;
	const number = Number(value);
	return value.trim() !== "" && Number.isFinite(number) ? number : value.slice(0, 400);
}
function commandOf(args: Record<string, unknown>, result: Record<string, unknown>): string | undefined {
	for (const value of [args.command, args.cmd, args.script, result.command, result.cmd])
		if (typeof value === "string" && value.trim()) return value;
	return undefined;
}
function stringsAt(value: unknown, key = ""): string[] {
	if (typeof value === "string") return /path|file|output|artifact/i.test(key) ? [value] : [];
	if (Array.isArray(value)) return value.flatMap((item) => stringsAt(item, key)).slice(0, MAX_FILES);
	if (!value || typeof value !== "object") return [];
	return Object.entries(value)
		.flatMap(([name, item]) => stringsAt(item, name))
		.slice(0, MAX_FILES);
}
function safeRelative(root: string, candidate: string): string | undefined {
	const absolute = resolve(root, candidate);
	const rel = relative(resolve(root), absolute).replaceAll("\\", "/");
	return rel && rel !== "." && !rel.startsWith("../") && rel !== ".." ? rel : undefined;
}

/** Records only hashes, scalar parameters and bounded environment summaries for local executions. */
export class LocalExecutionRecorder {
	private readonly pending = new Map<string, Pending>();

	constructor(
		private readonly options: {
			readonly inquiry: InquiryServicePort;
			readonly getCwd: (sessionId: string) => string | undefined;
			readonly getProjectId: (sessionId: string) => string | undefined;
			readonly scheduleReview?: (sessionId: string, paths: readonly string[]) => void;
		},
	) {}

	observe(sessionId: string, input: SessionEvent): void {
		if (input.type === "tool_execution_start" && input.toolName === "bash") {
			this.pending.set(`${sessionId}:${input.toolCallId}`, {
				startedAt: Date.now(),
				args: record(input.args),
			});
			return;
		}
		if (input.type !== "tool_execution_end" || input.toolName !== "bash") return;
		const key = `${sessionId}:${input.toolCallId}`;
		const start = this.pending.get(key);
		this.pending.delete(key);
		if (!start || input.isError) return;
		void this.finish(sessionId, input, start).catch(() => {});
	}

	async recordKernelExecution(input: {
		readonly sessionId: string;
		readonly projectId: string;
		readonly cwd: string;
		readonly runDirectory: string;
		readonly language: string;
		readonly code: string;
		readonly execution: {
			readonly id: string;
			readonly status: string;
			readonly startedAt?: string;
			readonly finishedAt?: string;
		};
	}): Promise<void> {
		const root = resolve(input.cwd);
		const runRoot = resolve(root, input.runDirectory);
		const artifacts = await this.artifactsForPaths(
			root,
			runRoot,
			[],
			input.execution.finishedAt ? Date.parse(input.execution.finishedAt) : Date.now(),
			input.execution.id,
		);
		if (!artifacts.length) return;
		const event: InquiryLocalExecutionEvent = {
			id: `kernel:${input.execution.id}`,
			projectId: input.projectId,
			sessionId: input.sessionId,
			toolName: `discovery-${input.language}`,
			codeFingerprint: createHash("sha256").update(input.code).digest("hex"),
			parameters: {},
			runProvenance: {
				workflow: "local",
				modules: ["discovery-kernel"],
				environment: { language: input.language, node: process.version },
			},
			outcome: input.execution.status === "succeeded" ? "succeeded" : "failed",
			startedAt: input.execution.startedAt,
			finishedAt: input.execution.finishedAt,
			artifacts,
		};
		await this.options.inquiry.recordLocalExecution(event);
		this.options.scheduleReview?.(
			input.sessionId,
			artifacts.map((item) => item.path),
		);
	}

	private async finish(
		sessionId: string,
		input: Extract<SessionEvent, { type: "tool_execution_end" }>,
		start: Pending,
	): Promise<void> {
		const cwd = this.options.getCwd(sessionId);
		const projectId = this.options.getProjectId(sessionId);
		if (!cwd || !projectId) return;
		const args = start.args;
		const result = record(input.result);
		const command = commandOf(args, result);
		if (!command) return;
		const parsed = tokens(command);
		const interpreterIndex = parsed.findIndex((item) =>
			SCRIPT_INTERPRETERS.has(basename(item).toLowerCase()),
		);
		if (interpreterIndex < 0 || !parsed[interpreterIndex + 1]) return;
		const interpreter = basename(parsed[interpreterIndex] ?? "").toLowerCase();
		const script = safeRelative(cwd, parsed[interpreterIndex + 1] ?? "");
		if (!script) return;
		let scriptBytes: Buffer;
		try {
			scriptBytes = await readFile(resolve(cwd, script));
		} catch {
			return;
		}
		const parameters: Record<string, string | number | boolean | null> = {};
		for (let index = interpreterIndex + 2, parameter = 0; index < parsed.length; index++, parameter++) {
			const value = parsed[index];
			if (!value || value.startsWith("/")) continue;
			parameters[`arg${parameter}`] = scalar(value);
		}
		const codeFingerprint = createHash("sha256")
			.update(JSON.stringify({ script: createHash("sha256").update(scriptBytes).digest("hex"), parameters }))
			.digest("hex");
		const candidatePaths = [
			...stringsAt(result),
			...stringsAt(args),
			...parsed.filter((item) => OUTPUT_EXTENSIONS.has(extname(item).toLowerCase())),
		];
		const artifacts = await this.artifactsForPaths(
			cwd,
			cwd,
			candidatePaths,
			start.startedAt,
			input.toolCallId,
			script,
		);
		if (!artifacts.length) return;
		const version = await this.interpreterVersion(interpreter);
		const event: InquiryLocalExecutionEvent = {
			id: input.toolCallId,
			projectId,
			sessionId,
			toolName: "bash",
			codeFingerprint,
			parameters,
			runProvenance: {
				workflow: "local",
				modules: ["bash", interpreter],
				commandSummary: `${interpreter} ${basename(script)}`,
				environment: { interpreter, interpreterVersion: version, node: process.version },
			},
			outcome: "succeeded",
			startedAt: new Date(start.startedAt).toISOString(),
			finishedAt: new Date().toISOString(),
			artifacts,
		};
		await this.options.inquiry.recordLocalExecution(event);
		this.options.scheduleReview?.(
			sessionId,
			artifacts.map((item) => item.path),
		);
	}

	private async interpreterVersion(interpreter: string): Promise<string> {
		try {
			const result = await execFile(interpreter, ["--version"], { timeout: 1500, maxBuffer: 1000 });
			return (result.stdout || result.stderr).trim().slice(0, 120) || "unknown";
		} catch {
			return "unknown";
		}
	}

	private async artifactsForPaths(
		root: string,
		scanRoot: string,
		paths: readonly string[],
		since: number,
		sourceId: string,
		exclude?: string,
	): Promise<InquiryEventArtifact[]> {
		const names = new Set<string>();
		for (const path of paths) {
			const relativePath = safeRelative(root, path);
			if (relativePath && relativePath !== exclude) names.add(relativePath);
		}
		if (names.size === 0) await this.collectRecent(scanRoot, root, since, names);
		const artifacts: InquiryEventArtifact[] = [];
		for (const path of [...names].slice(0, MAX_FILES)) {
			try {
				const bytes = await readFile(resolve(root, path));
				if (bytes.byteLength > MAX_FILE_BYTES) continue;
				artifacts.push({
					path,
					bytes: bytes.byteLength,
					sha256: createHash("sha256").update(bytes).digest("hex"),
					sourceKind: "tool",
					sourceId,
					location: "local",
					purpose: "deliverable",
				});
			} catch {
				/* A command may mention a path without producing it. */
			}
		}
		return artifacts;
	}

	private async collectRecent(
		directory: string,
		root: string,
		since: number,
		names: Set<string>,
		depth = 0,
	): Promise<void> {
		if (depth > 3 || names.size >= MAX_FILES) return;
		let entries: import("node:fs").Dirent[] = [];
		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (names.size >= MAX_FILES || entry.name === ".git" || entry.name === "node_modules") continue;
			const absolute = resolve(directory, entry.name);
			if (entry.isDirectory()) {
				await this.collectRecent(absolute, root, since, names, depth + 1);
				continue;
			}
			try {
				const info = await stat(absolute);
				if (info.mtimeMs >= since - 1000 && OUTPUT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
					const relativePath = safeRelative(root, absolute);
					if (relativePath) names.add(relativePath);
				}
			} catch {
				/* file disappeared */
			}
		}
	}
}
