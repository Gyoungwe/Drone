import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { contractContentHash } from "@drone/shared";
import type { BatchInput, Item } from "@gyoungwe/plugin-api/p5-discovery";
import type { FileReadback, RequestInput, Scope } from "@gyoungwe/plugin-api/p5-receipts";
import type { PluginRuntimeScope } from "@gyoungwe/plugin-api/runtime";
import { JsonStore } from "../json-store";
import type { P5BatchExecutionPort } from "../plugins/p5-batch-execution";
import {
	type FrozenP5Batch,
	freezeP5Batch,
	type ResolvedP5Plan,
	type ReviewedP5Batch,
} from "../plugins/p5-batch-review";
import type { PluginCapabilityContext } from "../plugins/runtime-capabilities";
import type { StorageEntry, StorageRegistry } from "../storage/registry";
import type { ComputeJobInput, ComputeServicePort } from "./compute";

export const P5_BATCH_INDEX_STORAGE = {
	id: "agent-p5-batch-index",
	owner: "services/p5-batch-ports",
	schema: 1,
	sensitivity: "private",
} as const satisfies Omit<StorageEntry, "path">;

/** A reviewed batch as the host owns it. It carries no authority to run. */
interface StoredBatch {
	readonly requestId: string;
	readonly scope: Scope;
	readonly request: BatchInput;
	readonly plans: readonly ResolvedP5Plan[];
	readonly sha256: string;
	readonly computeReceiptRef: string;
	readonly modelReceiptRef: string | null;
}

/** The host's reviewed plan for one reviewed compute item. */
export interface P5BatchPlan {
	/** Concrete job input; the host resolved it from the reviewed preflight record. */
	readonly job: ComputeJobInput;
	/** Reviewed outputs with their expected checksums; readback compares against these. */
	readonly expected: readonly FileReadback[];
}

export interface P5BatchIndexOptions {
	/** Host-private path; the caller owns the location, never the plugin. */
	readonly path: string;
	readonly registry: StorageRegistry;
}

export interface P5BatchIndex {
	/** Host-only write path, taken right after the host reviewed a batch. */
	record(reviewed: ReviewedP5Batch): Promise<void>;
	/** Historical lookup for status reconciliation; it never confers authority to run. */
	find(request: RequestInput, context: PluginCapabilityContext): Promise<ReviewedP5Batch | undefined>;
}

export interface P5BatchExecutionPortOptions {
	readonly compute: Pick<ComputeServicePort, "submit" | "status" | "cancel" | "collect">;
	/** Host-owned reviewed plan lookup; an absent plan means the item cannot run. */
	planOf(item: Item, batch: FrozenP5Batch): P5BatchPlan | undefined;
	/** Host-owned writable root that receives collected outputs. */
	readonly outputRoot: string;
	readonly pollIntervalMs?: number;
	readonly cleanupTimeoutMs?: number;
}

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "blocked", "partial"]);
const DEFAULT_POLL_MS = 250;
const DEFAULT_CLEANUP_MS = 30_000;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isScope(value: unknown): value is Scope {
	if (!value || typeof value !== "object") return false;
	const row = value as Record<string, unknown>;
	return (
		typeof row.workspaceId === "string" &&
		typeof row.sessionId === "string" &&
		typeof row.callerSourceHash === "string" &&
		typeof row.providerSourceHash === "string"
	);
}

function isStoredBatch(value: unknown): value is StoredBatch {
	if (!value || typeof value !== "object") return false;
	const row = value as Record<string, unknown>;
	return (
		typeof row.requestId === "string" &&
		typeof row.sha256 === "string" &&
		typeof row.computeReceiptRef === "string" &&
		(row.modelReceiptRef === null || typeof row.modelReceiptRef === "string") &&
		Array.isArray(row.plans) &&
		isScope(row.scope) &&
		!!row.request &&
		typeof row.request === "object"
	);
}

function parseIndex(text: string): StoredBatch[] {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		// Parse errors can embed source text; keep index diagnostics content-free.
		throw new Error("P5 batch index is not valid JSON");
	}
	if (!Array.isArray(value)) throw new Error("P5 batch index must be an array");
	for (const entry of value) if (!isStoredBatch(entry)) throw new Error("P5 batch index entry is invalid");
	return value;
}

function toStored(reviewed: ReviewedP5Batch): StoredBatch {
	const { batch } = reviewed;
	return {
		requestId: batch.request.requestId,
		scope: batch.scope,
		request: batch.request,
		plans: batch.plans.map(({ budget: _budget, ...plan }) => plan),
		sha256: batch.sha256,
		computeReceiptRef: reviewed.computeReceiptRef,
		modelReceiptRef: reviewed.modelReceiptRef,
	};
}

/** Rebuild the frozen batch and prove it still hashes to the reviewed identity. */
function fromStored(entry: StoredBatch): ReviewedP5Batch | undefined {
	try {
		const batch = freezeP5Batch(entry.request, entry.plans, entry.scope);
		if (batch.sha256 !== entry.sha256) return undefined;
		return Object.freeze({
			batch,
			computeReceiptRef: entry.computeReceiptRef,
			modelReceiptRef: entry.modelReceiptRef,
		});
	} catch {
		return undefined;
	}
}

function scopeMatches(scope: PluginRuntimeScope, entry: StoredBatch): boolean {
	if (scope.kind === "application") return false;
	if (scope.workspaceId !== entry.scope.workspaceId) return false;
	return scope.kind === "workspace" || scope.sessionId === entry.scope.sessionId;
}

