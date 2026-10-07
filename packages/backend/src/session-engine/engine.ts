import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type CreateAgentSessionOptions,
	type CreateAgentSessionResult,
	createAgentSession,
	getAgentDir,
	type LoadExtensionsResult,
	ModelRuntime,
	ProjectTrustStore,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createAntigravityProvider } from "./antigravity/provider";

/**
 * SDK boundary for session lifecycle operations.
 *
 * PiBackend remains the compatibility façade, while this class owns the
 * runtime import and construction mechanics. Keeping this boundary small lets
 * the host migrate to BackendServices without exposing the Pi SDK to callers.
 */
export class SessionEngine {
	private modelRuntime: ModelRuntime | undefined;
	private modelPromise: Promise<ModelRuntime> | undefined;

	async getModelRuntime(): Promise<ModelRuntime> {
		if (this.modelRuntime) return this.modelRuntime;
		if (!this.modelPromise) {
			this.modelPromise = ModelRuntime.create().then((runtime) => {
				runtime.registerNativeProvider(createAntigravityProvider());
				return runtime;
			});
		}
		this.modelRuntime = await this.modelPromise;
		return this.modelRuntime;
	}

	/** Session lifecycle operations stay behind the SDK boundary. */
	dispose(session: AgentSession): void {
		session.dispose();
	}

	abort(session: AgentSession): Promise<void> {
		return session.abort();
	}

	prompt(
		session: AgentSession,
		text: string,
		options?: Parameters<AgentSession["prompt"]>[1],
	): ReturnType<AgentSession["prompt"]> {
		return session.prompt(text, options);
	}

	clearQueue(session: AgentSession): ReturnType<AgentSession["clearQueue"]> {
		return session.clearQueue();
	}

	setModel(session: AgentSession, model: Parameters<AgentSession["setModel"]>[0]): Promise<void> {
		return session.setModel(model);
	}

	setThinkingLevel(session: AgentSession, level: Parameters<AgentSession["setThinkingLevel"]>[0]): void {
		session.setThinkingLevel(level);
	}

	compact(session: AgentSession, customInstructions?: string): ReturnType<AgentSession["compact"]> {
		return session.compact(customInstructions);
	}

	reload(session: AgentSession): ReturnType<AgentSession["reload"]> {
		return session.reload();
	}

	setSessionName(session: AgentSession, name: string): void {
		session.setSessionName(name);
	}

	exportHtml(session: AgentSession): ReturnType<AgentSession["exportToHtml"]> {
		return session.exportToHtml();
	}

	exportJsonl(session: AgentSession): string {
		return session.exportToJsonl();
	}

	async create(
		cwd: string,
		options: Omit<CreateAgentSessionOptions, "cwd" | "modelRuntime" | "sessionManager">,
		runtime?: ModelRuntime,
	): Promise<CreateAgentSessionResult> {
		return createAgentSession({
			cwd,
			modelRuntime: runtime ?? (await this.getModelRuntime()),
			sessionManager: SessionManager.create(cwd),
			...options,
		});
	}

	async open(
		filePath: string,
		options: Omit<CreateAgentSessionOptions, "modelRuntime" | "sessionManager"> = {},
		runtime?: ModelRuntime,
	): Promise<CreateAgentSessionResult> {
		return createAgentSession({
			modelRuntime: runtime ?? (await this.getModelRuntime()),
			sessionManager: SessionManager.open(filePath),
			...options,
		});
	}

	createManager(cwd: string): SessionManager {
		return SessionManager.create(cwd);
	}

	openManager(filePath: string, sessionDir?: string): SessionManager {
		return SessionManager.open(filePath, sessionDir);
	}

	list(cwd: string): ReturnType<typeof SessionManager.list> {
		return SessionManager.list(cwd);
	}

	listAll(): ReturnType<typeof SessionManager.listAll> {
		return SessionManager.listAll();
	}
}

export type { AgentSession, CreateAgentSessionOptions, CreateAgentSessionResult, LoadExtensionsResult };
export { getAgentDir, getSupportedThinkingLevels, ModelRuntime, ProjectTrustStore, SessionManager };
