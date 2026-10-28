import { readFileSync } from "node:fs";
import type {
	PluginSessionRecord,
	PluginSessionRecordAppendInput,
	PluginSessionRecordReadResult,
} from "@gyoungwe/plugin-api/runtime";
import type { RegisteredSession } from "../session/registry";
import type { SessionEntry } from "./sdk";

type Durability = "durable" | "deferred";
interface RecordState {
	tail: Promise<void>;
	committed: SessionEntry[];
	fault: string | null;
}
const namespace = (pluginId: string) => `plugin-record:${encodeURIComponent(pluginId)}:`;

/** One instance per backend. A reload retains the same registered SDK identity and its failure fence. */
export class SessionRecordStore {
	private readonly states = new WeakMap<RegisteredSession, RecordState>();

	private state(entry: RegisteredSession): RecordState {
		let state = this.states.get(entry);
		if (!state) {
			state = { tail: Promise.resolve(), committed: [], fault: null };
			this.states.set(entry, state);
		}
		return state;
	}

	private run<T>(entry: RegisteredSession, execute: (state: RecordState) => Promise<T>): Promise<T> {
		const state = this.state(entry);
		const result = state.tail.then(() => execute(state));
		// The returned result carries the failure. The scheduling tail must still drain later reads.
		state.tail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private fault(state: RecordState, error: unknown): Error {
		state.fault = error instanceof Error ? error.message : String(error);
		return new Error(`Session records need disk reopen: ${state.fault}`, { cause: error });
	}

	/** Pi 1.1.0 appends to memory before writing. Validate its public JSONL boundary, without opening/creating it. */
	private inspect(entry: RegisteredSession, state: RecordState): Durability {
		const manager = entry.session.sessionManager;
		const branch = manager.getBranch();
		const file = manager.getSessionFile();
		if (!file) return "deferred";
		let content: string;
		try {
			content = readFileSync(file, "utf8");
		} catch (error) {
			if (
				(error as NodeJS.ErrnoException).code === "ENOENT" &&
				!branch.some((item) => item.type === "message" && ["user", "assistant"].includes(item.message.role))
			)
				return "deferred";
			throw error;
		}
		const rows: Map<string, unknown> = new Map();
		for (const line of content.split("\n").filter((value) => value.length)) {
			const row: unknown = JSON.parse(line);
			if (!row || typeof row !== "object" || !("id" in row) || typeof row.id !== "string")
				throw new Error("Invalid SDK session JSONL entry");
			rows.set(row.id, row);
		}
		const header = rows.get(manager.getSessionId());
		if (!header || !("type" in (header as object)) || (header as { type: unknown }).type !== "session")
			throw new Error("SDK session file identity mismatch");
		const committed: SessionEntry[] = [];
		for (const item of branch) {
			if (JSON.stringify(rows.get(item.id)) !== JSON.stringify(item)) {
				state.committed = structuredClone(committed);
				throw new Error(`SDK branch entry is not persisted: ${item.id}`);
			}
			if (item.type === "custom") committed.push(item);
		}
		state.committed = structuredClone(committed);
		return "durable";
	}

	private records(entries: readonly SessionEntry[], pluginId: string): PluginSessionRecord[] {
		const prefix = namespace(pluginId),
			latest = new Map<string, PluginSessionRecord>();
		for (const entry of entries) {
			if (entry.type === "custom" && entry.customType.startsWith(prefix)) {
				const type = entry.customType.slice(prefix.length);
				latest.set(type, { id: entry.id, type, data: entry.data });
			}
		}
		return structuredClone([...latest.values()]);
	}

	read(
		entry: RegisteredSession,
		pluginId: string,
		check: () => void,
	): Promise<PluginSessionRecordReadResult> {
		return this.run(entry, async (state) => {
			check();
			let durability: Durability = "durable";
			if (!state.fault) {
				try {
					durability = this.inspect(entry, state);
				} catch (error) {
					this.fault(state, error);
				}
			}
			return {
				state: state.fault ? "needs-reopen" : durability,
				error: state.fault,
				records: this.records(
					state.fault || durability === "durable"
						? state.committed
						: entry.session.sessionManager.getBranch(),
					pluginId,
				),
			};
		});
	}

	append(
		entry: RegisteredSession,
		pluginId: string,
		input: PluginSessionRecordAppendInput,
		check: () => void,
	) {
		return this.write(entry, check, async () => ({
			id: entry.session.sessionManager.appendCustomEntry(
				namespace(pluginId) + input.type,
				structuredClone(input.data),
			),
		}));
	}

	notify(entry: RegisteredSession, pluginId: string, content: string, check: () => void) {
		return this.write(
			entry,
			check,
			async () => {
				await entry.session.sendCustomMessage(
					{ customType: `plugin-notice:${encodeURIComponent(pluginId)}`, content, display: true },
					{ triggerTurn: false },
				);
				return {};
			},
			() => {
				if (entry.session.isStreaming) throw new Error("Session notification requires an idle session");
			},
		);
	}

	private write<T>(
		entry: RegisteredSession,
		check: () => void,
		execute: () => Promise<T>,
		beforeWrite?: () => void,
	) {
		return this.run(entry, async (state) => {
			check();
			if (state.fault) throw new Error(`Session records need disk reopen: ${state.fault}`);
			beforeWrite?.();
			try {
				this.inspect(entry, state);
				const result = await execute();
				check();
				return { ...result, durability: this.inspect(entry, state) };
			} catch (error) {
				throw this.fault(state, error);
			}
		});
	}
}
