import type { PermissionAnswer, PermissionRequest, PermissionResolved } from "@drone/shared";
import { PermissionGate, type PermissionRequestMeta } from "../permissions/gate";

/** A permission decision that may be persisted by the host after the gate opens. */
export interface ApprovalDecision {
	sessionId: string;
	requestId: string;
	answer: PermissionAnswer;
	title: string;
	meta?: PermissionRequestMeta;
}

export interface ApprovalServiceOptions {
	/** Called after a durable allowDir/allowAlways decision has released the gate. */
	onDecision?: (decision: ApprovalDecision) => void;
}

type PermissionRequestHandler = (request: PermissionRequest) => void;
type PermissionResolvedHandler = (result: PermissionResolved) => void;

/**
 * Host-owned permission approval registry.
 *
 * The service owns the per-session gates and the request/resolution event
 * fan-out.  PiBackend keeps its historical methods as compatibility delegates,
 * while desktop, LAN and future hosts can consume the same registry through
 * BackendServices without constructing or discovering gates themselves.
 */
export class ApprovalService {
	private readonly gates = new Map<string, PermissionGate>();
	private readonly requestHandlers = new Set<PermissionRequestHandler>();
	private readonly resolvedHandlers = new Set<PermissionResolvedHandler>();

	constructor(private readonly options: ApprovalServiceOptions = {}) {}

	/** Create a gate whose requests are published through this service. */
	createGate(): PermissionGate {
		return new PermissionGate((request) => this.dispatchRequest(request));
	}

	/** Register the gate after the SDK session has received its definitive id. */
	register(sessionId: string, gate: PermissionGate): void {
		this.gates.set(sessionId, gate);
	}

	/** Dispose and remove one session's pending approvals. */
	remove(sessionId: string): void {
		const gate = this.gates.get(sessionId);
		if (!gate) return;
		gate.dispose();
		this.gates.delete(sessionId);
	}

	/** Read all pending requests for host observers and remote control. */
	listPending(): PermissionRequest[] {
		return [...this.gates.values()].flatMap((gate) => gate.listPending());
	}

	/** Internal session bridge used by the subagent panel while it migrates off the façade. */
	getGate(sessionId: string): PermissionGate | undefined {
		return this.gates.get(sessionId);
	}

	onRequest(handler: PermissionRequestHandler): () => void {
		this.requestHandlers.add(handler);
		return () => this.requestHandlers.delete(handler);
	}

	onResolved(handler: PermissionResolvedHandler): () => void {
		this.resolvedHandlers.add(handler);
		return () => this.resolvedHandlers.delete(handler);
	}

	/**
	 * Resolve one pending approval while preserving the historical answer
	 * semantics, including allowRun draining all queued requests in that gate.
	 */
	respond(requestId: string, answer: PermissionAnswer): string | undefined {
		if (answer === "allowDir" || answer === "allowAlways") {
			for (const gate of this.gates.values()) {
				const request = gate.getRequest(requestId);
				if (!request) continue;
				gate.respond(requestId, answer);
				this.dispatchResolved({
					sessionId: gate.getSessionId(),
					requestId,
					answered: true,
				});
				this.options.onDecision?.({
					sessionId: gate.getSessionId(),
					requestId,
					answer,
					title: request.title,
					meta: request.meta,
				});
				return gate.getSessionId();
			}
			return undefined;
		}

		for (const gate of this.gates.values()) {
			if (!gate.getRequest(requestId)) continue;
			const drained = answer === "allowRun" ? gate.listPending().map((request) => request.id) : [requestId];
			gate.respond(requestId, answer);
			for (const id of drained) {
				this.dispatchResolved({
					sessionId: gate.getSessionId(),
					requestId: id,
					answered: true,
				});
			}
			return gate.getSessionId();
		}
		return undefined;
	}

	dispose(): void {
		for (const gate of this.gates.values()) gate.dispose();
		this.gates.clear();
		this.requestHandlers.clear();
		this.resolvedHandlers.clear();
	}

	private dispatchRequest(request: PermissionRequest): void {
		for (const handler of this.requestHandlers) {
			try {
				handler(request);
			} catch {
				// One host observer must not block the permission gate.
			}
		}
	}

	private dispatchResolved(result: PermissionResolved): void {
		for (const handler of this.resolvedHandlers) {
			try {
				handler(result);
			} catch {
				// One host observer must not block other observers.
			}
		}
	}
}
