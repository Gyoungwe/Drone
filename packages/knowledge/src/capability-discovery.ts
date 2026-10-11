import type { CapabilitySourceReceipt, ContractParentRef } from "@drone/shared";

/** Narrow knowledge boundary consumed by capability discovery. It cannot write or execute. */
export interface CapabilityKnowledgeSourcePort {
	readSource(ref: ContractParentRef): Promise<CapabilitySourceReceipt | undefined>;
}

export async function readCapabilitySources(
	port: CapabilityKnowledgeSourcePort,
	refs: readonly ContractParentRef[],
): Promise<readonly CapabilitySourceReceipt[]> {
	const values = await Promise.all(refs.map((ref) => port.readSource(ref)));
	return values.filter((value): value is CapabilitySourceReceipt => Boolean(value));
}
