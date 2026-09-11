import { randomUUID } from "node:crypto";
import type { AskRequest, AskResponse } from "@percho/shared";

export type AskRequestSender = (request: AskRequest) => boolean;

export class AskGate {
	private sessionId = "";
	private readonly pending = new Map<string, { resolve: (response: AskResponse) => void; cleanup: () => void }>();

	constructor(private readonly send: AskRequestSender) {}

	bindSession(sessionId: string): void { this.sessionId = sessionId; }

	ask(input: Omit<AskRequest, "id" | "sessionId">, signal?: AbortSignal): Promise<AskResponse> {
		if (!this.sessionId) throw new Error("Ask UI is not bound to a session");
		const id = randomUUID();
		return new Promise<AskResponse>((resolve) => {
			const finish = (response: AskResponse) => {
				const item = this.pending.get(id);
				if (!item) return;
				this.pending.delete(id);
				item.cleanup();
				resolve(response);
			};
			const onAbort = () => finish({ kind: "cancel" });
			const cleanup = () => signal?.removeEventListener("abort", onAbort);
			this.pending.set(id, { resolve: finish, cleanup });
			if (signal?.aborted) return finish({ kind: "cancel" });
			signal?.addEventListener("abort", onAbort, { once: true });
			if (!this.send({ id, sessionId: this.sessionId, ...input })) finish({ kind: "cancel" });
		});
	}

	respond(requestId: string, response: AskResponse): boolean {
		const pending = this.pending.get(requestId);
		if (!pending) return false;
		pending.resolve(response);
		return true;
	}

	dispose(): void {
		for (const pending of [...this.pending.values()]) pending.resolve({ kind: "cancel" });
		this.pending.clear();
	}
}
