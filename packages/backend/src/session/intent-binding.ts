import type { CausalContext, CausalEnvelope } from "@drone/shared";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { rootCausalEnvelope } from "../causality";
import { createLogger } from "../log";
import { ToolManifest } from "../tools/manifest";
import { createIntentObserver, intentJournalPath, ToolIntentJournal } from "./intent-journal";

const log = createLogger("intent-journal");

export interface SessionCausalityContext {
	readonly current: () => CausalEnvelope | undefined;
	readonly observe: (event: { type: string }) => void;
}

/** One auditable attempt per ordinary agent run; no execution permission is inferred from it. */
export function createSessionCausalityContext(): SessionCausalityContext {
	let active: CausalEnvelope | undefined;
	return {
		current: () => active,
		observe: (event) => {
			if (event.type === "agent_start") active = rootCausalEnvelope();
			if (event.type === "agent_end" || event.type === "agent_settled") active = undefined;
		},
	};
}

/** 为一个会话挂上工具意图日志；没有会话文件（内存会话）时返回空操作。 */
export function bindToolIntentJournal(
	session: Pick<AgentSession, "sessionFile" | "sessionId"> &
		Partial<Pick<AgentSession, "getAllTools" | "getToolDefinition">>,
	manifest?: Pick<ToolManifest, "replayPolicy">,
	causality?: CausalContext | CausalEnvelope | (() => CausalContext | CausalEnvelope | undefined),
): (event: { type: string }) => void {
	const file = session.sessionFile;
	if (!file) return () => {};
	const tools = manifest ?? new ToolManifest(session);
	return createIntentObserver(
		new ToolIntentJournal(intentJournalPath(file), Date.now, causality),
		(name) => tools.replayPolicy(name),
		(error) => log.error("tool intent journal write failed", session.sessionId, { error: String(error) }),
	);
}
