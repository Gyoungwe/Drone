import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ComputeRerunInput, ComputeRerunResult, resultEnvelope } from "@gyoungwe/plugin-api/p5-inquiry";
import { Code, type Failure, type Receipt, type Result, type Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { createP5ReceiptObserver } from "./p5-receipt-observer";
import type { P5ReceiptStore } from "./p5-receipt-store";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";

export interface P5RerunSource {
	readonly runId: string;
	readonly sourceRunReceiptRef: string;
	readonly workspaceId: string;
	readonly artifactId: string;
	/** Null means the host has not verified the artifact bytes. */
	readonly verifiedSha256: string | null;
	readonly profile: string;
}
interface SubmitPlan {
	readonly request: ComputeRerunInput;
	readonly inputSha256: string;
	readonly scope: Scope;
	readonly source: P5RerunSource;
}
interface Submission {
	readonly jobId: string;
	readonly inputSha256: string;
}
export interface P5RerunSubmitPorts {
	readonly store: P5ReceiptStore;
	now(): string;
	/** Current host-bound caller/provider generations, never a restored receipt's identity. */
	scope(context: PluginCapabilityContext): Scope;
	resolve(request: ComputeRerunInput, scope: Scope): Promise<P5RerunSource | undefined>;
	/** Durable compute records, confined to this scope; lookup must never submit. */
	findSubmission(request: ComputeRerunInput, scope: Scope): Promise<Submission | undefined>;
	/** Persist requestId + inputSha256 with the job so a lost reply remains discoverable. */
	submit(plan: SubmitPlan, context: PluginCapabilityContext): Promise<string>;
}

const operation = "compute.rerun.submit";
function failure(code: Code, receiptRef: string | null = null): Failure {
	return { status: "failed", code, receiptRef };
}
function requestHash(input: ComputeRerunInput): string {
	// Schema field order makes equivalent JSON independent of the caller's object key order.
	const { requestId, sourceRunReceiptRef, artifactId, expectedSha256, profile, preflightRef, budget } = input;
	const identity = [requestId, sourceRunReceiptRef, artifactId, expectedSha256, profile, preflightRef];
	const limits = [budget.maxTokens, budget.maxCost, budget.timeoutMs, budget.maxOutputBytes];
	return createHash("sha256")
		.update(JSON.stringify([identity, limits]))
		.digest("hex");
}

async function recover(
	ports: P5RerunSubmitPorts,
	request: ComputeRerunInput,
	scope: Scope,
	receipt: Receipt,
): Promise<Result<ComputeRerunResult>> {
	if (receipt.operation !== operation || !isDeepStrictEqual(receipt.scope, scope))
		return failure("SCOPE_CHANGED");
	if (receipt.inputSha256 !== requestHash(request)) return failure("DUPLICATE_CONFLICT", receipt.receiptRef);
	if (receipt.decision !== "approved") return failure("DENIED", receipt.receiptRef);
	const job = await ports.findSubmission(request, scope);
	if (job && job.inputSha256 !== receipt.inputSha256)
		return failure("DUPLICATE_CONFLICT", receipt.receiptRef);
	return {
		status: "ok",
		value: {
			requestId: request.requestId,
			jobId: job?.jobId ?? null,
			status: job || receipt.status === "accepted" ? "accepted" : "outcome-unknown",
			artifacts: [],
			receiptRef: receipt.receiptRef,
		},
	};
}

async function prepare(
	ports: P5RerunSubmitPorts,
	request: ComputeRerunInput,
	scope: Scope,
): Promise<SubmitPlan | Failure> {
	const source = await ports.resolve(request, scope);
	if (!source) return failure("INVALID_INPUT");
	if (source.workspaceId !== scope.workspaceId) return failure("SCOPE_CHANGED");
	if (
		source.sourceRunReceiptRef !== request.sourceRunReceiptRef ||
		source.artifactId !== request.artifactId ||
		source.profile !== request.profile
	)
		return failure("INVALID_INPUT");
	if (source.verifiedSha256 !== request.expectedSha256) return failure("READBACK_FAILED");
	return { request, source, scope, inputSha256: requestHash(request) };
}

async function observedFailure(
	ports: P5RerunSubmitPorts,
	request: ComputeRerunInput,
	scope: Scope,
	error: unknown,
): Promise<Result<ComputeRerunResult>> {
	const code =
		error instanceof Error && "code" in error ? Code.enum.find((code) => code === error.code) : undefined;
	if (!code) throw error;
	const receipt = await ports.store.get(request);
	// R3 masks acceptance conflicts as persistence errors; recover only an already-owned acceptance.
	if (receipt && (code === "STATE_CONFLICT" || receipt.inputSha256 !== requestHash(request)))
		return recover(ports, request, scope, receipt);
	return failure(code, receipt?.receiptRef ?? null);
}

async function observeSubmit(
	ports: P5RerunSubmitPorts,
	request: ComputeRerunInput,
	context: PluginCapabilityContext,
	invocation: { readonly approved: boolean; execute(): Promise<unknown> },
	active: AsyncLocalStorage<SubmitPlan>,
): Promise<unknown> {
	const scope = ports.scope(context);
	if (
		context.scope.kind === "application" ||
		context.scope.workspaceId !== scope.workspaceId ||
		(context.scope.kind === "session" && context.scope.sessionId !== scope.sessionId)
	)
		return failure("SCOPE_CHANGED");
	const receipt = await ports.store.get(request);
	if (receipt) return recover(ports, request, scope, receipt);
	const plan = await prepare(ports, request, scope);
	if ("status" in plan) return plan;
	const observe = createP5ReceiptObserver(ports.store, ports.now);
	try {
		return await active.run(plan, () =>
			observe({
				request,
				approved: invocation.approved,
				metadata: {
					operation,
					inputSha256: plan.inputSha256,
					scope,
					category: "compute-preflight",
					parentReceiptRef: request.sourceRunReceiptRef,
				},
				expectedReadback: [],
				execute: invocation.execute,
				readback: async () => [],
			}),
		);
	} catch (error) {
		return observedFailure(ports, request, scope, error);
	}
}

/** No registration or polling: composition supplies the current C broker and durable compute ports. */
export function createP5RerunSubmitHandler(ports: P5RerunSubmitPorts): PluginCapabilityHandler {
	const active = new AsyncLocalStorage<SubmitPlan>();
	return {
		inputSchema: ComputeRerunInput,
		resultSchema: resultEnvelope(ComputeRerunResult),
		effect: "write",
		approval: "always",
		approvalDetail: (input) => {
			const request = input as ComputeRerunInput;
			// Pin every reviewed field before the broker awaits consent or durable acceptance.
			Object.freeze(request.budget);
			Object.freeze(request);
			return request.preflightRef;
		},
		observe: (input, context, invocation) =>
			observeSubmit(ports, input as ComputeRerunInput, context, invocation, active),
		execute: async (input, context): Promise<Result<ComputeRerunResult>> => {
			const plan = active.getStore();
			if (!plan || plan.request !== input) return failure("DENIED");
			const receipt = await ports.store.get(plan.request);
			if (!receipt) throw new Error("P5 rerun acceptance is missing");
			const jobId = await ports.submit(plan, context);
			return {
				status: "ok",
				value: {
					requestId: plan.request.requestId,
					jobId,
					status: "accepted",
					artifacts: [],
					receiptRef: receipt.receiptRef,
				},
			};
		},
	};
}
