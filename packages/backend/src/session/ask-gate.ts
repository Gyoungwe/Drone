import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { AskRequest, AskResolved, AskResponse } from "@drone/shared";

export type AskRequestSender = (request: AskRequest) => boolean;

export interface AskQuestionRoute {
	readonly ownerId: number;
	send(request: AskRequest): boolean;
	resolved(result: AskResolved): void;
}
export class AskGate {
	private readonly routes = new AsyncLocalStorage<AskQuestionRoute>();
	withRoute<T>(route: AskQuestionRoute, execute: () => Promise<T>): Promise<T> {
		return this.routes.run(route, execute);
	}

	private sessionId = "";
	private readonly pending = new Map<
		string,
		{ resolve: (response: AskResponse) => void; cleanup: () => void; ownerId?: number }
	>();

	constructor(private readonly send: AskRequestSender) {}

	bindSession(sessionId: string): void {
		this.sessionId = sessionId;
	}

	ask(input: Omit<AskRequest, "id" | "sessionId">, signal?: AbortSignal): Promise<AskResponse> {
		if (!this.sessionId) throw new Error("Ask UI is not bound to a session");
		const id = randomUUID();
		const route = this.routes.getStore();
		return new Promise<AskResponse>((resolve) => {
			const finish = (response: AskResponse) => {
				const item = this.pending.get(id);
				if (!item) return;
				this.pending.delete(id);
				item.cleanup();
				resolve(response);
				route?.resolved({ sessionId: this.sessionId, requestId: id });
			};
			const onAbort = () => finish({ kind: "cancel" });
			const cleanup = () => signal?.removeEventListener("abort", onAbort);
			this.pending.set(id, { resolve: finish, cleanup, ownerId: route?.ownerId });
			if (signal?.aborted) return finish({ kind: "cancel" });
			signal?.addEventListener("abort", onAbort, { once: true });
			const request = { id, sessionId: this.sessionId, ...input };
			if (!(route ? route.send(request) : this.send(request))) finish({ kind: "cancel" });
		});
	}

	respond(requestId: string, response: AskResponse, ownerId?: number): boolean {
		const pending = this.pending.get(requestId);
		if (!pending || (pending.ownerId !== undefined && pending.ownerId !== ownerId)) return false;
		// Defer resolve so the IPC reply can return before the agent continues
		// (next ui.select / ask must not land while the previous dialog is still sending).
		setImmediate(() => pending.resolve(response));
		return true;
	}

	dispose(): void {
		for (const pending of [...this.pending.values()]) pending.resolve({ kind: "cancel" });
		this.pending.clear();
	}
}
