import type { CapabilityId } from "./capabilities";
import {
	assertResearchContract,
	type ContractParentRef,
	computeResearchContractHash,
	RESEARCH_CONTRACT_SCHEMA_VERSION,
	type VersionedResearchContract,
} from "./research-contracts";

export const CAPABILITY_GOVERNANCE_SCHEMA = "drone:capability-manifest/v1" as const;
export type GovernanceEnvironmentReadiness = "unknown" | "ready" | "not-ready";
export type GovernanceNetworkPolicy = "none" | "allowlisted" | "unrestricted";
export type GovernanceFilesystemPolicy = "none" | "read" | "write";
export type GovernanceProcessPolicy = "none" | "sandbox" | "host";

export interface CapabilityGovernanceManifest extends VersionedResearchContract {
	readonly kind: "capability-governance-manifest";
	readonly manifestSchema: typeof CAPABILITY_GOVERNANCE_SCHEMA;
	readonly id: string;
	readonly capabilityId: CapabilityId;
	readonly name: string;
	readonly version: string;
	readonly registered: boolean;
	readonly source: {
		readonly repository: string;
		readonly commit: string;
		readonly path: string;
		readonly license: string;
	};
	readonly schema: { readonly inputHash: string; readonly outputHash: string };
	readonly permissions: {
		readonly filesystem: GovernanceFilesystemPolicy;
		readonly network: GovernanceNetworkPolicy;
		readonly process: GovernanceProcessPolicy;
		readonly secrets: readonly string[];
	};
	readonly resources: {
		readonly cpus: number;
		readonly memoryBytes: number;
		readonly wallTimeSeconds: number;
	};
	readonly sideEffects: readonly string[];
	/** Named evidence outputs are part of the auditable capability contract. */
	readonly evidenceOutputs: readonly string[];
	readonly environment: {
		readonly readiness: GovernanceEnvironmentReadiness;
		readonly requirements: readonly string[];
		readonly fingerprint?: string;
		readonly observedAt?: string;
		readonly probeRef?: ContractParentRef;
	};
	readonly createdAt: string;
}

export type CapabilityGovernanceAuditEvent = "registered" | "assessed" | "submission-blocked";

/** Immutable audit projection. Secrets are intentionally omitted. */
export interface CapabilityGovernanceAuditRecord {
	readonly id: string;
	readonly manifestId: string;
	readonly event: CapabilityGovernanceAuditEvent;
	readonly at: string;
	readonly capabilityId: CapabilityId;
	readonly version: string;
	readonly source: CapabilityGovernanceManifest["source"];
	readonly schema: CapabilityGovernanceManifest["schema"];
	readonly sideEffects: readonly string[];
	readonly evidenceOutputs: readonly string[];
	readonly environment: {
		readonly readiness: GovernanceEnvironmentReadiness;
		readonly fingerprint?: string;
		readonly observedAt?: string;
		readonly probeRef?: ContractParentRef;
	};
	readonly status: CapabilityGovernanceAssessment["status"];
	readonly findings: readonly CapabilityGovernanceFinding[];
}

export interface CapabilityGovernanceAuditStore {
	append(record: CapabilityGovernanceAuditRecord): void;
	list(manifestId?: string): readonly CapabilityGovernanceAuditRecord[];
}

export class InMemoryCapabilityGovernanceAuditStore implements CapabilityGovernanceAuditStore {
	private readonly records: CapabilityGovernanceAuditRecord[] = [];

	append(record: CapabilityGovernanceAuditRecord): void {
		this.records.push({
			...record,
			source: { ...record.source },
			schema: { ...record.schema },
			sideEffects: [...record.sideEffects],
			evidenceOutputs: [...record.evidenceOutputs],
			environment: { ...record.environment },
			findings: record.findings.map((finding) => ({ ...finding })),
		});
	}

	list(manifestId?: string): readonly CapabilityGovernanceAuditRecord[] {
		return this.records
			.filter((record) => manifestId === undefined || record.manifestId === manifestId)
			.map((record) => ({
				...record,
				source: { ...record.source },
				schema: { ...record.schema },
				sideEffects: [...record.sideEffects],
				evidenceOutputs: [...record.evidenceOutputs],
				environment: { ...record.environment },
				findings: record.findings.map((finding) => ({ ...finding })),
			}));
	}
}

