import { AsyncLocalStorage } from "node:async_hooks";
import { contractContentHash } from "@drone/shared";
import { CriticInput, CriticResult, resultEnvelope } from "@gyoungwe/plugin-api/p5-discovery";
import { Code, type Failure, type Result, type Scope, Usage } from "@gyoungwe/plugin-api/p5-receipts";
import { Check } from "typebox/value";
import type { createP5PrimaryRunResolver } from "./p5-primary-run-facts";
import { createP5ReceiptObserver } from "./p5-receipt-observer";
import type { P5ReceiptStore } from "./p5-receipt-store";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";

interface CriticProfile {
	readonly providerId: string;
	readonly modelId: string;
}
/** Workspace budgets count input + output tokens; reported cost is optional metadata. */
export interface SpendGate {
	check(input: { workspaceId: string; metered: boolean }): Promise<"allowed" | "denied">;
	record(input: { workspaceId: string; usage: Usage }): Promise<void>;
}
export interface P5CriticPorts {
	readonly store: P5ReceiptStore;
	readonly primary: ReturnType<typeof createP5PrimaryRunResolver>;
	readonly spend: SpendGate;
	/** Host composition owns workflow classification; request JSON cannot change it. */
	readonly metered: boolean;
	now(): string;
	scope(context: PluginCapabilityContext): Scope;
	/** Resolve the named profile's actual identity without falling back to the primary. */
	resolveProfile(profile: string, context: PluginCapabilityContext): Promise<CriticProfile | undefined>;
	/** Structured output only: no executable tools or capability/context object crosses this port. */
	generateStructured(
		input: {
			readonly selection: CriticProfile;
			readonly request: CriticInput;
			readonly resultSchema: typeof CriticResult;
		},
		signal: AbortSignal,
	): Promise<{
		readonly value: unknown;
		readonly usage: Pick<Usage, "inputTokens" | "outputTokens" | "cost">;
	}>;
}
function failure(code: Code, receiptRef: string | null = null): Failure {
	return { status: "failed", code, receiptRef };
}
interface CriticPlan {
	readonly selection: CriticProfile;
	readonly bindingSha256: string;
}
interface Review {
	readonly input: CriticInput;
	readonly request: CriticInput;
	readonly scope: Scope;
	readonly plan: Result<CriticPlan>;
	usage: Usage;
	receiptRef: string | null;
	invalidResult: boolean;
}
async function prepare(
	ports: P5CriticPorts,
	request: CriticInput,
	context: PluginCapabilityContext,
	scope: Scope,
): Promise<Result<CriticPlan>> {
	const primary = await ports.primary.resolve(
		{ primaryRunReceiptRef: request.primaryRunReceiptRef, findingId: request.findingId },
		scope,
	);
	if (primary.status === "failed") return primary;
	const resolved = await ports.resolveProfile(request.profile, context);
	if (!resolved) return failure("MODEL_UNAVAILABLE");
	const selection = Object.freeze({ ...resolved });
	if (selection.providerId === primary.value.provider.providerId)
		return failure("INDEPENDENT_PROVIDER_REQUIRED");
	if (
		ports.metered &&
		(await ports.spend.check({ workspaceId: scope.workspaceId, metered: true })) === "denied"
	)
		return failure("BUDGET_EXHAUSTED");
	return { status: "ok", value: { selection, bindingSha256: primary.value.bindingSha256 } };
}
async function observeCritic(
	ports: P5CriticPorts,
	input: CriticInput,
	context: PluginCapabilityContext,
	invocation: { readonly approved: boolean; execute(): Promise<unknown> },
	active: AsyncLocalStorage<Review>,
): Promise<unknown> {
	const request = structuredClone(input);
	const scope = ports.scope(context);
	const plan = invocation.approved ? await prepare(ports, request, context, scope) : failure("DENIED");
	const review: Review = {
		input,
		request,
		scope,
		plan,
		receiptRef: null,
		invalidResult: false,
		usage: { state: "unknown", metered: ports.metered, inputTokens: null, outputTokens: null, cost: null },
	};
	const store: P5ReceiptStore = {
		...ports.store,
		accept: async (request, metadata) => {
			const receipt = await ports.store.accept(request, metadata);
			review.receiptRef = receipt.receiptRef;
			return receipt;
		},
		// R3 observes completed dispatch; schema rejection is a known failure, not an uncertain call.
		finish: (request, completion) =>
			ports.store.finish(
				request,
				review.invalidResult ? { ...completion, status: "failed", resultSha256: null } : completion,
			),
	};
	const observe = createP5ReceiptObserver(store, ports.now);
	try {
		return await active.run(review, () =>
			observe({
				request,
				metadata: {
					operation: "model.critic.review",
					scope,
					inputSha256: contractContentHash({ request, scope, plan }),
					category: "background-model-spend",
					parentReceiptRef: request.primaryRunReceiptRef,
				},
				approved: plan.status === "ok",
				expectedReadback: [],
				readback: async () => [],
				execute: invocation.execute,
				usage: () => review.usage,
			}),
		);
	} catch (error) {
		const code =
			error instanceof Error && "code" in error ? Code.enum.find((code) => code === error.code) : undefined;
		if (!code) throw error;
		return failure(plan.status === "failed" && code === "DENIED" ? plan.code : code, review.receiptRef);
	}
}
async function executeCritic(
	ports: P5CriticPorts,
	review: Review,
	signal: AbortSignal,
): Promise<Result<CriticResult>> {
	if (review.plan.status !== "ok" || review.receiptRef === null) return failure("DENIED");
	let reply: Awaited<ReturnType<P5CriticPorts["generateStructured"]>>;
	try {
		reply = await ports.generateStructured(
			{ selection: review.plan.value.selection, request: review.request, resultSchema: CriticResult },
			signal,
		);
		const { inputTokens: input, outputTokens: output, cost: reportedCost } = reply.usage;
		const inputTokens = Check(Usage.properties.inputTokens, input) ? input : null;
		const outputTokens = Check(Usage.properties.outputTokens, output) ? output : null;
		const cost = Check(Usage.properties.cost, reportedCost) ? reportedCost : null;
		review.usage =
			inputTokens === null || outputTokens === null
				? { state: "unknown", metered: ports.metered, inputTokens, outputTokens, cost }
				: { state: "known", metered: ports.metered, inputTokens, outputTokens, cost };
	} finally {
		await ports.spend.record({ workspaceId: review.scope.workspaceId, usage: review.usage });
	}
	if (!Check(CriticResult, reply.value)) {
		review.invalidResult = true;
		return failure("INVALID_INPUT", review.receiptRef);
	}
	// The external model result has passed the complete closed schema above.
	const value = reply.value as CriticResult;
	return {
		status: "ok",
		value: {
			status: value.status,
			questions: value.questions,
			provider: review.plan.value.selection.providerId,
			modelReceiptRef: review.receiptRef,
			journalVersion: null,
			inquiryReceiptRefs: [],
		},
	};
}

/** No registration or authorization is created here; composition supplies the current M broker. */
export function createP5CriticHandler(ports: P5CriticPorts): PluginCapabilityHandler {
	const active = new AsyncLocalStorage<Review>();
	return {
		inputSchema: CriticInput,
		resultSchema: resultEnvelope(CriticResult),
		effect: "write",
		approval: "always",
		observe: (input, context, invocation) =>
			observeCritic(ports, input as CriticInput, context, invocation, active),
		execute: async (input, context) => {
			const review = active.getStore();
			return review && review.input === input
				? executeCritic(ports, review, context.signal)
				: failure("DENIED");
		},
	};
}
