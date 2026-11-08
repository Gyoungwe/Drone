type DecisionHandler = (event: unknown) => void;

/** Fans agent decision records out to the host's journals; journaling is observational. */
export class DecisionFanout {
	private readonly handlers = new Set<DecisionHandler>();

	on(handler: DecisionHandler): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	/** A record that names no project belongs to `fallbackProjectId`. */
	publish(event: unknown, fallbackProjectId: string | undefined): void {
		for (const handler of this.handlers) {
			try {
				const value = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
				const projectId =
					typeof value.projectId === "string" && value.projectId.trim() ? value.projectId : fallbackProjectId;
				handler({ ...value, ...(projectId ? { projectId } : {}) });
			} catch {
				// Decision journaling is observational and must not interrupt a session.
			}
		}
	}
}
