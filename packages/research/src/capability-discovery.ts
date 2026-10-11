import {
	assertResearchContract,
	type CapabilityRequest,
	type CapabilityResearchPlan,
	type CapabilitySourceReceipt,
} from "@drone/shared";

/** Research remains read-only; the host owns network, Vault and receipt persistence. */
export interface CapabilityResearchPorts {
	createPlan(input: {
		readonly request: CapabilityRequest;
		readonly objective: string;
		readonly questions: readonly string[];
	}): Promise<CapabilityResearchPlan>;
	readSources(input: {
		readonly request: CapabilityRequest;
		readonly plan: CapabilityResearchPlan;
	}): Promise<readonly CapabilitySourceReceipt[]>;
}

export interface CapabilityResearchResult {
	readonly plan: CapabilityResearchPlan;
	readonly sources: readonly CapabilitySourceReceipt[];
}

/** Execute only injected research reads and reject mutable or unversioned receipts. */
export async function runCapabilityResearch(
	ports: CapabilityResearchPorts,
	input: {
		readonly request: CapabilityRequest;
		readonly objective: string;
		readonly questions: readonly string[];
	},
): Promise<CapabilityResearchResult> {
	const plan = await ports.createPlan({
		request: input.request,
		objective: input.objective,
		questions: [...input.questions],
	});
	assertResearchContract(plan);
	if (plan.kind !== "capability-research-plan" || plan.readOnly !== true)
		throw new Error("Capability research plan must be read-only");
	const sources = await ports.readSources({ request: input.request, plan });
	for (const source of sources) {
		assertResearchContract(source);
		if (source.kind !== "capability-source-receipt" || source.readOnly !== true)
			throw new Error("Capability source receipt must be read-only");
	}
	return { plan, sources: [...sources] };
}
