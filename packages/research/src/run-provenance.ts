import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export interface WorkspaceConfig {
	resultsRoot: string;
}

export type WorkspaceConfigLoader = (cwd: string) => Promise<WorkspaceConfig>;

export interface ExecutionReceiptInput {
	cwd: string;
	runDir: string;
	toolCallId: string;
	toolName: string;
	sessionId?: string | null;
	args?: Record<string, unknown>;
	details?: Record<string, unknown>;
	isError?: boolean;
	observedAt?: string;
	loadWorkspaceConfig?: WorkspaceConfigLoader;
}

export interface ProvenanceFileDeclaration {
	path: string;
	role: "input" | "output" | "script" | "log";
}

export interface RunProvenanceInput {
	cwd?: string;
	runDir: string;
	files?: ProvenanceFileDeclaration[];
	declarations?: Record<string, unknown>;
	loadWorkspaceConfig?: WorkspaceConfigLoader;
}

const queues = new Map<string, Promise<void>>();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const defaultWorkspaceConfig: WorkspaceConfigLoader = async (cwd) => ({
	resultsRoot: resolve(cwd, "results"),
});

function within(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function runPath(cwd: string, runDir: string, loadConfig: WorkspaceConfigLoader): Promise<string> {
	const config = await loadConfig(cwd);
	const root = await realpath(config.resultsRoot);
	const run = await realpath(resolve(cwd, runDir || ""));
	const parts = relative(root, run).split(sep);
	if (!within(root, run) || parts.length !== 2 || !parts[1]?.startsWith("run-")) {
		throw new Error("Expected existing run inside results root");
	}
	await readFile(join(run, "metadata.json"), "utf8");
	return run;
}

async function readObservations(path: string): Promise<ObservationRecord[]> {
	try {
		const info = await lstat(path);
		if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) {
			throw new Error("Invalid observation file");
		}
		const data = JSON.parse(await readFile(path, "utf8")) as {
			version?: unknown;
			records?: unknown;
		};
		if (
			data.version !== 1 ||
			!Array.isArray(data.records) ||
			data.records.length > 256 ||
			data.records.some(
				(record) => !record || typeof (record as { toolCallId?: unknown }).toolCallId !== "string",
			)
		) {
			throw new Error("Invalid observation records");
		}
		return data.records as ObservationRecord[];
	} catch (error) {
		if (isNodeError(error, "ENOENT")) return [];
		throw error;
	}
}

