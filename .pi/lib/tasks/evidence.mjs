import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { clean, inspectTaskFile } from "./workbench.mjs";

/** Persist only source/version/window locators. Full contents remain subject to normal evaporation. */
export function createEvidenceRecovery({ authorize, persist = () => {} }) {
	let scope = null,
		taskId = null,
		records = [],
		used = 0;
	const save = () => persist({ version: 1, scope, taskId, records, used });
	return {
		scope: () => scope,
		attach(nextScope, nextTaskId, entries = [], force = false) {
			if (!force && scope === nextScope && taskId === nextTaskId) return;
			scope = nextScope;
			taskId = nextTaskId;
			records = [];
			used = 0;
			for (const e of entries)
				if (
					e.customType === "drone-task-evidence-v1" &&
					e.data?.scope === scope &&
					e.data.taskId === taskId &&
					Array.isArray(e.data.records) &&
					e.data.records.length <= 8
				) {
					records = structuredClone(e.data.records);
					used = Number(e.data.used) || 0;
				}
		},
		async capture(event, cwd, binding) {
			if (!taskId || typeof event.input?.path !== "string" || records.some((r) => r.id === event.toolCallId))
				return;
			try {
				const file = await inspectTaskFile(cwd, event.input.path);
				const offset = Math.max(1, Math.floor(event.input.offset || event.input.start_line || 1));
				const limit = Math.min(120, Math.max(1, Math.floor(event.input.limit || 120)));
				records.push({
					id: clean(event.toolCallId, 100),
					path: file.path,
					sha256: file.sha256,
					offset,
					limit,
					binding,
					evicted: false,
				});
				records = records.slice(-8);
				save();
			} catch {
				/* Private/outside/large files never enter this cache. */
			}
		},
		evict(ids) {
			if (!Array.isArray(ids)) return;
			let changed = false;
			for (const r of records)
				if (ids.includes(r.id)) {
					r.evicted = true;
					changed = true;
				}
			if (changed) save();
		},
		async restore(input, cwd, bindingProvider) {
			const record = records.find((r) => r.id === input.receiptId);
			if (!record?.evicted || used >= 2 || input.path !== record.path)
				throw new Error(
					"recovery-unavailable: only recorded evicted windows, twice per task; normal read budget remains active.",
				);
			const binding = await bindingProvider();
			if (binding !== record.binding) throw new Error("recovery-binding-changed");
			await authorize(cwd, record.path);
			await inspectTaskFile(cwd, record.path, { sha256: record.sha256 });
			const text = (await readFile(resolve(cwd, record.path), "utf8"))
				.split(/\r?\n/)
				.slice(record.offset - 1, record.offset - 1 + record.limit)
				.join("\n")
				.slice(0, 16000);
			// Re-check after read to avoid returning a body under a stale version label.
			await inspectTaskFile(cwd, record.path, { sha256: record.sha256 });
			used++;
			record.evicted = false;
			save();
			return {
				status: "restored",
				path: record.path,
				sha256: record.sha256,
				offset: record.offset,
				limit: record.limit,
				text,
				scientificallyVerified: false,
				remaining: 2 - used,
			};
		},
	};
}
