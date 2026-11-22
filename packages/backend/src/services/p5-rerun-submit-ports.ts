import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ComputeRerunInput } from "@gyoungwe/plugin-api/p5-inquiry";
import type { Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { JsonStore } from "../json-store";
import type { P5ReceiptStore } from "../plugins/p5-receipt-store";
import type { P5RerunSource, P5RerunSubmitPorts } from "../plugins/p5-rerun-submit";
import type { PluginCapabilityContext } from "../plugins/runtime-capabilities";
import type { StorageEntry, StorageRegistry } from "../storage/registry";
import type { ComputeJobInput, ComputeServicePort } from "./compute";

export const P5_RERUN_BINDING_STORAGE = {
	id: "agent-p5-rerun-bindings",
	owner: "services/p5-rerun-submit-ports",
	schema: 1,
	sensitivity: "private",
} as const satisfies Omit<StorageEntry, "path">;

/** One durable binding between a P5 rerun request and the compute job it started. */
interface RerunBinding {
	readonly requestId: string;
	readonly scope: Scope;
	readonly inputSha256: string;
	readonly sourceRunReceiptRef: string;
	readonly artifactId: string;
	readonly expectedSha256: string;
	readonly profile: string;
	readonly preflightRef: string;
	/** The compute job; null until the submission is confirmed. */
	readonly jobId: string | null;
	/** The idempotency key the job was submitted under, so a lost reply is still findable. */
	readonly idempotencyKey: string;
}

export interface P5RerunBindingStore {
	/** Record the intent before submitting, so a lost reply remains discoverable. */
	bind(binding: RerunBinding): Promise<void>;
	/** Attach the confirmed job id to an existing binding. */
	confirm(request: P5RerunBindingKey, jobId: string): Promise<void>;
	/** Look up a binding; the lookup never submits. */
	find(key: P5RerunBindingKey): Promise<RerunBinding | undefined>;
}

export interface P5RerunBindingKey {
	readonly request: ComputeRerunInput;
	readonly scope: Scope;
	readonly inputSha256: string;
}

/** The three fields that identify a binding, independent of its shape. */
function keyOf(key: P5RerunBindingKey): {
	readonly requestId: string;
	readonly inputSha256: string;
	readonly scope: Scope;
} {
	return { requestId: key.request.requestId, inputSha256: key.inputSha256, scope: key.scope };
}

export interface P5RerunBindingStoreOptions {
	/** Host-private path; the caller owns the location, never the plugin. */
	readonly path: string;
	readonly registry: StorageRegistry;
}

/** The host's own hash of the reviewed request; it must match the plugin's request hash. */
export function p5RerunInputHash(request: ComputeRerunInput): string {
	const { requestId, sourceRunReceiptRef, artifactId, expectedSha256, profile, preflightRef, budget } =
		request;
	const identity = [requestId, sourceRunReceiptRef, artifactId, expectedSha256, profile, preflightRef];
	const limits = [budget.maxTokens, budget.maxCost, budget.timeoutMs, budget.maxOutputBytes];
	return createHash("sha256")
		.update(JSON.stringify([identity, limits]))
		.digest("hex");
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

function isBinding(value: unknown): value is RerunBinding {
	if (!value || typeof value !== "object") return false;
	const row = value as Record<string, unknown>;
	return (
		typeof row.requestId === "string" &&
		typeof row.inputSha256 === "string" &&
		typeof row.sourceRunReceiptRef === "string" &&
		typeof row.artifactId === "string" &&
		typeof row.expectedSha256 === "string" &&
		typeof row.profile === "string" &&
		typeof row.preflightRef === "string" &&
		typeof row.idempotencyKey === "string" &&
		(row.jobId === null || typeof row.jobId === "string") &&
		isScope(row.scope)
	);
}

function parseBindings(text: string): RerunBinding[] {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		// Parse errors can embed source text; keep binding diagnostics content-free.
		throw new Error("P5 rerun binding ledger is not valid JSON");
	}
	if (!Array.isArray(value)) throw new Error("P5 rerun binding ledger must be an array");
	for (const entry of value) if (!isBinding(entry)) throw new Error("P5 rerun binding entry is invalid");
	return value;
}

/** The durable scope↔request↔job binding; it never holds credentials or payloads. */
export function createP5RerunBindingStore(options: P5RerunBindingStoreOptions): P5RerunBindingStore {
	const entry: StorageEntry = { ...P5_RERUN_BINDING_STORAGE, path: options.path };
	if (!options.registry.get(entry.id)) options.registry.register(entry);
	if (options.registry.assertRegistered(entry.id).path !== entry.path)
		throw new Error("P5 rerun binding storage registration does not match the ledger");
	const json = new JsonStore<RerunBinding[]>({
		path: entry.path,
		storageId: "agent-p5-rerun-bindings",
		defaultValue: () => [],
		parse: parseBindings,
		mode: 0o600,
	});
	/** Both a stored binding and a lookup key carry these three fields. */
	const sameKey = (
		entry: { readonly requestId: string; readonly inputSha256: string; readonly scope: Scope },
		key: { readonly requestId: string; readonly inputSha256: string; readonly scope: Scope },
	): boolean =>
		entry.requestId === key.requestId &&
		entry.inputSha256 === key.inputSha256 &&
		isDeepStrictEqual(entry.scope, key.scope);
	return {
		async bind(binding) {
			await json.update((draft) => {
				const kept = draft.filter((entry) => !sameKey(entry, binding));
				// A binding that already carries a job must not lose it: the
				// submission happened, even if its confirmation did not land.
				const previous = draft.find((entry) => sameKey(entry, binding));
				const merged = previous?.jobId ? { ...binding, jobId: previous.jobId } : binding;
				return [...kept, merged];
			});
		},
		async confirm(key, jobId) {
			await json.update((draft) =>
				draft.map((entry) => (sameKey(entry, keyOf(key)) ? { ...entry, jobId } : entry)),
			);
		},
		async find(key) {
			const draft = await json.read();
			return draft.find((entry) => sameKey(entry, keyOf(key)));
		},
	};
}

export interface P5RerunSubmitPortOptions {
	readonly compute: Pick<ComputeServicePort, "submit" | "listJobs" | "getJob">;
	readonly bindings: P5RerunBindingStore;
	/** The host-owned receipt store the plugin records its decisions in. */
	readonly store: P5ReceiptStore;
	/** Host lookup of the verified source run and artifact behind a rerun request. */
	sourceOf(request: ComputeRerunInput, scope: Scope): Promise<P5RerunSource | undefined>;
	/** Host-resolved concrete job input for a reviewed rerun request. */
	jobOf(request: ComputeRerunInput, source: P5RerunSource): ComputeJobInput | undefined;
	/**
	 * Current host-bound caller/provider generations. A caller without a proven
	 * identity has no scope, and this must refuse rather than invent one.
	 */
	readonly scopeOf: (context: PluginCapabilityContext) => Scope | undefined;
	/** Host clock, ISO 8601. */
	now(): string;
}

type SubmitPlan = Parameters<P5RerunSubmitPorts["submit"]>[0];

/**
 * The idempotency key carries the full scope, so a foreign scope computes a
 * different key and can never find this scope's job.
 */
function p5RerunIdempotencyKey(scope: Scope, inputSha256: string): string {
	return `p5-rerun:${createHash("sha256")
		.update(
			JSON.stringify([
				scope.workspaceId,
				scope.sessionId,
				scope.callerSourceHash,
				scope.providerSourceHash,
				inputSha256,
			]),
		)
		.digest("hex")}`;
}

/** Q1 ports over the real ComputeService with a durable scope↔request↔job binding. */
export function createP5RerunSubmitPorts(options: P5RerunSubmitPortOptions): P5RerunSubmitPorts {
	const findByKey = async (request: ComputeRerunInput, scope: Scope) => {
		const inputSha256 = p5RerunInputHash(request);
		const binding = await options.bindings.find({ request, scope, inputSha256 });
		if (binding?.jobId) {
			const job = await options.compute.getJob(binding.jobId);
			if (job) return { jobId: job.jobId, inputSha256 };
			return undefined;
		}
		// The reply was lost before the job id was recorded; the scoped
		// idempotency key still identifies the job the host submitted.
		const key = p5RerunIdempotencyKey(scope, inputSha256);
		const jobs = await options.compute.listJobs();
		const job = jobs.find((entry) => entry.spec.idempotencyKey === key);
		return job ? { jobId: job.jobId, inputSha256 } : undefined;
	};

	return {
		store: options.store,
		now: options.now,
		scope: (context: PluginCapabilityContext): Scope => {
			const scope = options.scopeOf(context);
			if (!scope) throw new Error("P5 rerun requires a proven live session scope");
			return scope;
		},
		resolve: (request, scope) => options.sourceOf(request, scope),
		findSubmission: (request, scope) => findByKey(request, scope),
		async submit(plan: SubmitPlan) {
			const key = p5RerunIdempotencyKey(plan.scope, plan.inputSha256);
			await options.bindings.bind({
				requestId: plan.request.requestId,
				scope: plan.scope,
				inputSha256: plan.inputSha256,
				sourceRunReceiptRef: plan.source.sourceRunReceiptRef,
				artifactId: plan.source.artifactId,
				expectedSha256: plan.request.expectedSha256,
				profile: plan.source.profile,
				preflightRef: plan.request.preflightRef,
				jobId: null,
				idempotencyKey: key,
			});
			const job = options.jobOf(plan.request, plan.source);
			if (!job) throw new Error("P5 rerun has no host-resolved compute job");
			const submitted = await options.compute.submit({ ...job, idempotencyKey: key });
			await options.bindings.confirm(
				{ request: plan.request, scope: plan.scope, inputSha256: plan.inputSha256 },
				submitted.jobId,
			);
			return submitted.jobId;
		},
	};
}
