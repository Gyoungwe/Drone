import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { DroneRuntime, ImageInput, SessionMessage, SessionMeta, TodoItem } from "@drone/shared";
import {
	extractTodos,
	formatSkillCommand,
	parseExpandedSkillInvocation,
	TODO_REMINDER_CUSTOM_TYPE,
	TODO_TOOL_NAME,
} from "@drone/shared";
import type { AgentSession, SessionEntry } from "@earendil-works/pi-coding-agent";
import { projectKnowledgeSnapshot } from "../session/knowledge-publication";
import {
	assignEntryIds,
	blockImages,
	blockText,
	type RawMessage,
	readSessionMessagesFromContent,
	resolveForkEntryId,
	resolveRecallEntryId,
	subagentPanelRawMessages,
	toSessionMessages,
} from "../session/messages";
import { isSubagentSessionPath } from "../tools/subagent";

export interface SessionMessageHost {
	runtime: DroneRuntime;
	registry: {
		get(id: string): { session: AgentSession; readOnly?: boolean } | undefined;
	};
	sessionEngine: {
		openManager(
			filePath: string,
			sessionDir?: string,
		): { createBranchedSession(entryId: string): string | undefined };
		exportHtml(session: AgentSession): Promise<string>;
		exportJsonl(session: AgentSession): string;
	};
	subagentPanel: { listRuns(id: string): Array<{ runId: string }> };
	listAllSessions: () => Promise<SessionMeta[]>;
	openSession: (path: string) => Promise<SessionMeta>;
	requireSession: (id: string) => { session: AgentSession; readOnly?: boolean };
	log: { info: (message: string, ...args: unknown[]) => void };
}

/** History projection, todo lookup, fork and recall semantics for a session. */
export class SessionMessageService {
	static readonly RECALLED_MARKER_TYPE = "message-recalled";

	constructor(private readonly host: SessionMessageHost) {}

	async exportSession(sessionId: string, format: "html" | "jsonl"): Promise<string> {
		const entry = this.host.requireSession(sessionId);
		return format === "html"
			? await this.host.sessionEngine.exportHtml(entry.session)
			: this.host.sessionEngine.exportJsonl(entry.session);
	}

	async getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
		const entry = this.host.requireSession(sessionId);
		const branch = entry.session.sessionManager.getBranch();
		const persisted = branch
			.filter((item): item is Extract<SessionEntry, { type: "message" }> => item.type === "message")
			.map((item) => item.message as RawMessage);
		const panelRecords = subagentPanelRawMessages(branch);
		const live = projectKnowledgeSnapshot(
			entry.session.messages as RawMessage[],
			persisted,
			this.host.runtime,
		);
		const merged = panelRecords.length > 0 ? mergeRawByTimestamp(live, panelRecords) : live;
		const messages = toSessionMessages(merged, {
			liveSubagentRunIds: new Set(this.host.subagentPanel.listRuns(sessionId).map((run) => run.runId)),
		});
		assignEntryIds(messages, branch);
		return messages;
	}

	async peekSubagentMessages(filePath: string): Promise<SessionMessage[]> {
		if (!isSubagentSessionPath(filePath)) throw new Error("Not a subagent session file");
		return this.projectPersistedMessages(await readFile(filePath, "utf8"));
	}

	async peekSessionMessages(sessionId: string): Promise<SessionMessage[] | null> {
		if (this.host.registry.get(sessionId)) return this.getSessionMessages(sessionId);
		const meta = (await this.host.listAllSessions()).find((item) => item.sessionId === sessionId);
		if (!meta?.sessionFile) return null;
		try {
			return this.projectPersistedMessages(await readFile(meta.sessionFile, "utf8"));
		} catch {
			return null;
		}
	}

	private projectPersistedMessages(content: string): SessionMessage[] {
		return readSessionMessagesFromContent(content, (raw) =>
			projectKnowledgeSnapshot(raw, raw, this.host.runtime),
		);
	}

	async getTodos(sessionId: string): Promise<TodoItem[]> {
		const entry = this.host.requireSession(sessionId);
		for (const raw of [...entry.session.messages].reverse()) {
			const message = raw as RawMessage;
			if (message.role === "toolResult" && message.toolName === TODO_TOOL_NAME && !message.isError) {
				const todos = extractTodos(message.details);
				if (todos) return todos;
			}
			if (message.role === "custom" && message.customType === TODO_REMINDER_CUSTOM_TYPE) {
				const todos = extractTodos(message.details);
				if (todos) return todos;
			}
		}
		return [];
	}

	async forkSession(sessionId: string, ref: { entryId?: string; text?: string }): Promise<SessionMeta> {
		const entry = this.host.requireSession(sessionId);
		if (entry.readOnly) throw new Error("Cannot fork a read-only subagent transcript");
		if (entry.session.isStreaming || entry.session.isCompacting)
			throw new Error("Cannot fork while the agent is running or context is compacting");
		const sourceManager = entry.session.sessionManager;
		const targetId = resolveForkEntryId(sourceManager, ref);
		const file = sourceManager.getSessionFile();
		if (!file || !existsSync(file))
			throw new Error("This session has not been saved yet. Send a message first.");
		const forkedManager = this.host.sessionEngine.openManager(file, sourceManager.getSessionDir());
		const newPath = forkedManager.createBranchedSession(targetId);
		if (!newPath) throw new Error("Failed to create forked session");
		this.host.log.info("fork session", sessionId, { targetId, newPath });
		return this.host.openSession(newPath);
	}

	async recallMessage(
		sessionId: string,
		ref: { entryId?: string; text?: string; timestamp?: number },
	): Promise<{ text: string; images: ImageInput[] }> {
		const entry = this.host.requireSession(sessionId);
		if (entry.readOnly) throw new Error("Cannot recall in a read-only subagent transcript");
		if (entry.session.isStreaming || entry.session.isCompacting)
			throw new Error("Cannot recall while the agent is running or context is compacting");
		const manager = entry.session.sessionManager;
		const targetId = resolveRecallEntryId(manager, ref);
		const target = manager.getEntry(targetId) as Extract<SessionEntry, { type: "message" }>;
		const message = target.message as RawMessage;
		const sourceText = blockText(message.content);
		const invocation = parseExpandedSkillInvocation(sourceText);
		const text = invocation ? formatSkillCommand(invocation) : sourceText;
		const images = blockImages(message.content);
		if (manager.getLeafId() === targetId) {
			if (target.parentId) manager.branch(target.parentId);
			else manager.resetLeaf();
			entry.session.refreshContext();
		} else {
			const result = await entry.session.navigateTree(targetId);
			if (result.cancelled) throw new Error("Recall was cancelled by an extension");
		}
		manager.appendCustomEntry(SessionMessageService.RECALLED_MARKER_TYPE, {
			recalledEntryId: targetId,
		});
		this.host.log.info("recall message", sessionId, { targetId });
		return { text, images };
	}
}

function mergeRawByTimestamp(base: RawMessage[], extra: RawMessage[]): RawMessage[] {
	const out: RawMessage[] = [];
	let i = 0;
	let j = 0;
	const sorted = [...extra].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
	while (i < base.length || j < sorted.length) {
		const a = base[i];
		const b = sorted[j];
		if (a === undefined) {
			if (b !== undefined) out.push(b);
			j++;
		} else if (b === undefined || (a.timestamp ?? 0) <= (b.timestamp ?? 0)) {
			out.push(a);
			i++;
		} else {
			out.push(b);
			j++;
		}
	}
	return out;
}