export type CapabilityGovernanceBlockCode =
	| "unregistered"
	| "unknown-version"
	| "missing-provenance"
	| "missing-schema"
	| "invalid-permissions"
	| "invalid-resources"
	| "invalid-contract"
	| "environment-not-ready";

export interface CapabilityGovernanceFinding {
	readonly code: CapabilityGovernanceBlockCode;
	readonly message: string;
}

export interface CapabilityGovernanceAssessment {
	readonly manifestId: string;
	readonly status: "ready" | "blocked";
	readonly canSubmit: boolean;
	readonly findings: readonly CapabilityGovernanceFinding[];
}

type ManifestInput = Omit<
	CapabilityGovernanceManifest,
	keyof VersionedResearchContract | "kind" | "manifestSchema" | "registered"
> & {
	readonly registered?: boolean;
};

function contract<T extends Record<string, unknown>>(body: T): T & VersionedResearchContract {
	const record = {
		...body,
		schemaVersion: RESEARCH_CONTRACT_SCHEMA_VERSION,
		revision: 0,
		parentRefs: [],
	} as unknown as T & VersionedResearchContract;
	const result = { ...record, contentHash: computeResearchContractHash(record) };
	assertResearchContract(result);
	return result;
}

const sha256 = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);
const semver = (value: string): boolean => {
	const match =
		/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(value);
	if (!match) return false;
	const prerelease = match[4]?.split(".") ?? [];
	const build = match[5]?.split(".") ?? [];
	return (
		prerelease.every((identifier) => identifier.length > 0 && !/^0\d+$/.test(identifier)) &&
		build.every((identifier) => identifier.length > 0)
	);
};
const nonempty = (value: string): boolean => value.trim().length > 0;

export function createCapabilityGovernanceManifest(input: ManifestInput): CapabilityGovernanceManifest {
	if (!nonempty(input.id) || !nonempty(input.name))
		throw new Error("Capability manifest identity is required");
	return contract({
		kind: "capability-governance-manifest" as const,
		manifestSchema: CAPABILITY_GOVERNANCE_SCHEMA,
		id: input.id,
		capabilityId: input.capabilityId,
		name: input.name,
		version: input.version,
		registered: input.registered ?? true,
		source: { ...input.source },
		schema: { ...input.schema },
		permissions: { ...input.permissions, secrets: [...input.permissions.secrets] },
		resources: { ...input.resources },
		sideEffects: [...input.sideEffects],
		evidenceOutputs: [...input.evidenceOutputs],
		environment: {
			...input.environment,
			requirements: [...input.environment.requirements],
		},
		createdAt: input.createdAt,
	});
}

export function assessCapabilityGovernance(
	manifest: CapabilityGovernanceManifest,
): CapabilityGovernanceAssessment {
	const findings: CapabilityGovernanceFinding[] = [];
	try {
		assertResearchContract(manifest);
	} catch {
		findings.push({
			code: "invalid-contract",
			message: "Manifest content hash or versioned envelope is invalid",
		});
	}
	if (!manifest.registered)
		findings.push({
			code: "unregistered",
			message: "Capability is not registered in the governance catalog",
		});
	if (!semver(manifest.version))
		findings.push({ code: "unknown-version", message: "A pinned semantic version is required" });
	if (
		![
			manifest.source.repository,
			manifest.source.commit,
			manifest.source.path,
			manifest.source.license,
		].every(nonempty)
	)
		findings.push({
			code: "missing-provenance",
			message: "Repository, commit, path and license are required",
		});
	if (!sha256(manifest.schema.inputHash) || !sha256(manifest.schema.outputHash))
		findings.push({ code: "missing-schema", message: "Input and output schema hashes are required" });
	if (
		!(["none", "read", "write"] as GovernanceFilesystemPolicy[]).includes(manifest.permissions.filesystem) ||
		!(["none", "allowlisted", "unrestricted"] as GovernanceNetworkPolicy[]).includes(
			manifest.permissions.network,
		) ||
		!(["none", "sandbox", "host"] as GovernanceProcessPolicy[]).includes(manifest.permissions.process)
	)
		findings.push({
			code: "invalid-permissions",
			message: "Filesystem, network and process permissions must be declared",
		});
	if (
		![manifest.resources.cpus, manifest.resources.memoryBytes, manifest.resources.wallTimeSeconds].every(
			(value) => Number.isFinite(value) && value > 0,
		)
	)
		findings.push({
			code: "invalid-resources",
			message: "Positive CPU, memory and wall-time limits are required",
		});
	if (
		manifest.environment.readiness !== "ready" ||
		!nonempty(manifest.environment.fingerprint ?? "") ||
		!nonempty(manifest.environment.observedAt ?? "") ||
		Number.isNaN(Date.parse(manifest.environment.observedAt ?? ""))
	)
		findings.push({
			code: "environment-not-ready",
			message: "A successful environment probe is required before submission",
		});
	return {
		manifestId: manifest.id,
		status: findings.length ? "blocked" : "ready",
		canSubmit: findings.length === 0,
		findings,
	};
}

