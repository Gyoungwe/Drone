import { createHash, randomUUID } from "node:crypto";
import type {
	PluginExecutionInput,
	PluginExecutionReceipt,
	PluginExecutionReceiptResult,
	PluginExecutionResult,
} from "../runtime.js";
import type { ControlledSandboxRunner } from "./execution-types.js";

/** Filled from an actual host/SDK caller, never from a plugin's execution input. */
export interface ExecutionIdentity {
	readonly pluginId: string;
	readonly sourceIdentity: string;
	readonly applicationId: string;
	readonly sessionId: string;
	readonly workspaceId: string;
}
export interface ExecutionPrivateReceipt {
	readonly schemaVersion: 1;
	readonly identity: ExecutionIdentity;
	readonly receipt: PluginExecutionReceipt;
}
/** Actual host JsonStore and native Node adapters both implement strict CAS + readback. */
export interface ExecutionReceiptStorage {
	read(key: string): Promise<ExecutionPrivateReceipt | null>;
	write(key: string, value: ExecutionPrivateReceipt, expected: ExecutionPrivateReceipt | null): Promise<void>;
}
// Keep the lookup stable across source/application replacement so an unverifiable old request blocks replay.
export function executionOwnerKey(identity: ExecutionIdentity, requestId: string): string {
	return createHash("sha256")
		.update(JSON.stringify([identity.pluginId, identity.sessionId, identity.workspaceId, requestId]))
		.digest("hex");
}
function sameIdentity(a: ExecutionIdentity, b: ExecutionIdentity): boolean {
	return (
		a.pluginId === b.pluginId &&
		a.sourceIdentity === b.sourceIdentity &&
		a.applicationId === b.applicationId &&
		a.sessionId === b.sessionId &&
		a.workspaceId === b.workspaceId
	);
}
/** The accepted transaction retains only authority to run/clean/finalize itself, never a caller capability. */
export class ExecutionTransactions {
	private readonly pending = new Set<Promise<PluginExecutionResult>>();
	private readonly accepting = new Set<string>();
	private failure: unknown;
	private stopping = false;
	constructor(private readonly storage: ExecutionReceiptStorage) {}

	async receipt(identity: ExecutionIdentity, requestId: string): Promise<PluginExecutionReceiptResult> {
		const stored = await this.storage.read(executionOwnerKey(identity, requestId));
		if (!stored) return { kind: "missing" };
		if (
			stored.schemaVersion !== 1 ||
			!sameIdentity(stored.identity, identity) ||
			stored.receipt.requestId !== requestId
		)
			throw new Error("Execution receipt needs recovery: source, application or caller ownership changed");
		return { kind: "value", receipt: stored.receipt };
	}

	run(
		input: PluginExecutionInput,
		identity: ExecutionIdentity,
		runner: ControlledSandboxRunner,
		signal: AbortSignal,
	): Promise<PluginExecutionResult> {
		if (this.stopping) return Promise.reject(new Error("Execution owner is stopping"));
		if (this.failure)
			return Promise.reject(
				new Error("Execution owner needs recovery before accepting another run", { cause: this.failure }),
			);
		const key = executionOwnerKey(identity, input.requestId);
		if (this.accepting.has(key)) return Promise.reject(new Error("Execution request is already accepted"));
		this.accepting.add(key);
		const pending = this.execute(key, input, identity, runner, signal);
		this.pending.add(pending);
		void pending.then(
			() => this.pending.delete(pending),
			() => this.pending.delete(pending),
		);
		return pending;
	}

	private async execute(
		key: string,
		input: PluginExecutionInput,
		identity: ExecutionIdentity,
		runner: ControlledSandboxRunner,
		signal: AbortSignal,
	): Promise<PluginExecutionResult> {
		try {
			if (await this.storage.read(key))
				throw new Error(
					"Execution request already has a durable receipt; reconcile it before submitting a new request",
				);
			signal.throwIfAborted();
			const accepted: ExecutionPrivateReceipt = {
				schemaVersion: 1,
				identity: { ...identity },
				receipt: {
					id: randomUUID(),
					requestId: input.requestId,
					language: input.language,
					codeSha256: createHash("sha256").update(input.code).digest("hex"),
					runDirectory: input.runDirectory,
					image: input.image,
					status: "accepted",
					acceptedAt: new Date().toISOString(),
				},
			};
			try {
				await this.storage.write(key, accepted, null);
			} catch (error) {
				this.failure = error;
				throw error;
			}

			const [execution] = await Promise.allSettled([
				Promise.resolve().then(() => {
					signal.throwIfAborted();
					return runner.run({ ...input, signal });
				}),
			]);
			const cleanupFailed =
				execution.status === "rejected" &&
				execution.reason instanceof Error &&
				(execution.reason as Error & { code?: string }).code === "DISCOVERY_CLEANUP_FAILED";
			const terminal: ExecutionPrivateReceipt = {
				...accepted,
				receipt: {
					...accepted.receipt,
					status: cleanupFailed
						? "cleanup-failed"
						: signal.aborted
							? "cancelled"
							: execution.status === "fulfilled"
								? execution.value.exitCode === 0
									? "succeeded"
									: "failed"
								: "failed",
					finishedAt: new Date().toISOString(),
					...(execution.status === "fulfilled"
						? {
								exitCode: execution.value.exitCode,
								durationMs: execution.value.durationMs,
								producedBytes: execution.value.producedBytes,
							}
						: {}),
				},
			};
			try {
				await this.storage.write(key, terminal, accepted);
			} catch (error) {
				this.failure = error;
				throw error;
			}
			if (cleanupFailed && execution.status === "rejected") this.failure = execution.reason;
			if (execution.status === "rejected") throw execution.reason;
			signal.throwIfAborted();
			return { receipt: terminal.receipt, result: execution.value };
		} finally {
			this.accepting.delete(key);
		}
	}

	async drain(): Promise<void> {
		this.stopping = true;
		await Promise.allSettled([...this.pending]);
		if (this.failure)
			throw new Error("Execution cleanup or receipt finalization failed; owner leases must be retained", {
				cause: this.failure,
			});
	}
}
