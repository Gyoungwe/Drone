// packages/research/src/run-provenance.ts
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
var queues = /* @__PURE__ */ new Map();
var digest = (value) => createHash("sha256").update(value).digest("hex");
var defaultWorkspaceConfig = async (cwd) => ({
  resultsRoot: resolve(cwd, "results")
});
function within(root, path) {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
async function runPath(cwd, runDir, loadConfig) {
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
async function readObservations(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) {
      throw new Error("Invalid observation file");
    }
    const data = JSON.parse(await readFile(path, "utf8"));
    if (data.version !== 1 || !Array.isArray(data.records) || data.records.length > 256 || data.records.some(
      (record) => !record || typeof record.toolCallId !== "string"
    )) {
      throw new Error("Invalid observation records");
    }
    return data.records;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return [];
    throw error;
  }
}
async function atomic(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2));
  await rename(temp, path);
}
function isNodeError(error, code) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
async function observeExecutionReceipt({
  cwd,
  runDir,
  toolCallId,
  toolName,
  sessionId = null,
  args = {},
  details = {},
  isError = false,
  observedAt,
  loadWorkspaceConfig = defaultWorkspaceConfig
}) {
  if (!["bash", "powershell"].includes(toolName) || !toolCallId) return null;
  const run = await runPath(cwd, runDir, loadWorkspaceConfig);
  const file = join(run, "execution-observations.json");
  const work = (queues.get(file) || Promise.resolve()).catch(() => {
  }).then(async () => {
    let records = [];
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
      observedAt: observedAt || (/* @__PURE__ */ new Date()).toISOString(),
      cwd,
      commandSha256: digest(String(args.command || args.cmd || "")),
      commandLocation: "original-session-tool-call",
      resultDetailsSha256: digest(JSON.stringify(details)),
      outcome: isError ? "failed-or-blocked" : "tool-returned",
      exitCode: Number.isInteger(code) ? Number(code) : null,
      executionConfirmed: !isError && Number.isInteger(code),
      qcVerified: false
    });
    await atomic(file, { version: 1, records: records.slice(-256), scientificallyVerified: false });
  });
  queues.set(file, work);
  void work.finally(() => {
    if (queues.get(file) === work) queues.delete(file);
  }).catch(() => {
  });
  return work.then(() => void 0);
}
async function recordRunProvenance({
  cwd = process.cwd(),
  runDir,
  files = [],
  declarations = {},
  loadWorkspaceConfig = defaultWorkspaceConfig
}) {
  const run = await runPath(cwd, runDir, loadWorkspaceConfig);
  const root = await realpath(cwd);
  if (!Array.isArray(files) || files.length > 64) throw new Error("At most 64 explicitly selected files");
  const snapshots = [];
  for (const item of files) {
    if (!item || typeof item.path !== "string" || !["input", "output", "script", "log"].includes(item.role)) {
      throw new Error("Invalid file declaration");
    }
    const path2 = await realpath(resolve(root, item.path));
    if (!within(root, path2) || /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|auth\.json|credentials(?:\.json)?|\.ssh|\.git)(?:[\\/]|$)/i.test(
      path2
    )) {
      throw new Error("File outside permitted project snapshot scope");
    }
    const before = await stat(path2);
    if (!before.isFile() || before.size > 128 * 1024 * 1024) throw new Error("Not a bounded regular file");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path2)) hash.update(chunk);
    const after = await stat(path2);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error("File changed while hashing");
    }
    snapshots.push({
      path: relative(root, path2),
      role: item.role,
      bytes: after.size,
      sha256: hash.digest("hex"),
      snapshotAt: (/* @__PURE__ */ new Date()).toISOString(),
      basis: "current-file-snapshot-not-execution-time-proof"
    });
  }
  let records = [];
  const log = join(run, "execution-observations.json");
  await queues.get(log);
  try {
    records = await readObservations(log);
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
  const declared = JSON.stringify(declarations);
  if (declared.length > 16e3) throw new Error("Declarations too large");
  const value = {
    version: 1,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
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
      "Software versions, parameters and seeds in declarations are not automatically verified; tool success is not QC."
    ]
  };
  const path = join(run, "reproducibility-manifest.json");
  await atomic(path, value);
  return { path, ...value };
}
export {
  observeExecutionReceipt,
  recordRunProvenance
};
