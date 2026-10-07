import { resolveWorkspaceProject, type SessionContextLike, sessionEntriesOf } from "./project-identity";

/** Tool result envelope shared by knowledge extension adapters. */
export interface KnowledgeToolResult<T = unknown> {
	content: Array<{ type: "text"; text: string }>;
	details: T;
}

/** JSON-safe result envelope for a knowledge tool. */
export function result<T>(data: T): KnowledgeToolResult<T> {
	return {
		content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
		details: data,
	};
}

/**
 * Resolve the knowledge project for a tool call or turn through the shared resolver
 * (`project-identity.ts`): the daily-space session choice, then the workspace's configured
 * `knowledgeProjectId`, then the stable directory-derived identity.
 */
export async function currentProject(cwd: string, ctx?: SessionContextLike | null): Promise<string> {
	return (await resolveWorkspaceProject({ cwd, sessionEntries: sessionEntriesOf(ctx) })).project;
}

/** Normalise a stable explainer topic id, dropping generated timestamp suffixes. */
export function explainerTopicId(value: unknown, title = "research-topic"): string {
	const base = String(value || title)
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[-_]20\d{6,14}$/, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 96);
	return base || "research-topic";
}

export interface SessionIdentityContext {
	sessionManager?: { getSessionId?: () => string | null | undefined };
	sessionId?: string | null;
}

/** Prefer the host session manager, with the event context as a compatibility fallback. */
export function sessionIdentity(ctx: SessionIdentityContext | null | undefined): string | null {
	return ctx?.sessionManager?.getSessionId?.() || ctx?.sessionId || null;
}

/** Whether a prompt contains a signal that it continues the previous topic. */
export function continuationHint(value: unknown): boolean {
	return /(?:previous|prior|last|earlier|continue|resume|what about|how about|why|then|it|that|those|之前|上个|继续|刚才|它|那个|那它|为什么|怎么|如何|还有|然后)/i.test(
		String(value || ""),
	);
}

export interface TopicForContinuation {
	id?: unknown;
	title?: unknown;
	aliases?: readonly unknown[];
	entities?: readonly unknown[];
}

/** Decide whether a prompt continues a topic using explicit switches and topic terms. */
export function continuesTopic(prompt: unknown, topic: TopicForContinuation | null | undefined): boolean {
	if (!topic) return false;
	const text = String(prompt || "").trim();
	if (!text) return true;
	if (/(?:switch|new topic|different topic|换个|另一个|新的主题|切换主题)/i.test(text)) return false;
	if (continuationHint(text)) return true;
	const lower = text.toLowerCase();
	return [topic.id, topic.title, ...(topic.aliases || []), ...(topic.entities || [])]
		.filter((value): value is string => typeof value === "string" && value.trim().length >= 2)
		.some((value) => lower.includes(value.toLowerCase()));
}
