import {
	assertResearchContract,
	buildValidationEvidenceCapsule,
	type CapabilityCandidate,
	type CapabilityEnvironmentProbe,
	type CapabilityRequest,
	type CapabilityResearchPlan,
	type CapabilitySourceReceipt,
	type CapabilityValidationGate,
	type ContractParentRef,
	capabilityReference,
	createCapabilityRequest,
	parseCapabilityReference,
	transitionCapabilityRequest,
	type ValidationEvidenceCapsule,
} from "@drone/shared";
import type { AnalysisAdapterRegistry } from "./analysis-adapters/registry";

export interface CapabilityRequestStore {
	get(id: string): Promise<CapabilityRequest | undefined>;
	put(request: CapabilityRequest): Promise<void>;
	list?(): Promise<readonly CapabilityRequest[]>;
}

export interface CapabilityDiscoveryResearchPort {
	research(input: {
		readonly request: CapabilityRequest;
		readonly objective: string;
		readonly questions: readonly string[];
	}): Promise<{
		readonly plan: CapabilityResearchPlan;
		readonly sources: readonly CapabilitySourceReceipt[];
		readonly candidates: readonly CapabilityCandidate[];
	}>;
}

export interface CapabilityEnvironmentPort {
	probe(input: {
		readonly candidate: CapabilityCandidate;
		readonly capabilityRef: string;
	}): Promise<CapabilityEnvironmentProbe>;
}

export interface CapabilityValidationPort {
	validate(input: {
		readonly candidate: CapabilityCandidate;
		readonly capabilityRef: string;
		readonly environment?: CapabilityEnvironmentProbe;
	}): Promise<readonly CapabilityValidationGate[]>;
}

export interface CapabilityDiscoverySnapshot {
	readonly request: CapabilityRequest;
	readonly plan?: CapabilityResearchPlan;
	readonly sources: readonly CapabilitySourceReceipt[];
	readonly candidates: readonly CapabilityCandidate[];
	readonly probes: readonly CapabilityEnvironmentProbe[];
	readonly validationCapsule?: ValidationEvidenceCapsule;
}

export interface CapabilityDiscoveryServiceOptions {
	readonly registry: AnalysisAdapterRegistry;
	readonly store?: CapabilityRequestStore;
	readonly research?: CapabilityDiscoveryResearchPort;
	readonly environment?: CapabilityEnvironmentPort;
	readonly validation?: CapabilityValidationPort;
	readonly now?: () => string;
}

const memoryStore = (): CapabilityRequestStore => {
	const values = new Map<string, CapabilityRequest>();
	return {
		async get(id) {
			return values.get(id);
		},
		async put(request) {
			values.set(request.id, request);
		},
		async list() {
			return [...values.values()];
		},
	};
};

/**
 * Host-facing capability discovery. Research, probing and validation are
 * injected read/observe ports; the service never executes a candidate.
 */
export class CapabilityDiscoveryService {
	private readonly registry: AnalysisAdapterRegistry;
	private readonly store: CapabilityRequestStore;
	private readonly research?: CapabilityDiscoveryResearchPort;
	private readonly environment?: CapabilityEnvironmentPort;
	private readonly validation?: CapabilityValidationPort;
	private readonly now: () => string;
	private readonly snapshots = new Map<string, CapabilityDiscoverySnapshot>();

	constructor(options: CapabilityDiscoveryServiceOptions) {
		this.registry = options.registry;
		this.store = options.store ?? memoryStore();
		this.research = options.research;
		this.environment = options.environment;
		this.validation = options.validation;
		this.now = options.now ?? (() => new Date().toISOString());
	}