async function atomic(path: string, value: unknown): Promise<void> {
	const temp = `${path}.${randomUUID()}.tmp`;
	await writeFile(temp, JSON.stringify(value, null, 2));
	await rename(temp, path);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
	return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

interface ObservationRecord {
	toolCallId: string;
	toolName: string;
	sessionId: string | null;
	observedAt: string;
	cwd: string;
	commandSha256: string;
	commandLocation: "original-session-tool-call";
	resultDetailsSha256: string;
	outcome: "failed-or-blocked" | "tool-returned";
	exitCode: number | null;
	executionConfirmed: boolean;
	qcVerified: false;
}

/** Called only from actual host tool-end events. No raw commands/output (may contain credentials). */
export async function observeExecutionReceipt({
	cwd,
	runDir,
	toolCallId,
	toolName,
	sessionId = null,
	args = {},
	details = {},
	isError = false,
	observedAt,
	loadWorkspaceConfig = defaultWorkspaceConfig,
}: ExecutionReceiptInput): Promise<null | undefined> {
	if (!["bash", "powershell"].includes(toolName) || !toolCallId) return null;
	const run = await runPath(cwd, runDir, loadWorkspaceConfig);
	const file = join(run, "execution-observations.json");
	const work = (queues.get(file) || Promise.resolve())
		.catch(() => {})
		.then(async () => {
			let records: ObservationRecord[] = [];
			try {
				records = await readObservations(file);
			} catch (error) {
				if (!isNodeError(error, "ENOENT")) throw error;
			}
			if (records.some((record) => record.toolCallId === toolCallId)) return;
			const code = details.exitCode ?? details.exit_code;
			records.push({
				toolCallId,
				toolName,
				sessionId,
				observedAt: observedAt || new Date().toISOString(),
				cwd,
				commandSha256: digest(String(args.command || args.cmd || "")),
				commandLocation: "original-session-tool-call",
				resultDetailsSha256: digest(JSON.stringify(details)),
				outcome: isError ? "failed-or-blocked" : "tool-returned",
				exitCode: Number.isInteger(code) ? Number(code) : null,
				executionConfirmed: !isError && Number.isInteger(code),
				qcVerified: false,
			});
			await atomic(file, { version: 1, records: records.slice(-256), scientificallyVerified: false });
		});
	queues.set(file, work);
	void work
		.finally(() => {
			if (queues.get(file) === work) queues.delete(file);
		})
		.catch(() => {});
	return work.then(() => undefined);
}

/** File hashes are observed now, not retroactively claimed to be execution-time inputs. */
export async function recordRunProvenance({
	cwd = process.cwd(),
	runDir,
	files = [],
	declarations = {},
	loadWorkspaceConfig = defaultWorkspaceConfig,
}: RunProvenanceInput): Promise<RunProvenanceResult> {
	const run = await runPath(cwd, runDir, loadWorkspaceConfig);
	const root = await realpath(cwd);
	if (!Array.isArray(files) || files.length > 64) throw new Error("At most 64 explicitly selected files");
	const snapshots: ProvenanceSnapshot[] = [];
	for (const item of files) {
		if (!item || typeof item.path !== "string" || !["input", "output", "script", "log"].includes(item.role)) {
			throw new Error("Invalid file declaration");
		}
		const path = await realpath(resolve(root, item.path));
		if (
			!within(root, path) ||
			/(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|auth\.json|credentials(?:\.json)?|\.ssh|\.git)(?:[\\/]|$)/i.test(
				path,
			)
		) {
			throw new Error("File outside permitted project snapshot scope");
		}
		const before = await stat(path);
		if (!before.isFile() || before.size > 128 * 1024 * 1024) throw new Error("Not a bounded regular file");
		const hash = createHash("sha256");
		for await (const chunk of createReadStream(path)) hash.update(chunk);
		const after = await stat(path);
		if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
			throw new Error("File changed while hashing");
		}
		snapshots.push({
			path: relative(root, path),
			role: item.role,
			bytes: after.size,
			sha256: hash.digest("hex"),
			snapshotAt: new Date().toISOString(),
			basis: "current-file-snapshot-not-execution-time-proof",
		});
	}
	let records: ObservationRecord[] = [];
	const log = join(run, "execution-observations.json");
	await queues.get(log);
	try {
		records = await readObservations(log);
	} catch (error) {
		if (!isNodeError(error, "ENOENT")) throw error;
	}
	const declared = JSON.stringify(declarations);
	if (declared.length > 16000) throw new Error("Declarations too large");
	const value: RunProvenanceManifest = {
		version: 1,
		createdAt: new Date().toISOString(),
		runDir: run,
		hostRuntime: { node: process.version, platform: process.platform, arch: process.arch },
		files: snapshots,
		executionObservations: records,
		declarations,
		declaredSoftwareVersionsVerified: false,
		qcVerified: false,
		scientificallyVerified: false,
		executionStatus: records.length ? "tool-observations-present" : "no-execution-observed",
		limitations: [
			"Local observation files are not cryptographically attested; independently check the referenced session trace.",
			"Command text stays in the original session tool call; this manifest contains its digest, not credentials.",
			"File snapshots are post-hoc unless separately collected before execution.",
			"Software versions, parameters and seeds in declarations are not automatically verified; tool success is not QC.",
		],
	};
	const path = join(run, "reproducibility-manifest.json");
	await atomic(path, value);
	return { path, ...value };
}

export interface ProvenanceSnapshot {
	path: string;
	role: ProvenanceFileDeclaration["role"];
	bytes: number;
	sha256: string;
	snapshotAt: string;
	basis: "current-file-snapshot-not-execution-time-proof";
}

export interface RunProvenanceManifest {
	version: 1;
	createdAt: string;
	runDir: string;
	hostRuntime: { node: string; platform: string; arch: string };
	files: ProvenanceSnapshot[];
	executionObservations: ObservationRecord[];
	declarations: Record<string, unknown>;
	declaredSoftwareVersionsVerified: false;
	qcVerified: false;
	scientificallyVerified: false;
	executionStatus: "tool-observations-present" | "no-execution-observed";
	limitations: string[];
}

export interface RunProvenanceResult extends RunProvenanceManifest {
	path: string;
}

