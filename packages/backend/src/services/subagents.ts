import type {
	SubagentDispatchInput,
	SubagentDispatchReceipt,
	SubagentInfo,
	SubagentPanelRun,
	SubagentPanelSnapshot,
} from "@drone/shared";
import { discoverAgents } from "../tools/subagent";
import type { SubagentPanelService } from "../tools/subagent/panel";

/**
 * Host-facing subagent boundary.
 *
 * The panel runner remains responsible for session-scoped validation,
 * permission attribution and queueing.  This service only exposes the stable
 * operations consumed by desktop (and future hosts), so those adapters do not
 * need to reach through PiBackend for subagent state.
 */
export interface SubagentServicePort {
	listAvailable(): Promise<SubagentInfo[]>;
	listSession(sessionId: string): Promise<SubagentPanelSnapshot>;
	dispatch(sessionId: string, input: SubagentDispatchInput): Promise<SubagentDispatchReceipt>;
	abort(runId: string): Promise<boolean>;
	listRuns(sessionId: string): Promise<SubagentPanelRun[]>;
}

export class SubagentService implements SubagentServicePort {
	constructor(
		private readonly panel: SubagentPanelService,
		private readonly defaultCwd?: string,
	) {}

	/** User-visible agents for the settings picker (project agents stay hidden). */
	async listAvailable(): Promise<SubagentInfo[]> {
		const agents = await discoverAgents(this.defaultCwd ?? process.cwd(), { projectTrusted: false });
		return agents
			.filter((agent) => agent.source !== "project")
			.map(({ name, description, source }) => ({
				name,
				description,
				source: source === "builtin" ? "builtin" : "user",
			}));
	}

	listSession(sessionId: string): Promise<SubagentPanelSnapshot> {
		return this.panel.listAgents(sessionId);
	}

	dispatch(sessionId: string, input: SubagentDispatchInput): Promise<SubagentDispatchReceipt> {
		return this.panel.dispatch(sessionId, input);
	}

	abort(runId: string): Promise<boolean> {
		return Promise.resolve(this.panel.abort(runId));
	}

	listRuns(sessionId: string): Promise<SubagentPanelRun[]> {
		return Promise.resolve(this.panel.listRuns(sessionId));
	}
}
