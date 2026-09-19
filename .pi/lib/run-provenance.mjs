import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadWorkspaceConfig } from "../extensions/workspace-config.mjs";

const queues = new Map();
const digest = (v) => createHash("sha256").update(v).digest("hex");
const within = (root, path) => {
	const r = relative(root, path);
	return r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r);
};
async function runPath(cwd, runDir) {
	const config = await loadWorkspaceConfig(cwd),
		root = await realpath(config.resultsRoot),
		run = await realpath(resolve(cwd, runDir || ""));
	const parts = relative(root, run).split(sep);
	if (!within(root, run) || parts.length !== 2 || !parts[1].startsWith("run-"))
		throw new Error("Expected existing run inside results root");
	await readFile(join(run, "metadata.json"), "utf8");
	return run;
}
async function readObservations(path) {
	try {
		const info = await lstat(path);
		if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024)
			throw new Error("Invalid observation file");
		const data = JSON.parse(await readFile(path, "utf8"));
		if (
			data.version !== 1 ||
			!Array.isArray(data.records) ||
			data.records.length > 256 ||
			data.records.some((r) => !r || typeof r.toolCallId !== "string")
		)
			throw new Error("Invalid observation records");
		return data.records;
	} catch (e) {
		if (e.code === "ENOENT") return [];
		throw e;
	}
}
async function atomic(path, value) {
	const tmp = `${path}.${randomUUID()}.tmp`;
	await writeFile(tmp, JSON.stringify(value, null, 2));
	await rename(tmp, path);
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
}) {
	if (!["bash", "powershell"].includes(toolName) || !toolCallId) return null;
	const run = await runPath(cwd, runDir),
		file = join(run, "execution-observations.json");
	const work = (queues.get(file) || Promise.resolve())
		.catch(() => {})
		.then(async () => {
			let records = [];
			try {
				records = await readObservations(file);
			} catch (e) {
				if (e.code !== "ENOENT") throw e;
			}
			if (records.some((r) => r.toolCallId === toolCallId)) return;
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
				exitCode: Number.isInteger(code) ? code : null,
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
	return work;
}
/** File hashes are observed now, not retroactively claimed to be execution-time inputs. */
export async function recordRunProvenance({ cwd = process.cwd(), runDir, files = [], declarations = {} }) {
	const run = await runPath(cwd, runDir),
		root = await realpath(cwd);
	if (!Array.isArray(files) || files.length > 64) throw new Error("At most 64 explicitly selected files");
	const snapshots = [];
	for (const item of files) {
		if (!item || typeof item.path !== "string" || !["input", "output", "script", "log"].includes(item.role))
			throw new Error("Invalid file declaration");
		const path = await realpath(resolve(root, item.path));
		if (
			!within(root, path) ||
			/(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|auth\.json|credentials(?:\.json)?|\.ssh|\.git)(?:[\\/]|$)/i.test(
				path,
			)
		)
			throw new Error("File outside permitted project snapshot scope");
		const before = await stat(path);
		if (!before.isFile() || before.size > 128 * 1024 * 1024) throw new Error("Not a bounded regular file");
		const hash = createHash("sha256");
		for await (const chunk of createReadStream(path)) hash.update(chunk);
		const after = await stat(path);
		if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
			throw new Error("File changed while hashing");
		snapshots.push({
			path: relative(root, path),
			role: item.role,
			bytes: after.size,
			sha256: hash.digest("hex"),
			snapshotAt: new Date().toISOString(),
			basis: "current-file-snapshot-not-execution-time-proof",
		});
	}
	let records = [];
	const log = join(run, "execution-observations.json");
	await queues.get(log);
	try {
		records = await readObservations(log);
	} catch (e) {
		if (e.code !== "ENOENT") throw e;
	}
	const declared = JSON.stringify(declarations);
	if (declared.length > 16000) throw new Error("Declarations too large");
	const value = {
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
