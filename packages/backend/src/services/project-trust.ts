import type { TrustAnswer, TrustRequest } from "@drone/shared";
import { TrustGate, type TrustOptionInternal } from "../project/trust";
import { getAgentDir, ProjectTrustStore } from "../session-engine/engine";

/**
 * Host-owned project trust boundary.
 *
 * The store and the interactive gate share one lifecycle because both are
 * required by project resource loading. Keeping them here lets hosts consume
 * project trust without constructing a second gate (which would duplicate
 * pending prompts or write to a different trust store).
 */
export class ProjectTrustService {
	readonly store: ProjectTrustStore;
	private readonly gate: TrustGate;

	constructor(options: { agentDir?: string; onRequest: (request: TrustRequest) => void }) {
		this.store = new ProjectTrustStore(options.agentDir ?? getAgentDir());
		this.gate = new TrustGate(options.onRequest);
	}

	ask(cwd: string, options: TrustOptionInternal[]): Promise<number | undefined> {
		return this.gate.ask(cwd, options);
	}

	respond(requestId: string, answer: TrustAnswer): void {
		this.gate.respond(requestId, answer);
	}

	dispose(): void {
		this.gate.dispose();
	}
}
