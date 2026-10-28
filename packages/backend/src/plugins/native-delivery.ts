import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import type { RawMessage } from "../session/messages";
import type { HostExportInput, HostExportProjection } from "../session-engine/sdk";
import type { PluginRuntimeSource } from "./coordinator";
import { neutralDeliveryMessage, projectDeliveryEvent } from "./delivery-projection";
import type { ManagedNativeSession } from "./runtime";

export type SelectedNativeSource =
	| {
			readonly kind: "managed";
			readonly source: PluginRuntimeSource;
			readonly state: "enabled" | "unavailable" | "disabled";
	  }
	| { readonly kind: "ordinary" }
	| { readonly kind: "unconfirmed" };

interface Attachment {
	readonly source: PluginRuntimeSource;
	readonly projection: NonNullable<ManagedNativeSession["hostProjection"]>;
	readonly finalize: (event: unknown, signal: AbortSignal) => Promise<unknown>;
	readonly current: () => boolean;
}
type RunPolicy =
	| { readonly kind: "ordinary" }
	| { readonly kind: "closed" }
	| { readonly kind: "required"; readonly attachment: Attachment };

interface DeliveryEvent {
	readonly type: string;
	readonly message: object;
}
const projectedEventSchema = Type.Object({
	message: Type.Object({ role: Type.Literal("assistant"), content: Type.Array(Type.Unknown()) }),
});
const snapshotSchema = Type.Array(Type.Object({ role: Type.String() }));
const identity = (source: PluginRuntimeSource) => `${source.pluginId}\0${source.packageRoot}`;

/** Host-only delivery authority for one actual SDK session; no input can self-report a source or run. */
export class NativeSessionDelivery {
	private readonly selected = new Map<string, SelectedNativeSource>();
	private readonly attachments = new Set<Attachment>();
	private readonly runs = new WeakMap<AbortSignal, RunPolicy>();
	private readonly finalized = new WeakSet<object>();
	private readonly pending = new Set<Promise<unknown>>();
	private selectionConfirmed = false;
	private currentRun: RunPolicy | undefined;
	private readonly delivered = new WeakMap<object, { attachment: Attachment; fingerprint: string }>();
	private closed = false;

	constructor(
		private readonly classify: (path: string) => SelectedNativeSource,
		private readonly sameSource: (a: PluginRuntimeSource, b: PluginRuntimeSource) => boolean,
		private readonly currentSources: () => readonly {
			readonly source: PluginRuntimeSource;
			readonly state: "enabled" | "unavailable" | "disabled";
		}[],
	) {}

	/** A failed or incomplete actual loader reload can never reuse the previous selection receipt. */
	invalidateSelection(): void {
		this.selectionConfirmed = false;
	}

	/** Runs before any selected path is resolved or loaded, including paths that subsequently fail. */
	observeSelectedPath(path: string): SelectedNativeSource {
		if (this.closed) throw new Error("Native session delivery is closed");
		this.invalidateSelection();
		const selected = this.classify(path);
		this.selected.set(path, selected);
		return selected;
	}

	/** Only the actual ResourceLoader's complete effective selection/errors receipt may call this. */
	confirmSelection(paths: readonly string[]): void {
		if (this.closed) throw new Error("Native session delivery is closed");
		this.selected.clear();
		for (const path of paths) this.selected.set(path, this.classify(path));
		this.selectionConfirmed = true;
	}

	attach(
		source: PluginRuntimeSource,
		session: ManagedNativeSession,
		current: () => boolean,
	): (() => void) | undefined {
		const projection = session.hostProjection;
		if (!projection?.finalize) return undefined;
		const attachment = { source, projection, finalize: projection.finalize.bind(projection), current };
		this.attachments.add(attachment);
		return () => this.attachments.delete(attachment);
	}

	/** Called synchronously by the SDK at the actual agent_start, before every extension hook. */
	start(signal: AbortSignal): undefined {
		this.currentRun = this.policy();
		this.runs.set(signal, this.currentRun);
		return undefined;
	}

	private policy(): RunPolicy {
		if (this.closed || !this.selectionConfirmed) return { kind: "closed" };
		const required = new Map<string, PluginRuntimeSource>();
		for (const [path, selected] of this.selected) {
			const current = this.classify(path);
			if (selected.kind === "unconfirmed" || current.kind === "unconfirmed") return { kind: "closed" };
			if (selected.kind === "ordinary") {
				if (current.kind !== "ordinary") return { kind: "closed" };
				continue;
			}
			if (current.kind !== "managed" || !this.sameSource(selected.source, current.source))
				return { kind: "closed" };
			if (current.state === "disabled") continue;
			if (selected.source.deliveryProjection !== "required") continue;
			if (current.state !== "enabled" || !selected.source.contentHash) return { kind: "closed" };
			const previous = required.get(identity(selected.source));
			if (previous && !this.sameSource(previous, selected.source)) return { kind: "closed" };
			required.set(identity(selected.source), selected.source);
		}
		if (!required.size) return { kind: "ordinary" };
		if (required.size !== 1) return { kind: "closed" };
		for (const source of required.values()) {
			const [attachment, ...others] = [...this.attachments].filter(
				(value) => this.sameSource(source, value.source) && value.current(),
			);
			return attachment && !others.length ? { kind: "required", attachment } : { kind: "closed" };
		}
		return { kind: "closed" };
	}

	private available(attachment: Attachment): boolean {
		const source = this.currentSources().find(
			(value) => identity(value.source) === identity(attachment.source),
		);
		return (
			!this.closed &&
			this.attachments.has(attachment) &&
			attachment.current() &&
			source?.state === "enabled" &&
			this.sameSource(attachment.source, source.source)
		);
	}