	async open(input: {
		readonly id: string;
		readonly caseRef: ContractParentRef;
		readonly assay: string;
		readonly question: string;
		readonly requirements?: readonly string[];
		readonly requestedVersion?: string;
	}): Promise<CapabilityRequest> {
		if (!input.id.trim() || !input.assay.trim() || !input.question.trim())
			throw new Error("Capability request fields are required");
		const now = this.now();
		const matches = this.registry.findByAssay(input.assay);
		let request: CapabilityRequest;
		if (input.requestedVersion) {
			const ref = parseCapabilityReference(`${input.assay}@${input.requestedVersion}`);
			const exact = this.registry.find({ id: ref.capabilityId, version: ref.version });
			request = createCapabilityRequest({
				id: input.id,
				caseRef: input.caseRef,
				assay: input.assay,
				question: input.question,
				requirements: [...(input.requirements ?? [])],
				status: exact ? "resolved" : "open",
				...(exact
					? {
							registeredVersionRef: {
								kind: "capability-version",
								id: capabilityReference({ capabilityId: exact.identity.id, version: exact.identity.version }),
								contentHash: adapterSnapshot(exact),
							},
						}
					: { gapReason: "unregistered" as const }),
				createdAt: now,
				updatedAt: now,
			});
		} else if (matches.length === 1) {
			const adapter = matches[0] as NonNullable<(typeof matches)[number]>;
			request = createCapabilityRequest({
				id: input.id,
				caseRef: input.caseRef,
				assay: input.assay,
				question: input.question,
				requirements: [...(input.requirements ?? [])],
				status: "resolved",
				registeredVersionRef: {
					kind: "capability-version",
					id: capabilityReference({ capabilityId: adapter.identity.id, version: adapter.identity.version }),
					contentHash: adapterSnapshot(adapter),
				},
				createdAt: now,
				updatedAt: now,
			});
		} else {
			request = createCapabilityRequest({
				id: input.id,
				caseRef: input.caseRef,
				assay: input.assay,
				question: input.question,
				requirements: [...(input.requirements ?? [])],
				status: "open",
				gapReason: matches.length ? "ambiguous-version" : "unknown-assay",
				createdAt: now,
				updatedAt: now,
			});
		}
		await this.store.put(request);
		this.snapshots.set(input.id, { request, sources: [], candidates: [], probes: [] });
		return request;
	}

	async get(id: string): Promise<CapabilityDiscoverySnapshot | undefined> {
		const snapshot = this.snapshots.get(id);
		if (snapshot) return snapshot;
		const request = await this.store.get(id);
		return request ? { request, sources: [], candidates: [], probes: [] } : undefined;
	}

	async researchRequest(
		id: string,
		input: { objective: string; questions?: readonly string[] },
	): Promise<CapabilityDiscoverySnapshot> {
		const current = await this.require(id);
		if (!this.research) throw new Error("Capability research is not configured");
		const researching = transitionCapabilityRequest(current.request, "researching", { now: this.now() });
		const result = await this.research.research({
			request: researching,
			objective: input.objective,
			questions: [...(input.questions ?? [])],
		});
		if (result.plan.kind !== "capability-research-plan" || result.plan.readOnly !== true)
			throw new Error("Capability research plan must be read-only");
		for (const source of result.sources) {
			assertResearchContract(source);
			if (source.kind !== "capability-source-receipt" || source.readOnly !== true)
				throw new Error("Capability source receipt must be read-only");
		}
		for (const candidate of result.candidates) {
			assertResearchContract(candidate);
			if (candidate.kind !== "capability-candidate" || candidate.executable !== false)
				throw new Error("Capability candidate is not an executable description");
		}
		const plan = result.plan;
		const request = transitionCapabilityRequest(researching, "researching", {
			now: this.now(),
			researchPlanRef: ref(plan),
			candidateRefs: result.candidates.map(ref),
		});
		await this.store.put(request);
		const snapshot = {
			request,
			plan,
			sources: [...result.sources],
			candidates: [...result.candidates],
			probes: [],
		};
		this.snapshots.set(id, snapshot);
		return snapshot;
	}

	async recommend(id: string, candidateId: string): Promise<CapabilityDiscoverySnapshot> {
		const snapshot = await this.require(id);
		const candidate = snapshot.candidates.find((value) => value.id === candidateId);
		if (!candidate) throw new Error(`Unknown capability candidate: ${candidateId}`);
		const recommendation = {
			kind: candidate.kind,
			id: candidate.id,
			revision: candidate.revision,
			contentHash: candidate.contentHash,
		};
		const request = transitionCapabilityRequest(snapshot.request, snapshot.request.status, {
			now: this.now(),
			recommendedVersionRef: recommendation,
		});
		await this.store.put(request);
		const updated = {
			...snapshot,
			request,
			candidates: snapshot.candidates.map((value) =>
				value.id === candidateId ? { ...value, status: "recommended" as const } : value,
			),
		};
		this.snapshots.set(id, updated);
		return updated;
	}