/** The host-owned reviewed-batch index. Durable snapshots reconcile status only. */
export function createP5BatchIndex(options: P5BatchIndexOptions): P5BatchIndex {
	const entry: StorageEntry = { ...P5_BATCH_INDEX_STORAGE, path: options.path };
	if (!options.registry.get(entry.id)) options.registry.register(entry);
	if (options.registry.assertRegistered(entry.id).path !== entry.path)
		throw new Error("P5 batch index storage registration does not match the ledger");
	const json = new JsonStore<StoredBatch[]>({
		path: entry.path,
		storageId: "agent-p5-batch-index",
		defaultValue: () => [],
		parse: parseIndex,
		mode: 0o600,
	});
	return {
		async record(reviewed) {
			const stored = toStored(reviewed);
			await json.update((draft) => {
				const kept = draft.filter(
					(entry) =>
						!(entry.requestId === stored.requestId && entry.scope.sessionId === stored.scope.sessionId),
				);
				return [...kept, stored];
			});
		},
		async find(request, context) {
			const draft = await json.read();
			const matches = draft.filter(
				(entry) => entry.requestId === request.requestId && scopeMatches(context.scope, entry),
			);
			for (const match of matches) {
				const reviewed = fromStored(match);
				if (reviewed) return reviewed;
			}
			return undefined;
		},
	};
}

function runKey(batch: FrozenP5Batch, item: Item): string {
	return `${batch.sha256}:${item.id}`;
}

function submitInput(plan: P5BatchPlan, key: string): ComputeJobInput {
	const { jobId: _jobId, ...rest } = plan.job;
	return { ...rest, idempotencyKey: key } as ComputeJobInput;
}

/** The reviewed plan for one item. A model item has no compute plan at all. */
function planFor(options: P5BatchExecutionPortOptions, item: Item, batch: FrozenP5Batch): P5BatchPlan {
	if (item.execution.kind === "model") throw new Error("P5 batch execution does not run model items");
	const plan = options.planOf(item, batch);
	if (!plan) throw new Error("P5 item has no reviewed compute plan");
	if (plan.expected.length === 0) throw new Error("P5 item plan declares no expected outputs");
	return plan;
}

/** Cancel the job and wait until the runner reports a terminal state. */
async function cancelAndDrain(
	compute: P5BatchExecutionPortOptions["compute"],
	jobId: string,
	pollMs: number,
	cleanupMs: number,
): Promise<void> {
	try {
		await compute.cancel(jobId);
	} catch {
		// A failed cancel still leaves a live job; the drain below is what proves cleanup.
	}
	const deadline = Date.now() + cleanupMs;
	for (;;) {
		const job = await compute.status(jobId);
		if (TERMINAL.has(job.status)) return;
		if (Date.now() >= deadline) return;
		await delay(pollMs);
	}
}

type WaitOutcome = "succeeded" | "terminal" | "aborted" | "expired";

async function waitForTerminal(
	compute: P5BatchExecutionPortOptions["compute"],
	jobId: string,
	signal: AbortSignal | undefined,
	deadlineMs: number,
	pollMs: number,
): Promise<WaitOutcome> {
	const deadline = Date.now() + deadlineMs;
	for (;;) {
		if (signal?.aborted) return "aborted";
		const job = await compute.status(jobId);
		if (job.status === "succeeded") return "succeeded";
		if (TERMINAL.has(job.status)) return "terminal";
		if (Date.now() >= deadline) return "expired";
		await delay(pollMs);
	}
}

/** T2 execution ports over the real ComputeService: submit, collect, checksum readback. */
export function createP5BatchExecutionPort(options: P5BatchExecutionPortOptions): P5BatchExecutionPort {
	const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
	const cleanupMs = options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_MS;
	const runs = new Map<string, { readonly jobId: string; readonly targetDir: string }>();

	const port: P5BatchExecutionPort = {
		expectedReadback(item, batch) {
			return planFor(options, item, batch).expected.map((entry) => ({ ...entry }));
		},
		async execute(item, batch, context) {
			const plan = planFor(options, item, batch);
			const key = contractContentHash([batch.sha256, item.id]);
			const targetDir = join(options.outputRoot, batch.sha256, item.id);
			const job = await options.compute.submit(submitInput(plan, `p5-item:${key}`));
			runs.set(runKey(batch, item), { jobId: job.jobId, targetDir });
			const outcome = await waitForTerminal(
				options.compute,
				job.jobId,
				context.signal,
				item.budget.timeoutMs,
				pollMs,
			);
			if (outcome === "aborted" || outcome === "expired") {
				await cancelAndDrain(options.compute, job.jobId, pollMs, cleanupMs);
				if (outcome === "aborted") throw new Error("P5 item execution was aborted");
				return { verified: false };
			}
			if (outcome === "terminal") return { verified: false };
			await options.compute.collect(job.jobId, {
				targetDir,
				expected: plan.expected.map((entry) => entry.path),
			});
			return { verified: true };
		},
		async readback(item, batch) {
			const state = runs.get(runKey(batch, item));
			if (!state) return [];
			const plan = planFor(options, item, batch);
			return readActualOutputs(state.targetDir, plan.expected);
		},
	};
	return port;
}

/** Read the collected bytes and hash them; never report the reviewed expectation. */
async function readActualOutputs(
	targetDir: string,
	expected: readonly FileReadback[],
): Promise<FileReadback[]> {
	const actual: FileReadback[] = [];
	for (const entry of expected) {
		try {
			const bytes = await readFile(join(targetDir, entry.path));
			actual.push({
				path: entry.path,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				bytes: bytes.byteLength,
			});
		} catch {
			// A missing output yields a shorter readback, which fails the reviewed expectation.
		}
	}
	return actual;
}