export function assertCapabilityGovernanceReady(manifest: CapabilityGovernanceManifest): void {
	const assessment = assessCapabilityGovernance(manifest);
	if (!assessment.canSubmit)
		throw new Error(
			`Capability submission blocked: ${assessment.findings.map((finding) => finding.code).join(", ")}`,
		);
}

export class CapabilityGovernanceCatalog {
	private readonly manifests = new Map<string, CapabilityGovernanceManifest>();
	private readonly auditStore: CapabilityGovernanceAuditStore;
	private readonly now: () => string;

	constructor(
		options: { readonly auditStore?: CapabilityGovernanceAuditStore; readonly now?: () => string } = {},
	) {
		this.auditStore = options.auditStore ?? new InMemoryCapabilityGovernanceAuditStore();
		this.now = options.now ?? (() => new Date().toISOString());
	}

	private appendAudit(
		manifest: CapabilityGovernanceManifest,
		event: CapabilityGovernanceAuditEvent,
		assessment: CapabilityGovernanceAssessment,
	): void {
		this.auditStore.append({
			id: `${manifest.id}:${event}:${this.now()}`,
			manifestId: manifest.id,
			event,
			at: this.now(),
			capabilityId: manifest.capabilityId,
			version: manifest.version,
			source: { ...manifest.source },
			schema: { ...manifest.schema },
			sideEffects: [...manifest.sideEffects],
			evidenceOutputs: [...manifest.evidenceOutputs],
			environment: { ...manifest.environment },
			status: assessment.status,
			findings: assessment.findings.map((finding) => ({ ...finding })),
		});
	}

	register(manifest: CapabilityGovernanceManifest): void {
		if (this.manifests.has(manifest.id))
			throw new Error(`Capability manifest already registered: ${manifest.id}`);
		this.manifests.set(manifest.id, manifest);
		this.appendAudit(manifest, "registered", assessCapabilityGovernance(manifest));
	}

	get(id: string): CapabilityGovernanceManifest | undefined {
		return this.manifests.get(id);
	}

	list(): readonly CapabilityGovernanceManifest[] {
		return [...this.manifests.values()];
	}

	assess(id: string): CapabilityGovernanceAssessment {
		const manifest = this.manifests.get(id);
		if (!manifest)
			return {
				manifestId: id,
				status: "blocked",
				canSubmit: false,
				findings: [
					{ code: "unregistered", message: "Capability is not registered in the governance catalog" },
				],
			};
		const assessment = assessCapabilityGovernance(manifest);
		this.appendAudit(manifest, assessment.canSubmit ? "assessed" : "submission-blocked", assessment);
		return assessment;
	}

	assertReady(id: string): void {
		const assessment = this.assess(id);
		if (!assessment.canSubmit)
			throw new Error(
				`Capability submission blocked: ${assessment.findings.map((finding) => finding.code).join(", ")}`,
			);
	}

	audit(id?: string): readonly CapabilityGovernanceAuditRecord[] {
		return this.auditStore.list(id);
	}
}
