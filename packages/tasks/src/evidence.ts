import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Bounded recovery of a host-observed file window.
 *
 * The task package owns the state machine and persistence shape. File scope,
 * hashing and authorization stay host-owned through the injected inspector
 * and authorizer, so this module does not depend on the `.pi` runtime.
 */

export interface EvidenceEvent {
	toolCallId?: unknown;
	input?: { path?: unknown; offset?: unknown; start_line?: unknown; limit?: unknown } | null;
}

export interface EvidenceInspectResult {
	path: string;
	sha256: string;
	rootKind?: "workspace" | "vault" | "research-run";
	absolutePath?: string;
}

export type EvidenceInspector = (
	cwd: string,
	input: string,
	expected?: { sha256?: string; rootKind?: "workspace" | "vault" | "research-run" },
) => Promise<EvidenceInspectResult>;

export interface EvidenceRecord {
	id: string;
	path: string;
	sha256: string;
	rootKind?: "workspace" | "vault" | "research-run";
	absolutePath?: string;
	offset: number;
	limit: number;
	binding: unknown;
	evicted: boolean;
}

export interface EvidenceEntry {
	customType?: unknown;
	data?: {
		scope?: unknown;
		taskId?: unknown;
		records?: unknown;
		used?: unknown;
	};
}

export interface EvidenceRecoveryOptions {
	authorize: (cwd: string, path: string) => Promise<void> | void;
	inspectTaskFile: EvidenceInspector;
	persist?: (value: EvidenceSnapshot) => void;
}

export interface EvidenceSnapshot {
	version: 1;
	scope: unknown;
	taskId: unknown;
	records: EvidenceRecord[];
	used: number;
}

export interface EvidenceRestoreInput {
	receiptId?: unknown;
	path?: unknown;
}

export interface EvidenceRestoreResult {
	status: "restored";
	path: string;
	sha256: string;
	offset: number;
	limit: number;
	text: string;
	scientificallyVerified: false;
	remaining: number;
}

const clean = (value: unknown, max = 100): string =>
	String(value ?? "")
		.replace(/(?:bearer\s+|(?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, "[redacted]")
		.split("")
		.map((character) =>
			character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || "<>".includes(character)
				? " "
				: character,
		)
		.join("")
		.slice(0, max);

const inputValue = (event: EvidenceEvent, key: "path" | "offset" | "start_line" | "limit"): unknown =>
	event.input && typeof event.input === "object" ? event.input[key] : undefined;

/**
 * Create a small, durable cache of file identities and line windows.
 * Cached bodies are never persisted; every restore re-authorizes and hashes
 * the file before and after reading it.
 */
export function createEvidenceRecovery({
	authorize,
	inspectTaskFile,
	persist = () => {},
}: EvidenceRecoveryOptions) {
	let scope: unknown = null;
	let taskId: unknown = null;
	let records: EvidenceRecord[] = [];
	let used = 0;
	const save = () => persist({ version: 1, scope, taskId, records, used });
	return {
		scope: () => scope,
		attach(nextScope: unknown, nextTaskId: unknown, entries: EvidenceEntry[] = [], force = false) {
			if (!force && scope === nextScope && taskId === nextTaskId) return;
			scope = nextScope;
			taskId = nextTaskId;
			records = [];
			used = 0;
			for (const entry of entries)
				if (
					entry.customType === "drone-task-evidence-v1" &&
					entry.data &&
					entry.data.scope === scope &&
					entry.data.taskId === taskId &&
					Array.isArray(entry.data.records) &&
					entry.data.records.length <= 8
				) {
					records = structuredClone(entry.data.records) as EvidenceRecord[];
					used = Number(entry.data.used) || 0;
				}
		},
		async capture(event: EvidenceEvent, cwd: string, binding: unknown) {
			const path = inputValue(event, "path");
			if (!taskId || typeof path !== "string" || records.some((record) => record.id === event.toolCallId))
				return;
			try {
				const file = await inspectTaskFile(cwd, path);
				const offset = Math.max(
					1,
					Math.floor(Number(inputValue(event, "offset") || inputValue(event, "start_line") || 1)),
				);
				const limit = Math.min(120, Math.max(1, Math.floor(Number(inputValue(event, "limit") || 120))));
				records.push({
					id: clean(event.toolCallId),
					path: file.path,
					sha256: file.sha256,
					...(file.rootKind ? { rootKind: file.rootKind } : {}),
					...(file.absolutePath ? { absolutePath: file.absolutePath } : {}),
					offset,
					limit,
					binding,
					evicted: false,
				});
				records = records.slice(-8);
				save();
			} catch {
				/* Private, outside-workspace or oversized files never enter this cache. */
			}
		},
		evict(ids: unknown) {
			if (!Array.isArray(ids)) return;
			let changed = false;
			for (const record of records)
				if (ids.includes(record.id)) {
					record.evicted = true;
					changed = true;
				}
			if (changed) save();
		},
		async restore(
			input: EvidenceRestoreInput,
			cwd: string,
			bindingProvider: () => Promise<unknown> | unknown,
		): Promise<EvidenceRestoreResult> {
			const record = records.find((candidate) => candidate.id === input.receiptId);
			if (!record?.evicted || used >= 2 || input.path !== record.path)
				throw new Error(
					"recovery-unavailable: only recorded evicted windows, twice per task; normal read budget remains active.",
				);
			const binding = await bindingProvider();
			if (binding !== record.binding) throw new Error("recovery-binding-changed");
			await authorize(cwd, record.path);
			await inspectTaskFile(cwd, record.absolutePath || record.path, {
				sha256: record.sha256,
				rootKind: record.rootKind,
			});
			const text = (await readFile(record.absolutePath || resolve(cwd, record.path), "utf8"))
				.split(/\r?\n/)
				.slice(record.offset - 1, record.offset - 1 + record.limit)
				.join("\n")
				.slice(0, 16000);
			await inspectTaskFile(cwd, record.absolutePath || record.path, {
				sha256: record.sha256,
				rootKind: record.rootKind,
			});
			used++;
			record.evicted = false;
			save();
			return {
				status: "restored",
				path: record.path,
				sha256: record.sha256,
				...(record.rootKind ? { rootKind: record.rootKind } : {}),
				offset: record.offset,
				limit: record.limit,
				text,
				scientificallyVerified: false,
				remaining: 2 - used,
			};
		},
	};
}
