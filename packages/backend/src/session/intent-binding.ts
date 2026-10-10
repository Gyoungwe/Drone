import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { createLogger } from "../log";
import { ToolManifest } from "../tools/manifest";
import { createIntentObserver, intentJournalPath, ToolIntentJournal } from "./intent-journal";

const log = createLogger("intent-journal");

/** 为一个会话挂上工具意图日志；没有会话文件（内存会话）时返回空操作。 */
export function bindToolIntentJournal(
	session: Pick<AgentSession, "sessionFile" | "sessionId"> &
		Partial<Pick<AgentSession, "getAllTools" | "getToolDefinition">>,
	manifest?: Pick<ToolManifest, "replayPolicy">,
): (event: { type: string }) => void {
	const file = session.sessionFile;
	if (!file) return () => {};
	const tools = manifest ?? new ToolManifest(session);
	return createIntentObserver(
		new ToolIntentJournal(intentJournalPath(file)),
		(name) => tools.replayPolicy(name),
		(error) => log.error("tool intent journal write failed", session.sessionId, { error: String(error) }),
	);
}
