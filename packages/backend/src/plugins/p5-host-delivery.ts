import type {
	HostFactDeliveryBinding,
	HostFactDeliveryHandle,
	HostFactDeliveryLifecycle,
	HostFactDeliveryOwner,
} from "@gyoungwe/plugin-api/p5-inquiry";
import type { Code, Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { type createP5FactStore, P5FactStoreError } from "./p5-facts";

/** Composition retains this exact identity; switch/disable/reinstall/revocation abort its signal before release. */
export interface P5ActiveFactOwner extends Scope {
	readonly owner: HostFactDeliveryOwner;
	readonly signal: AbortSignal;
}
export interface P5HostDeliveryOptions {
	readonly facts: Pick<ReturnType<typeof createP5FactStore>, "read">;
	currentOwner(): P5ActiveFactOwner | undefined;
	/** Read the owner's committed projection cursor; this module persists no second ledger. */
	cursorOf(attachment: P5ActiveFactOwner): Promise<string | null>;
	/** Current S, including adopted root and writer authority, supplied only by the host. */
	authorize(attachment: P5ActiveFactOwner): Promise<boolean>;
	/** Observe journal changes without activating a provider or accepting fact payloads. */
	subscribe(attachment: P5ActiveFactOwner, changed: () => void): () => void;
}
class DeliveryError extends Error {
	constructor(readonly code: Code) {
		super(code);
	}
}

class Binding implements HostFactDeliveryBinding {
	// Only this host module mints the opaque brand; origin lookup also requires object identity.
	readonly handle = Object.freeze({}) as HostFactDeliveryHandle;
	readonly cancellation = new AbortController();
	private cursor: string | null | undefined;
	private pending = Promise.resolve();
	private error: DeliveryError | undefined;
	private unsubscribeSource: (() => void) | undefined;
	stopped = false;
	constructor(
		readonly options: P5HostDeliveryOptions,
		readonly attachment: P5ActiveFactOwner,
	) {
		try {
			this.unsubscribeSource = options.subscribe(attachment, this.wake);
		} catch {
			throw new DeliveryError("PROVIDER_UNAVAILABLE");
		}
		attachment.signal.addEventListener("abort", this.unsubscribe, { once: true });
		this.wake();
	}
	live(): boolean {
		if (!this.stopped && !this.attachment.signal.aborted && this.options.currentOwner() === this.attachment)
			return true;
		this.unsubscribe();
		return false;
	}
	unsubscribe = (): void => {
		if (this.stopped) return;
		this.stopped = true;
		this.attachment.signal.removeEventListener("abort", this.unsubscribe);
		try {
			this.unsubscribeSource?.();
		} catch {
			this.error = new DeliveryError("CLEANUP_FAILED");
		}
		this.cancellation.abort();
	};
	wake = (): void => {
		if (!this.live()) return;
		this.pending = this.pending
			.then(() => this.flush())
			.catch((error: unknown) => {
				// Surface the failure through drain without leaking plugin or filesystem diagnostics.
				this.error =
					error instanceof DeliveryError
						? error
						: new DeliveryError(error instanceof P5FactStoreError ? error.code : "OUTCOME_UNKNOWN");
				this.unsubscribe();
			});
	};
	private async flush(): Promise<void> {
		if (!this.live()) return;
		if (this.cursor === undefined) this.cursor = await this.options.cursorOf(this.attachment);
		const { workspaceId, sessionId } = this.attachment;
		while (this.live()) {
			const batch = await this.options.facts.read(
				{ workspaceId, sessionId },
				{ after: this.cursor, limit: 64 },
			);
			if (!this.live() || batch.facts.length === 0) return;
			const approved = await this.options.authorize(this.attachment);
			if (!this.live() || !approved) return;
			const acknowledgement = await this.attachment.owner.deliver({
				...structuredClone(batch),
				handle: this.handle,
			});
			if (!this.live()) return;
			const index = batch.facts.findIndex((fact) => fact.id === acknowledgement.cursor);
			if (index === -1) throw new DeliveryError("INVALID_INPUT");
			this.cursor = acknowledgement.cursor;
			// A partial acknowledgement can indicate a gap; wait for another host notification.
			if (index !== batch.facts.length - 1 || batch.facts.length < 64) return;
		}
	}
	async drain(): Promise<void> {
		let pending: Promise<void>;
		do {
			pending = this.pending;
			await pending;
		} while (pending !== this.pending);
		if (this.error) throw this.error;
	}
}

/** No JSON/IPC/native-provider entry point: composition supplies all identity and authorization. */
export function createP5HostDelivery(options: P5HostDeliveryOptions): HostFactDeliveryLifecycle & {
	originOf(
		handle: HostFactDeliveryHandle,
	): { readonly attachment: P5ActiveFactOwner; readonly signal: AbortSignal } | undefined;
} {
	let binding: Binding | undefined;
	return {
		bind(owner) {
			const attachment = options.currentOwner();
			if (!attachment || attachment.owner !== owner || attachment.signal.aborted)
				throw new DeliveryError("SCOPE_CHANGED");
			if (binding) throw new DeliveryError("STATE_CONFLICT");
			const current = new Binding(options, attachment);
			binding = current;
			return {
				unsubscribe: current.unsubscribe,
				drain: async () => {
					await current.drain();
					if (current.stopped && binding === current) binding = undefined;
				},
			};
		},
		originOf(handle) {
			if (!binding || binding.handle !== handle || !binding.live()) return undefined;
			return { attachment: binding.attachment, signal: binding.cancellation.signal };
		},
	};
}