	async probeEnvironment(id: string, candidateId: string): Promise<CapabilityEnvironmentProbe> {
		const snapshot = await this.require(id);
		if (!this.environment) throw new Error("Capability environment probing is not configured");
		const candidate = this.requireCandidate(snapshot, candidateId);
		const probe = await this.environment.probe({ candidate, capabilityRef: candidateRef(candidate) });
		if (probe.kind !== "capability-environment-probe")
			throw new Error("Invalid capability environment probe");
		const updated = {
			...snapshot,
			probes: [...snapshot.probes.filter((value) => value.id !== probe.id), probe],
		};
		this.snapshots.set(id, updated);
		return probe;
	}

	async validate(id: string, candidateId: string): Promise<ValidationEvidenceCapsule> {
		const snapshot = await this.require(id);
		if (!this.validation) throw new Error("Capability validation is not configured");
		const candidate = this.requireCandidate(snapshot, candidateId);
		const environment = snapshot.probes.find((probe) => probe.capabilityRef === candidateRef(candidate));
		const gates = await this.validation.validate({
			candidate,
			capabilityRef: candidateRef(candidate),
			...(environment ? { environment } : {}),
		});
		if (!gates.length) throw new Error("Capability validation returned no gates");
		const capsule = buildValidationEvidenceCapsule({
			capabilityRef: candidateRef(candidate),
			gates,
			sourceRefs: snapshot.sources.map(ref),
			id: `capsule-${id}-${candidateId}`,
			createdAt: this.now(),
		});
		this.snapshots.set(id, { ...snapshot, validationCapsule: capsule });
		return capsule;
	}

	/** Enable only an exact registered version with ready environment and passed gates. */
	async enable(id: string, requested: string): Promise<CapabilityRequest> {
		const snapshot = await this.require(id);
		const identity = parseCapabilityReference(requested);
		const adapter = this.registry.find({ id: identity.capabilityId, version: identity.version });
		if (!adapter) throw new Error(`Capability is not registered: ${requested}`);
		const candidate = snapshot.candidates.find(
			(value) => value.capabilityId === identity.capabilityId && value.version === identity.version,
		);
		if (!candidate)
			throw new Error(
				"A recommended capability is not directly executable; register its exact adapter first",
			);
		if (candidate.executable !== false) throw new Error("Capability candidate execution flag is invalid");
		const probe = snapshot.probes.find((value) => value.capabilityRef === requested);
		if (probe?.readiness !== "ready") throw new Error("Capability environment is not ready");
		const capsule = snapshot.validationCapsule;
		if (!capsule || capsule.capabilityRef !== requested || capsule.status !== "validated")
			throw new Error("Capability validation evidence is incomplete");
		const versionRef = {
			kind: "capability-version",
			id: requested,
			contentHash: adapterSnapshot(adapter),
		} as const;
		const request = transitionCapabilityRequest(snapshot.request, "resolved", {
			now: this.now(),
			registeredVersionRef: versionRef,
			enabledVersionRef: versionRef,
			validationCapsuleRef: ref(capsule),
		});
		await this.store.put(request);
		this.snapshots.set(id, { ...snapshot, request });
		return request;
	}

	private async require(id: string): Promise<CapabilityDiscoverySnapshot> {
		const snapshot = await this.get(id);
		if (!snapshot) throw new Error(`Capability request not found: ${id}`);
		return snapshot;
	}
	private requireCandidate(snapshot: CapabilityDiscoverySnapshot, id: string): CapabilityCandidate {
		const candidate = snapshot.candidates.find((value) => value.id === id);
		if (!candidate) throw new Error(`Unknown capability candidate: ${id}`);
		return candidate;
	}
}

function ref(value: { kind: string; id: string; revision: number; contentHash: string }): ContractParentRef {
	return { kind: value.kind, id: value.id, revision: value.revision, contentHash: value.contentHash };
}

function candidateRef(candidate: CapabilityCandidate): string {
	return capabilityReference({
		capabilityId: candidate.capabilityId,
		version: candidate.version ?? "candidate",
	});
}

function adapterSnapshot(adapter: { identity: { id: string; version: string }; contract: unknown }): string {
	return `${adapter.identity.id}@${adapter.identity.version}`;
}
