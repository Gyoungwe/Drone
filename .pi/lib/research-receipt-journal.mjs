import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { loadWorkspaceConfig } from "../extensions/workspace-config.mjs";
import {
	flushResearchReceipts,
	observeResearchReceipt,
	resetResearchReceipts,
	updateResearchLoop,
} from "./research-loop.mjs";
import { observeExecutionReceipt } from "./run-provenance.mjs";
import { toolMeta } from "./tool-manifest.mjs";

const owners = new Map();
// 核心执行 / 联网原语固定记账；扩展工具经 drone.journal 声明加入（挂钩 1）。
const CORE_TOOLS = new Set(["bash", "powershell", "webfetch", "fetch_content", "web_search"]);
const TOOLS = { has: (name) => CORE_TOOLS.has(name) || toolMeta(name)?.journal === true };

// One journal per host session/agent turn. Never exposed as model tool parameters.
export function createResearchReceiptJournal(cwd, { sessionId = null } = {}) {
	const owner = Symbol("research-turn");
	const belongsTo = (receipt, runDir) => {
		const ownedRun = receipt.args?.run_dir || receipt.details?.run_dir;
		return !ownedRun || resolve(cwd, ownedRun) === resolve(cwd, runDir);
	};
	let active = true,
		tail = Promise.resolve(),
		currentRun;
	const receipts = [],
		runs = new Set(),
		seen = new Set();
	let evicted = 0;
	const serial = (work) => {
		const next = tail.catch(() => {}).then(() => (active ? work() : null));
		tail = next;
		return next;
	};
	const attach = async (runDir) => {
		if (!runDir) return;
		const status = await updateResearchLoop({ cwd, runDir, action: "status" });
		const path = status.run_dir;
		if (owners.has(path) && owners.get(path) !== owner)
			throw new Error("Research run is owned by another active session/turn; create a separate run");
		if (!runs.has(path)) {
			owners.set(path, owner);
			await flushResearchReceipts({ cwd, runDir: path });
			resetResearchReceipts({ cwd, runDir: path });
			runs.add(path);
			for (const receipt of receipts) {
				// Archive/deposit receipts with a run owner cannot migrate to another run.
				if (!belongsTo(receipt, path)) continue;
				await observeExecutionReceipt({ ...receipt, cwd, runDir: path });
				await observeResearchReceipt({ ...receipt, cwd, runDir: path });
			}
		}
		currentRun = path;
	};
	return {
		currentRun: () => currentRun,
		record(event) {
			if (
				!active ||
				(event.isError && !["bash", "powershell"].includes(event.toolName)) ||
				!TOOLS.has(event.toolName)
			)
				return Promise.resolve(null);
			// Start snapshot capture now, not when a later run replays the receipt.
			const snapshot =
				event.toolName === "research_read_knowledge"
					? loadWorkspaceConfig(cwd)
							.then(async (config) => ({
								vault: config.obsidianVault ? await realpath(config.obsidianVault) : null,
								revision: config.knowledgeBindingRevision || 0,
							}))
							.catch(() => ({ vault: null, revision: -1 }))
					: Promise.resolve(undefined);
			const receipt = { ...structuredClone(event), sessionId, observedAt: new Date().toISOString() };
			return serial(async () => {
				if (receipt.toolCallId && seen.has(receipt.toolCallId)) return null;
				if (receipt.toolCallId) seen.add(receipt.toolCallId);
				receipt.readBinding = await snapshot;
				if (receipts.length >= 256) {
					receipts.shift();
					evicted++;
				}
				receipts.push(receipt);
				if (currentRun && belongsTo(receipt, currentRun)) {
					await observeExecutionReceipt({ ...receipt, cwd, runDir: currentRun });
					return observeResearchReceipt({ ...receipt, cwd, runDir: currentRun });
				}
				return null;
			});
		},
		execute(runDir, work) {
			return serial(async () => {
				if (runDir) await attach(runDir);
				const result = await work();
				if (result.run_dir) await attach(result.run_dir);
				const refreshed = result.run_dir
					? await updateResearchLoop({ cwd, runDir: result.run_dir, action: "status" })
					: result;
				return {
					...result,
					...refreshed,
					receipt_journal: { scope: "current-session-current-turn", buffered: receipts.length, evicted },
				};
			});
		},
		async close() {
			active = false;
			await tail.catch(() => {});
			for (const runDir of runs) {
				await flushResearchReceipts({ cwd, runDir });
				if (owners.get(runDir) === owner) {
					resetResearchReceipts({ cwd, runDir });
					owners.delete(runDir);
				}
			}
			runs.clear();
			receipts.length = 0;
			seen.clear();
		},
	};
}