	private assertCurrent(attachment: Attachment, signal?: AbortSignal): void {
		signal?.throwIfAborted();
		if (!this.available(attachment)) throw new Error("Native delivery source was revoked");
	}

	/** The SDK awaits this after all real hooks and before public delivery or durable append. */
	finalize(event: DeliveryEvent, signal: AbortSignal): Promise<undefined | false> {
		return this.track(this.finish(event, signal));
	}

	private track<T>(pending: Promise<T>): Promise<T> {
		this.pending.add(pending);
		void pending.then(
			() => this.pending.delete(pending),
			() => this.pending.delete(pending),
		);
		return pending;
	}

	private async finish(event: DeliveryEvent, signal: AbortSignal): Promise<undefined | false> {
		const policy = this.runs.get(signal);
		if (policy?.kind === "ordinary") return false;
		if (policy?.kind !== "required") throw new Error("Native delivery policy is unavailable");
		if (this.finalized.has(event.message)) throw new Error("Native delivery already finalized this message");
		this.finalized.add(event.message);
		const { attachment } = policy;
		this.assertCurrent(attachment, signal);
		const result = await attachment.finalize(event, signal);
		this.assertCurrent(attachment, signal);
		// The second call performs the publication judgment in the same owner that created its proof.
		const projected = await attachment.projection.event(result, signal);
		this.assertCurrent(attachment, signal);
		if (!Check(projectedEventSchema, projected)) throw new Error("Invalid native delivery projection");
		const output = projected as Static<typeof projectedEventSchema>;
		const message = event.message as Record<string, unknown>;
		for (const key of Object.keys(message)) delete message[key];
		Object.assign(event.message, output.message);
		this.delivered.set(event.message, { attachment, fingerprint: JSON.stringify(event.message) });
		return undefined;
	}

	/** Synchronous fanout uses only the exact SDK object already judged by its live owner. */
	projectEvent<T extends { type: string }>(event: T): T | null {
		if (!this.closed && (this.currentRun ?? this.policy()).kind === "ordinary") return event;
		return projectDeliveryEvent(event, (message, starting) => {
			const receipt = this.delivered.get(message);
			return !starting &&
				receipt &&
				this.available(receipt.attachment) &&
				receipt.fingerprint === JSON.stringify(message)
				? message
				: neutralDeliveryMessage(message, starting);
		});
	}

	/** Historical aliases are supplied only by the host's actual SDK current-branch origin reader. */
	snapshot(messages: RawMessage[], historical: RawMessage[], signal?: AbortSignal): Promise<RawMessage[]> {
		return this.track(this.projectSnapshot(messages, historical, signal));
	}

	private async projectSnapshot(
		messages: RawMessage[],
		historical: RawMessage[],
		signal?: AbortSignal,
	): Promise<RawMessage[]> {
		const policy = this.policy();
		if (policy.kind === "ordinary") return messages;
		if (policy.kind !== "required") return messages.map((message) => neutralDeliveryMessage(message));
		const { attachment } = policy;
		this.assertCurrent(attachment, signal);
		const result = await attachment.projection.snapshot(messages, historical, signal);
		this.assertCurrent(attachment, signal);
		if (
			!Check(snapshotSchema, result) ||
			result.length !== messages.length ||
			result.some((message, index) => message.role !== messages[index]!.role)
		)
			throw new Error("Invalid native snapshot projection");
		return result as RawMessage[];
	}

	isOrdinaryForExport(): boolean {
		return this.policy().kind === "ordinary" && this.pending.size === 0;
	}

	/** Only the actual SDK supplies these entry objects and current-branch identity associations. */
	exportProjection(input: HostExportInput): Promise<HostExportProjection> {
		return this.track(this.projectExport(input));
	}

	private async projectExport({ entries, origins }: HostExportInput): Promise<HostExportProjection> {
		const policy = this.policy();
		if (policy.kind === "closed") throw new Error("Native export source authority is unavailable");
		const assertCurrent = () => {
			if (policy.kind === "required") this.assertCurrent(policy.attachment);
			else if (this.policy().kind !== "ordinary") throw new Error("Native export selection changed");
		};
		assertCurrent();
		if (policy.kind === "ordinary") return { messages: new Map(), assertCurrent };
		const messageEntries = entries.filter(
			(entry): entry is Extract<(typeof entries)[number], { type: "message" }> => entry.type === "message",
		);
		const historical: RawMessage[] = [];
		const raw = messageEntries.map((entry) => {
			const origin = origins.find((value) => value.entry === entry);
			if (origin && JSON.stringify(origin.message) === JSON.stringify(entry.message)) {
				historical.push(origin.message as RawMessage);
				return origin.message as RawMessage;
			}
			return neutralDeliveryMessage(entry.message as RawMessage);
		});
		const output = await this.snapshot(raw, historical);
		assertCurrent();
		const messages: HostExportProjection["messages"] = new Map(
			messageEntries.map((entry, index) => [entry, output[index] as (typeof entry)["message"]]),
		);
		return { messages, assertCurrent };
	}

	/** Call only after the actual SDK abort has settled; a failed owner is never silently reopened. */
	async dispose(): Promise<void> {
		this.closed = true;
		const results = await Promise.allSettled([...this.pending]);
		this.attachments.clear();
		const failures = results.filter((result) => result.status === "rejected");
		if (failures.length)
			throw new AggregateError(
				failures.map((result) => result.reason),
				"Native delivery cleanup failed",
			);
	}
}