export interface MethodsFacts {
	runDir: string;
	query: string | null;
	status: string | null;
	startedAt: string | null;
	finalizedAt: string | null;
	hostRuntime: RunProvenanceManifest["hostRuntime"] | null;
	inputs: { path: string; sha256: string }[];
	outputs: { path: string; sha256: string }[];
	scripts: { path: string; sha256: string }[];
	/** 模型/用户在 research_record_run_manifest 里声明的软件版本、参数、种子、计算模块（未经独立验证） */
	declarations: Record<string, unknown>;
	commandsObserved: number;
	commandsFailed: number;
	existingMethods: string | null;
	gaps: string[];
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
	try {
		const value: unknown = JSON.parse(await readFile(path, "utf8"));
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch (error) {
		if (isNodeError(error, "ENOENT")) return null;
		throw error;
	}
}

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

/**
 * 从运行目录收集写 Methods 段需要的事实：运行时间、输入/输出/脚本快照、声明的软件版本与参数、
 * 命令执行回执计数。缺失项列在 gaps 里，模型不得自行补全版本号或参数。
 */
export async function readMethodsFacts({
	cwd = process.cwd(),
	runDir,
	loadWorkspaceConfig = defaultWorkspaceConfig,
}: {
	cwd?: string;
	runDir: string;
	loadWorkspaceConfig?: WorkspaceConfigLoader;
}): Promise<MethodsFacts> {
	const run = await runPath(cwd, runDir, loadWorkspaceConfig);
	const metadata = (await readJson(join(run, "metadata.json"))) ?? {};
	const manifest = (await readJson(
		join(run, "reproducibility-manifest.json"),
	)) as Partial<RunProvenanceManifest> | null;
	const files = Array.isArray(manifest?.files) ? manifest.files : [];
	const pick = (role: ProvenanceFileDeclaration["role"]) =>
		files.filter((file) => file.role === role).map((file) => ({ path: file.path, sha256: file.sha256 }));
	const observations = Array.isArray(manifest?.executionObservations) ? manifest.executionObservations : [];
	const declarations =
		manifest?.declarations && typeof manifest.declarations === "object" ? manifest.declarations : {};
	let existingMethods: string | null = null;
	try {
		existingMethods = await readFile(join(run, "METHODS.md"), "utf8");
	} catch (error) {
		if (!isNodeError(error, "ENOENT")) throw error;
	}
	const gaps: string[] = [];
	if (!manifest)
		gaps.push(
			"No reproducibility manifest: call research_record_run_manifest with inputs, outputs, scripts and declarations first.",
		);
	if (!Object.keys(declarations).length)
		gaps.push(
			"No declared software versions or parameters; ask the user or check with bio_environment before stating any.",
		);
	if (!pick("input").length) gaps.push("No input files recorded.");
	if (!observations.length) gaps.push("No executed commands were observed for this run.");
	return {
		runDir: relative(await realpath(cwd), run) || run,
		query: text(metadata.query),
		status: text(metadata.status),
		startedAt: text(metadata.started_at),
		finalizedAt: text(metadata.finalized_at),
		hostRuntime: manifest?.hostRuntime ?? null,
		inputs: pick("input"),
		outputs: pick("output"),
		scripts: pick("script"),
		declarations,
		commandsObserved: observations.length,
		commandsFailed: observations.filter((record) => record.outcome === "failed-or-blocked").length,
		existingMethods,
		gaps,
	};
}

/** 写入用户已确认的 Methods 段（METHODS.md，原子替换）；确认由调用方负责 */
export async function saveMethodsSection({
	cwd = process.cwd(),
	runDir,
	text: body,
	approvedAt = new Date().toISOString(),
	loadWorkspaceConfig = defaultWorkspaceConfig,
}: {
	cwd?: string;
	runDir: string;
	text: string;
	approvedAt?: string;
	loadWorkspaceConfig?: WorkspaceConfigLoader;
}): Promise<{ path: string; bytes: number }> {
	const content = String(body ?? "").trim();
	if (!content) throw new Error("Methods text is empty");
	if (content.length > 20_000) throw new Error("Methods text is longer than 20,000 characters");
	const run = await runPath(cwd, runDir, loadWorkspaceConfig);
	const path = join(run, "METHODS.md");
	const document = `<!-- drone:methods approved_at=${approvedAt} — reviewed by the user; software versions are as declared in reproducibility-manifest.json -->\n\n${content}\n`;
	const temp = `${path}.${randomUUID()}.tmp`;
	await writeFile(temp, document, "utf8");
	await rename(temp, path);
	return { path, bytes: Buffer.byteLength(document) };
}
