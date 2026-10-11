import {
	assertResearchContract,
	type CapabilityRequest,
	type CapabilityRequestStatus,
	type CapabilityValidationGate,
	type CapabilityVersion,
	type ContractParentRef,
	createCapabilityRequest,
	createValidationEvidenceCapsule,
	type ValidationEvidenceCapsule,
} from "./research-contracts";

export interface CapabilityReference {
	readonly capabilityId: string;
	readonly version: string;
}

/** Parse only an exact capabilityId@version reference. Bare IDs are rejected. */
export function parseCapabilityReference(value: string): CapabilityReference {
	if (typeof value !== "string" || value.trim() !== value || !value)
		throw new Error("Capability reference is required");
	const at = value.lastIndexOf("@");
	if (at <= 0 || at === value.length - 1)
		throw new Error("Capability reference must be capabilityId@version");
	const capabilityId = value.slice(0, at);
	const version = value.slice(at + 1);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(capabilityId)) throw new Error("Invalid capability id");
	if (!/^[A-Za-z0-9][A-Za-z0-9._+:/-]{0,63}$/.test(version)) throw new Error("Invalid capability version");
	return { capabilityId, version };
}

export function capabilityReference(value: CapabilityReference): string {
	parseCapabilityReference(`${value.capabilityId}@${value.version}`);
	return `${value.capabilityId}@${value.version}`;
}

export function capabilityVersionReference(
	version: Pick<CapabilityVersion, "capabilityId" | "version">,
): string {
	return capabilityReference(version);
}

/** Resolve an exact registered version. Ambiguous or unregistered references fail closed. */
export function resolveCapabilityVersion(
	versions: readonly CapabilityVersion[],
	requested: string,
): CapabilityVersion {
	const ref = parseCapabilityReference(requested);
	const matches = versions.filter(
		(version) => version.capabilityId === ref.capabilityId && version.version === ref.version,
	);
	if (matches.length === 0) throw new Error(`Capability is not registered: ${requested}`);
	if (matches.length !== 1) throw new Error(`Capability reference is ambiguous: ${requested}`);
	return matches[0] as CapabilityVersion;
}

const requestTransitions: Readonly<Record<CapabilityRequestStatus, readonly CapabilityRequestStatus[]>> = {
	open: ["researching", "blocked", "cancelled"],
	researching: ["resolved", "blocked", "cancelled", "researching"],
	resolved: ["researching", "cancelled"],
	blocked: ["researching", "cancelled"],
	cancelled: [],
};

/** Advance a request without granting execution or changing its immutable history. */
export function transitionCapabilityRequest(
	request: CapabilityRequest,
	status: CapabilityRequestStatus,
	input: {
		readonly now: string;
		readonly revision?: number;
		readonly registeredVersionRef?: ContractParentRef;
		readonly enabledVersionRef?: ContractParentRef;
		readonly recommendedVersionRef?: ContractParentRef;
		readonly gapReason?: CapabilityRequest["gapReason"];
		readonly researchPlanRef?: ContractParentRef;
		readonly candidateRefs?: readonly ContractParentRef[];
		readonly validationCapsuleRef?: ContractParentRef;
	},
): CapabilityRequest {
	assertResearchContract(request);
	if (request.status !== status && !requestTransitions[request.status].includes(status))
		throw new Error(`Invalid capability request transition: ${request.status} -> ${status}`);
	const {
		schemaVersion: _schemaVersion,
		revision: _oldRevision,
		contentHash: _oldContentHash,
		parentRefs: _oldParentRefs,
		migration: _oldMigration,
		...body
	} = request;
	return createCapabilityRequest({
		...body,
		status,
		updatedAt: input.now,
		revision: input.revision ?? request.revision + 1,
		parentRefs: [
			{ kind: request.kind, id: request.id, revision: request.revision, contentHash: request.contentHash },
		],
		...(input.registeredVersionRef ? { registeredVersionRef: input.registeredVersionRef } : {}),
		...(input.enabledVersionRef ? { enabledVersionRef: input.enabledVersionRef } : {}),
		...(input.recommendedVersionRef ? { recommendedVersionRef: input.recommendedVersionRef } : {}),
		...(input.gapReason ? { gapReason: input.gapReason } : {}),
		...(input.researchPlanRef ? { researchPlanRef: input.researchPlanRef } : {}),
		...(input.candidateRefs ? { candidateRefs: [...input.candidateRefs] } : {}),
		...(input.validationCapsuleRef ? { validationCapsuleRef: input.validationCapsuleRef } : {}),
	});
}

export interface ValidationEvidenceInput {
	readonly capabilityRef: string;
	readonly gates: readonly CapabilityValidationGate[];
	readonly sourceRefs?: readonly ContractParentRef[];
	readonly id: string;
	readonly createdAt: string;
}

/** Build an evidence capsule from all three independent validation gates. */
export function buildValidationEvidenceCapsule(input: ValidationEvidenceInput): ValidationEvidenceCapsule {
	parseCapabilityReference(input.capabilityRef);
	if (input.gates.length === 0) throw new Error("At least one validation gate is required");
	const requiredKinds = ["static", "fixture", "scientific"] as const;
	const complete = requiredKinds.every((kind) => input.gates.some((gate) => gate.validation === kind));
	const status =
		complete && input.gates.every((gate) => gate.status === "passed")
			? "validated"
			: input.gates.some((gate) => gate.status === "failed")
				? "failed"
				: "incomplete";
	return createValidationEvidenceCapsule({
		id: input.id,
		capabilityRef: input.capabilityRef,
		gateRefs: input.gates.map((gate) => ({
			kind: gate.kind,
			id: gate.id,
			revision: gate.revision,
			contentHash: gate.contentHash,
		})),
		sourceRefs: [...(input.sourceRefs ?? [])],
		status,
		createdAt: input.createdAt,
	});
}
